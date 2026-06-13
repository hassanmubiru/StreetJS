// ai-pbt.test.ts
// Property-based tests for vector math and retrieval.
//
// Properties:
//   P1 (cosine bounds & symmetry): for non-zero vectors, cosine ∈ [-1, 1],
//      sim(a,b) === sim(b,a), and sim(a,a) === 1.
//   P2 (retrieval ordering): vector-store query results are sorted by score
//      descending and contain at most k items.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { cosineSimilarity, InMemoryVectorStore, hashEmbedding } from '../index.js';

const vecArb = fc.array(fc.integer({ min: -5, max: 5 }), { minLength: 4, maxLength: 4 });

describe('Property: cosine similarity is bounded and symmetric', () => {
  it('P1: cosine ∈ [-1,1], symmetric, self-sim = 1 for non-zero vectors', () => {
    fc.assert(
      fc.property(vecArb, vecArb, (a, b) => {
        const ab = cosineSimilarity(a, b);
        assert.ok(ab >= -1.0000001 && ab <= 1.0000001, `cosine in range, got ${ab}`);
        assert.ok(Math.abs(ab - cosineSimilarity(b, a)) < 1e-9, 'symmetric');
        const nonZero = a.some((x) => x !== 0);
        if (nonZero) assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-9, 'self-similarity is 1');
      }),
      { numRuns: 300 },
    );
  });
});

describe('Property: vector store returns sorted top-k', () => {
  it('P2: results are score-descending and capped at k', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 0, max: 25 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (texts, k, query) => {
          const store = new InMemoryVectorStore();
          texts.forEach((t, i) => void store.upsert({ id: `r${i}`, text: t, embedding: hashEmbedding(t) }));
          const res = await store.query(hashEmbedding(query), k);
          assert.ok(res.length <= k, 'result capped at k');
          assert.ok(res.length <= texts.length);
          for (let i = 1; i < res.length; i++) {
            assert.ok(res[i - 1]!.score >= res[i]!.score, 'scores non-increasing');
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
