// scripts/tests/observability-validate-harness.test.mjs
//
// Unit tests for the Advanced Observability validation-pipeline harness
// (Req 10.6 / 10.7 / 10.8 / 10.9). These exercise the harness's pure decision
// logic without spawning the CommandRunner or promtool:
//
//   • the promtool prerequisite probe returns either `null` (promtool present)
//     or a well-formed BlockedReason `{ missingPrerequisite, kind }` — exactly
//     the shape the runner needs to record an honest BLOCKED;
//   • the OFFLINE validation pipeline passes on the real default pack (every
//     referenced metric is an Exported Metric; rule groups + dashboards are
//     structurally valid) — proving the shipped dashboards/alerts/SLO pack
//     contain no fabricated metric references;
//   • the exported metric set includes the expected default + subsystem series
//     and the Prometheus built-in `up` series.
//
// The semantic promtool pass (`promtool check rules` / `promtool test rules`) is
// the Layer-B prerequisite and is covered by the observability.validate
// Verification Artifact produced through CommandRunner in CI; it is intentionally
// NOT run here so the unit suite stays green without promtool installed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  probePromtool,
  hasPromtool,
  buildExportedMetricSet,
  runOfflineValidations,
  PROMTOOL_PREREQUISITE,
} from '../observability/lib.mjs';

describe('observability validation harness — pure logic', () => {
  it('hasPromtool returns a boolean', () => {
    assert.equal(typeof hasPromtool(), 'boolean');
  });

  it('probePromtool returns null or a well-formed BlockedReason', () => {
    const result = probePromtool();
    if (result === null) return; // promtool is present

    assert.equal(typeof result.missingPrerequisite, 'string');
    assert.ok(result.missingPrerequisite.length > 0, 'missing prerequisite id must be non-empty');
    assert.equal(result.missingPrerequisite, PROMTOOL_PREREQUISITE);
    assert.equal(result.kind, 'runtime');
  });

  it('the exported metric set includes default, subsystem, recording-rule, and built-in series', () => {
    const exported = buildExportedMetricSet();
    // Default HTTP/process metrics (histogram expanded to _bucket).
    assert.ok(exported.has('http_requests_total'));
    assert.ok(exported.has('http_request_duration_seconds_bucket'));
    assert.ok(exported.has('process_heap_bytes'));
    // Subsystem metrics.
    assert.ok(exported.has('db_query_duration_seconds_bucket'));
    assert.ok(exported.has('kafka_consumer_lag'));
    assert.ok(exported.has('rabbitmq_queue_depth'));
    assert.ok(exported.has('plugin_signature_failures_total'));
    // Recording-rule outputs consumed by dashboards/alerts.
    assert.ok(exported.has('job:http_error_rate:ratio5m'));
    // Prometheus built-in series.
    assert.ok(exported.has('up'));
  });

  it('the offline validation pipeline passes on the real default pack (no fabricated references)', () => {
    const result = runOfflineValidations();
    assert.deepEqual(result.violations, [], `fabricated metric references: ${JSON.stringify(result.violations)}`);
    assert.deepEqual(result.errors, [], `validation errors: ${result.errors.join('; ')}`);
    assert.equal(result.ok, true);
  });
});
