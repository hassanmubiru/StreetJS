// tests/metric-references-pbt.test.ts
// Property-based test for the Advanced Observability anti-fabrication guard
// (Req 10.1 / 10.7). Kept in its own file so the universal property is
// exercised across many generated (exported-set, observability-asset)
// combinations without clobbering the example/edge-case unit tests in
// metric-references.test.ts and observability-subsystem-pack.test.ts.
//
// Requirement 10.1: a dashboard or alert may only reference metrics the
// application actually exports.
// Requirement 10.7: if a dashboard/alert references a metric the app does not
// export, validation SHALL fail and record the offending (metric, asset) pair.
//
// `validateMetricReferences(exported, assets)` is the guard. This file proves,
// across arbitrary inputs, that its result is EXACTLY the set of (metric, asset)
// pairs where an asset references a metric that is not exported — none invented,
// none omitted, each reported once — and that it is empty IFF every referenced
// metric is exported. The independently-tracked expectation (built directly
// from the generator) is compared against the guard so the property checks the
// implementation against a separate source of truth.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  validateMetricReferences,
  referencedMetrics,
  type ObservabilityAssets,
  type MetricReferenceViolation,
} from '../observability/metric-references.js';
import type { GrafanaDashboard } from '../observability/grafana-dashboard.js';
import type { RuleGroup } from '../observability/prometheus-rules.js';

const NUM_RUNS = 100;

// ── Metric names ──────────────────────────────────────────────────────────────
//
// Composed from a subsystem prefix, a signal suffix, and a numeric tag so every
// generated name is a valid PromQL identifier that is never a reserved word and
// is never glued to a `(` (so it is never mistaken for a function call). This
// keeps the generated names firmly inside the metric-name input space.
const metricNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('db', 'kafka', 'rabbitmq', 'plugin', 'http', 'queue', 'mem'),
    fc.constantFrom('latency', 'rate', 'total', 'depth', 'bytes', 'count', 'wait', 'lag', 'duration'),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([sub, sig, n]) => `${sub}_${sig}_${n}`);

// ── Expression templates ──────────────────────────────────────────────────────
//
// Each template wraps a single metric name in a different PromQL shape. Every
// shape references exactly the one metric: function names are immediately
// followed by `(` (excluded), range/subquery selectors and label matchers are
// stripped, aggregation label lists (`by (le)`) are discarded, and numeric
// literals are ignored. Varying the shape exercises the conservative extractor.
const TEMPLATES: ReadonlyArray<(m: string) => string> = [
  (m) => m,
  (m) => `rate(${m}[5m])`,
  (m) => `sum(rate(${m}[5m]))`,
  (m) => `${m} > 0.5`,
  (m) => `${m}{job="api"} > 100`,
  (m) => `histogram_quantile(0.95, sum(rate(${m}[5m])) by (le))`,
];

// ── Scenario ──────────────────────────────────────────────────────────────────
//
// A fully-built scenario: an exported set, the observability assets, the
// independently-computed expected violations, and the referenced-metric set.

interface Scenario {
  exported: Set<string>;
  assets: ObservabilityAssets;
  expected: MetricReferenceViolation[];
  referenced: Set<string>;
}

