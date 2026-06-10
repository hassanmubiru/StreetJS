// tests/dast-counts-pbt.test.ts
// Property-based test for the DAST per-severity finding counts (Req 3.7).
// Kept in its own file so the universal "counts are an exact tally" property is
// exercised across many generated DastFinding[] inputs without clobbering the
// gate property in dast-gate-pbt.test.ts or the unit tests in dast.test.ts.
//
// The DAST subsystem records the scan outcome in a Verification Artifact that
// includes the count of findings at each severity level: Critical, High,
// Medium, Low, and Informational (Req 3.7). Both summarizeFindings() and the
// `counts` recorded inside buildDastArtifact() must be an EXACT tally of the
// supplied findings:
//   - the sum of all per-severity counts equals findings.length, and
//   - each severity's count equals the number of findings of that severity.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  summarizeFindings,
  buildDastArtifact,
  type DastFinding,
  type DastSeverity,
} from '../security/dast.js';

const NUM_RUNS = 100;

// All five severities the DAST pipeline recognizes, lowest -> highest:
// Informational, Low, Medium, High, Critical (Req 3.7).
const ALL_SEVERITIES: readonly DastSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

// ── Oracle ──────────────────────────────────────────────────────────────────
//
// An independent tally of findings by severity, computed without touching the
// implementation under test, so the property compares two expressions of the
// same spec rather than the implementation against itself.
function oracleCounts(findings: DastFinding[]): Record<DastSeverity, number> {
  const counts: Record<DastSeverity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

// ── Generators ────────────────────────────────────────────────────────────────
//
// A DastFinding generator spanning all five severities (uniformly, so each
// severity is sampled frequently), with arbitrary tool/name/url so the tally is
// shown to depend ONLY on severity. The array is allowed to be empty so the
// "no findings -> all zero" case is exercised.
const severityArb: fc.Arbitrary<DastSeverity> = fc.constantFrom(...ALL_SEVERITIES);

const findingArb: fc.Arbitrary<DastFinding> = fc.record({
  tool: fc.constantFrom('schemathesis', 'owasp-zap', 'openapi-conformance', 'custom'),
  name: fc.string(),
  severity: severityArb,
  url: fc.option(fc.webUrl(), { nil: undefined }),
  description: fc.option(fc.string(), { nil: undefined }),
}) as fc.Arbitrary<DastFinding>;

const findingsArb: fc.Arbitrary<DastFinding[]> = fc.array(findingArb, { maxLength: 50 });

// Feature: platform-leadership-gaps, Property 6: Severity counts are an exact tally
// Validates: Requirements 3.7
describe('Property 6: severity counts are an exact tally', () => {
  it('summarizeFindings counts each severity exactly and sums to findings.length', () => {
    fc.assert(
      fc.property(findingsArb, (findings) => {
        const counts = summarizeFindings(findings);
        const expected = oracleCounts(findings);

        // Each severity count equals the number of findings of that severity.
        for (const sev of ALL_SEVERITIES) {
          assert.equal(counts[sev], expected[sev]);
        }

        // The sum of the per-severity counts equals the total number of findings.
        const total = ALL_SEVERITIES.reduce((acc, sev) => acc + counts[sev], 0);
        assert.equal(total, findings.length);

        // No extra severity buckets leaked in.
        assert.deepEqual(Object.keys(counts).sort(), [...ALL_SEVERITIES].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the artifact details.counts are the same exact tally', () => {
    fc.assert(
      fc.property(findingsArb, (findings) => {
        const artifact = buildDastArtifact(findings, { endpointsScanned: 1, endpointsTotal: 1 });
        const details = artifact.details as unknown as { counts: Record<DastSeverity, number> };
        const expected = oracleCounts(findings);

        for (const sev of ALL_SEVERITIES) {
          assert.equal(details.counts[sev], expected[sev]);
        }

        const total = ALL_SEVERITIES.reduce((acc, sev) => acc + details.counts[sev], 0);
        assert.equal(total, findings.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
