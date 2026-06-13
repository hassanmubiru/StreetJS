// search-pbt.test.ts
// Property-based tests for the in-memory provider against a reference model.
//
// Properties:
//   P1 (recall + ranking): the result set for a single-term query equals the
//      set of docs containing that token, ordered by term frequency desc.
//   P2 (filter soundness): every hit satisfies all equality filters.
//   P3 (facet totals): the sum of a facet's counts equals the number of matches
//      that carry that attribute.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { SearchService, tokenize } from '../index.js';

const WORDS = ['alpha', 'beta', 'gamma', 'delta'];
const COLORS = ['red', 'green', 'blue'];

const docArb = fc.record({
  id: fc.integer({ min: 0, max: 999 }).map((n) => `d${n}`),
  words: fc.array(fc.constantFrom(...WORDS), { minLength: 0, maxLength: 8 }),
  color: fc.constantFrom(...COLORS),
});

describe('Property: in-memory search matches a reference model', () => {
  it('P1+P2+P3: recall, ranking, filters, and facet totals hold', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(docArb, { selector: (d) => d.id, maxLength: 25 }),
        fc.constantFrom(...WORDS),
        fc.option(fc.constantFrom(...COLORS), { nil: undefined }),
        async (rawDocs, term, colorFilter) => {
          const svc = new SearchService();
          const docs = rawDocs.map((d) => ({
            id: d.id,
            text: d.words.join(' '),
            attributes: { color: d.color },
          }));
          await svc.indexAll(docs);

          const filter = colorFilter ? { color: colorFilter } : {};
          const res = await svc.search(term, { limit: 1000, filter, facets: ['color'] });

          // Reference: docs containing the term (and passing the filter), with tf.
          const model = docs
            .filter((d) => !colorFilter || d.attributes.color === colorFilter)
            .map((d) => ({ id: d.id, tf: tokenize(d.text).filter((t) => t === term).length }))
            .filter((m) => m.tf > 0);

          // P1: same set of ids.
          assert.deepEqual(
            res.hits.map((h) => h.id).sort(),
            model.map((m) => m.id).sort(),
          );

          // P1: ranking is non-increasing by score, and score equals tf.
          for (let i = 1; i < res.hits.length; i++) {
            assert.ok(res.hits[i - 1]!.score >= res.hits[i]!.score, 'scores must be non-increasing');
          }
          const tfById = new Map(model.map((m) => [m.id, m.tf]));
          for (const h of res.hits) assert.equal(h.score, tfById.get(h.id));

          // P2: every hit satisfies the filter.
          if (colorFilter) {
            for (const h of res.hits) assert.equal(h.document.attributes!['color'], colorFilter);
          }

          // P3: facet counts sum to the number of hits carrying the attribute.
          const facet = res.facets!['color'] ?? [];
          const sum = facet.reduce((acc, f) => acc + f.count, 0);
          assert.equal(sum, res.hits.length);
          assert.equal(res.total, res.hits.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