interface AssetSpec {
  kind: 'dashboard' | 'rule';
  // Indices into `allMetrics`, unique within the asset (so no duplicate metric
  // references within a single asset).
  metricIdxs: number[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .uniqueArray(metricNameArb, { minLength: 1, maxLength: 10 })
  .chain((allMetrics) => {
    const n = allMetrics.length;
    const assetSpecArb: fc.Arbitrary<AssetSpec> = fc.record({
      kind: fc.constantFrom('dashboard', 'rule') as fc.Arbitrary<'dashboard' | 'rule'>,
      metricIdxs: fc.uniqueArray(fc.nat(n - 1), { minLength: 1, maxLength: n }),
    });
    return fc.record({
      allMetrics: fc.constant(allMetrics),
      // One exported/not-exported flag per metric.
      exportedFlags: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
      assetSpecs: fc.array(assetSpecArb, { minLength: 0, maxLength: 6 }),
    });
  })
  .map(({ allMetrics, exportedFlags, assetSpecs }) => {
    const exported = new Set<string>();
    allMetrics.forEach((m, i) => {
      if (exportedFlags[i]) exported.add(m);
    });

    const dashboards: GrafanaDashboard[] = [];
    const rules: RuleGroup[] = [];
    const expected: MetricReferenceViolation[] = [];
    const referenced = new Set<string>();

    assetSpecs.forEach((spec, ai) => {
      const metrics = spec.metricIdxs.map((idx) => allMetrics[idx]);
      const expr = (i: number): string => TEMPLATES[(spec.metricIdxs[i] + ai) % TEMPLATES.length](metrics[i]);

      if (spec.kind === 'dashboard') {
        const uid = `dash-${ai}`;
        const asset = `dashboard:${uid}`;
        dashboards.push({
          uid,
          title: `Dash ${ai}`,
          schemaVersion: 39,
          version: 1,
          tags: [],
          timezone: 'browser',
          refresh: '30s',
          panels: metrics.map((_, pi) => ({
            id: pi + 1,
            title: `panel-${pi}`,
            type: 'timeseries',
            gridPos: { x: 0, y: pi * 8, w: 12, h: 8 },
            targets: [{ expr: expr(pi), refId: 'A' }],
          })),
        });
        metrics.forEach((m) => {
          referenced.add(m);
          if (!exported.has(m)) expected.push({ metric: m, asset });
        });
      } else {
        const name = `group-${ai}`;
        const asset = `rulegroup:${name}`;
        rules.push({
          name,
          rules: metrics.map((_, ri) => ({ record: `rec_${ai}_${ri}`, expr: expr(ri) })),
        });
        metrics.forEach((m) => {
          referenced.add(m);
          if (!exported.has(m)) expected.push({ metric: m, asset });
        });
      }
    });

    return { exported, assets: { dashboards, rules }, expected, referenced };
  });

// Stable, comparable key for a (asset, metric) violation pair.
const violationKey = (v: MetricReferenceViolation): string => `${v.asset}\u0000${v.metric}`;

// Feature: platform-leadership-gaps, Property 26: Observability assets reference only exported metrics
// Validates: Requirements 10.1, 10.7
describe('Property 26: observability assets reference only exported metrics', () => {
  it('validateMetricReferences returns exactly the offending (metric, asset) pairs — none invented, none omitted, each once', () => {
    fc.assert(
      fc.property(scenarioArb, ({ exported, assets, expected, referenced }) => {
        const actual = validateMetricReferences(exported, assets);

        // The guard's result equals the independently-tracked expectation: every
        // unexported referenced metric is recorded against its asset (Req 10.7),
        // and nothing else is reported.
        assert.deepEqual(
          actual.map(violationKey).sort(),
          expected.map(violationKey).sort(),
        );

        // Each (metric, asset) pair is reported at most once.
        assert.equal(actual.length, new Set(actual.map(violationKey)).size);

        // Soundness: every reported violation is a real reference to a
        // non-exported metric (never a fabricated or exported one).
        for (const v of actual) {
          assert.equal(exported.has(v.metric), false);
          assert.ok(referenced.has(v.metric));
        }

        // The guard passes (empty result) IFF every referenced metric is
        // exported — i.e. assets reference only exported metrics (Req 10.1).
        const allReferencedExported = [...referenced].every((m) => exported.has(m));
        assert.equal(actual.length === 0, allReferencedExported);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('referencedMetrics enumerates exactly the metrics the assets reference', () => {
    fc.assert(
      fc.property(scenarioArb, ({ assets, referenced }) => {
        assert.deepEqual(
          [...referencedMetrics(assets)].sort(),
          [...referenced].sort(),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
