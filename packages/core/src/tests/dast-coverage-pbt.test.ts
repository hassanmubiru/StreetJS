// tests/dast-coverage-pbt.test.ts
// Property-based test for DAST scan coverage (Req 3.2).
// Kept in its own file so the universal coverage property is exercised across
// many generated OpenAPI documents without clobbering the example/edge-case
// unit tests in dast.test.ts.
//
// Requirement 3.2 demands the DAST subsystem scan 100% of the
// OpenAPI-enumerated endpoints. This file proves two things across arbitrary
// valid OpenAPI documents:
//   1. `openApiOperations(doc)` enumerates EXACTLY the set of (method, path)
//      operations declared by the document — every enumerated operation is
//      present, none is omitted, and no non-operation key leaks in.
//   2. `buildDastArtifact` accounts for that coverage faithfully:
//      `endpointsTotal` equals the enumerated operation count, `endpointsScanned`
//      reflects what was scanned, and a clean (VERIFIED, exit-code-0) run is
//      reached IFF scan coverage is full (scanned >= total, total > 0).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  openApiOperations,
  validateOpenApiDocument,
  buildDastArtifact,
  type OpenApiOperationTarget,
} from '../security/dast.js';

const NUM_RUNS = 100;

// The eight HTTP methods the DAST enumerator recognizes as operations. Any
// other path-item key (e.g. "summary", "parameters") is metadata, not an
// operation, and must be excluded from coverage.
const HTTP_METHOD_NAMES = [
  'get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace',
] as const;

// ── Oracle ────────────────────────────────────────────────────────────────────
//
// An independent reimplementation of the documented enumeration contract: walk
// every path, and for every key that names an HTTP method emit one
// (METHOD, path) operation. We keep the method set local so the property
// compares two expressions of the same spec rather than the implementation
// against itself.
function oracleOperations(doc: {
  paths: Record<string, Record<string, unknown>>;
}): OpenApiOperationTarget[] {
  const ops: OpenApiOperationTarget[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const key of Object.keys(item)) {
      if ((HTTP_METHOD_NAMES as readonly string[]).includes(key.toLowerCase())) {
        ops.push({ method: key.toUpperCase(), path });
      }
    }
  }
  return ops;
}

/** Stable, comparable key for an operation. */
const opKey = (o: OpenApiOperationTarget): string => `${o.method} ${o.path}`;

// ── Generators ────────────────────────────────────────────────────────────────
//
// A valid OpenAPI 3.x document with a non-empty, unique set of paths. Each path
// item carries:
//   - a (possibly empty) UNIQUE subset of HTTP methods, each mapped to a minimal
//     operation object — these are the operations that must be scanned, and
//   - a non-operation "summary" metadata key that must NOT count as coverage.
// Allowing empty method subsets exercises the zero-operation edge (total === 0).

const pathArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom('users', 'items', '{id}', 'orders', 'auth', 'files', 'admin', 'upload'), {
    minLength: 1,
    maxLength: 4,
  })
  .map((segments) => '/' + segments.join('/'));

const methodsArb: fc.Arbitrary<string[]> = fc.uniqueArray(
  fc.constantFrom(...HTTP_METHOD_NAMES),
  { maxLength: HTTP_METHOD_NAMES.length },
);

interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
}

const docArb: fc.Arbitrary<OpenApiDoc> = fc
  .uniqueArray(pathArb, { minLength: 1, maxLength: 8 })
  .chain((paths) =>
    fc.tuple(...paths.map(() => methodsArb)).map((methodLists) => {
      const pathsObj: Record<string, Record<string, unknown>> = {};
      paths.forEach((p, i) => {
        const item: Record<string, unknown> = {
          // A non-operation metadata key that must be excluded from coverage.
          summary: 'a path',
        };
        for (const m of methodLists[i] as string[]) {
          item[m] = { responses: { '200': { description: 'ok' } } };
        }
        pathsObj[p] = item;
      });
      return {
        openapi: '3.0.3',
        info: { title: 'coverage', version: '1.0.0' },
        paths: pathsObj,
      };
    }),
  );

// Feature: platform-leadership-gaps, Property 7: Scan coverage equals the enumerated operation set
// Validates: Requirements 3.2
describe('Property 7: scan coverage equals the enumerated operation set', () => {
  it('openApiOperations enumerates exactly the declared (method, path) operations — none omitted, none extra', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        // Guard: only valid OpenAPI documents are in scope for this property.
        assert.equal(validateOpenApiDocument(doc).valid, true);

        const actual = openApiOperations(doc);
        const expected = oracleOperations(doc);

        const actualKeys = actual.map(opKey).sort();
        const expectedKeys = expected.map(opKey).sort();

        // Same multiset of operations (and, since keys are unique per path-item,
        // the same set) — every enumerated operation is present and nothing is
        // duplicated or omitted.
        assert.deepEqual(actualKeys, expectedKeys);

        // No operation is invented: every scanned operation traces back to a
        // declared HTTP method on its path.
        const expectedSet = new Set(expectedKeys);
        for (const op of actual) {
          assert.ok(expectedSet.has(opKey(op)));
          assert.ok((HTTP_METHOD_NAMES as readonly string[]).includes(op.method.toLowerCase()));
        }

        // No duplicate coverage: the enumerated count equals the distinct count.
        assert.equal(actualKeys.length, new Set(actualKeys).size);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('buildDastArtifact records total = enumerated count, reflects scanned, and is clean IFF coverage is full', () => {
    fc.assert(
      fc.property(
        docArb,
        // A fraction in [0,1] that selects how many of the enumerated endpoints
        // were actually scanned; spans no coverage, partial coverage, and full.
        fc.double({ min: 0, max: 1, noNaN: true }),
        (doc, fraction) => {
          const enumerated = openApiOperations(doc);
          const total = enumerated.length;
          const scanned = Math.round(fraction * total);

          // No findings, so the severity gate passes: the run's cleanliness then
          // hinges solely on coverage.
          const artifact = buildDastArtifact([], {
            endpointsScanned: scanned,
            endpointsTotal: total,
          });
          const details = artifact.details as unknown as {
            endpointsScanned: number;
            endpointsTotal: number;
          };

          // endpointsTotal equals the enumerated operation set's size (Req 3.2).
          assert.equal(details.endpointsTotal, total);
          // endpointsScanned reflects exactly what was scanned.
          assert.equal(details.endpointsScanned, scanned);

          // Full coverage IFF every enumerated endpoint was scanned (total > 0).
          const fullCoverage = total > 0 && scanned >= total;
          assert.equal(artifact.exitCode === 0, fullCoverage);
          assert.equal(artifact.status === 'VERIFIED', fullCoverage);
          // Short of full coverage (with a passing gate) the run is PARTIAL.
          if (!fullCoverage) {
            assert.equal(artifact.status, 'PARTIAL');
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
