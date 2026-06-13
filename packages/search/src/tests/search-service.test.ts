// search-service.test.ts
// Example/edge-case unit tests for the in-memory search provider.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SearchService, tokenize } from '../index.js';

const DOCS = [
  { id: '1', text: 'The quick brown fox', attributes: { kind: 'animal', color: 'brown' } },
  { id: '2', text: 'A quick red fox jumps', attributes: { kind: 'animal', color: 'red' } },
  { id: '3', text: 'Slow green turtle', attributes: { kind: 'animal', color: 'green' } },
  { id: '4', text: 'Quick quick quick rabbit', attributes: { kind: 'animal', color: 'white' } },
  { id: '5', text: 'A red sports car', attributes: { kind: 'vehicle', color: 'red' } },
];

async function seeded() {
  const svc = new SearchService();
  await svc.indexAll(DOCS);
  return svc;
}

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    assert.deepEqual(tokenize('The Quick, brown-FOX!'), ['the', 'quick', 'brown', 'fox']);
    assert.deepEqual(tokenize('  '), []);
  });
});

describe('SearchService (in-memory)', () => {
  it('returns matching documents ranked by term frequency', async () => {
    const svc = await seeded();
    const res = await svc.search('quick');
    // doc 4 has "quick" x3, others x1 → doc 4 ranks first.
    assert.equal(res.hits[0]!.id, '4');
    assert.deepEqual(res.hits.map((h) => h.id).sort(), ['1', '2', '4']);
    assert.equal(res.total, 3);
  });

  it('supports multi-term queries (union, summed score)', async () => {
    const svc = await seeded();
    const res = await svc.search('red fox');
    // doc 2 has both red+fox (score 2), doc 1 has fox (1), doc 5 has red (1).
    assert.equal(res.hits[0]!.id, '2');
    assert.deepEqual(res.hits.map((h) => h.id).sort(), ['1', '2', '5']);
  });

  it('applies equality filters on attributes', async () => {
    const svc = await seeded();
    const res = await svc.search('red', { filter: { kind: 'vehicle' } });
    assert.deepEqual(res.hits.map((h) => h.id), ['5']);
  });

  it('computes facet counts over all matches', async () => {
    const svc = await seeded();
    const res = await svc.search('quick', { facets: ['color'] });
    // matches: 1(brown), 2(red), 4(white)
    assert.deepEqual(res.facets!['color'], [
      { value: 'brown', count: 1 },
      { value: 'red', count: 1 },
      { value: 'white', count: 1 },
    ]);
  });

  it('paginates with limit and offset over a stable order', async () => {
    const svc = await seeded();
    const page1 = await svc.search('quick', { limit: 2 });
    assert.equal(page1.hits.length, 2);
    assert.equal(page1.total, 3);
    const page2 = await svc.search('quick', { limit: 2, offset: 2 });
    assert.equal(page2.hits.length, 1);
    const all = [...page1.hits, ...page2.hits].map((h) => h.id);
    assert.equal(new Set(all).size, 3, 'no overlap across pages');
  });

  it('empty query with a filter matches all filtered docs (score 0)', async () => {
    const svc = await seeded();
    const res = await svc.search('', { filter: { kind: 'vehicle' } });
    assert.deepEqual(res.hits.map((h) => h.id), ['5']);
    assert.equal(res.hits[0]!.score, 0);
  });

  it('suggest returns prefix matches ranked by document frequency', async () => {
    const svc = await seeded();
    const out = await svc.suggest('qu');
    assert.deepEqual(out, ['quick']);
    assert.deepEqual(await svc.suggest('re'), ['red']);
    assert.deepEqual(await svc.suggest('zz'), []);
  });

  it('remove and re-index update results', async () => {
    const svc = await seeded();
    assert.equal(await svc.remove('4'), true);
    const res = await svc.search('quick');
    assert.deepEqual(res.hits.map((h) => h.id).sort(), ['1', '2']);
    await svc.index({ id: '6', text: 'quick quick', attributes: {} });
    assert.equal((await svc.search('quick')).total, 3);
  });

  it('validates input', async () => {
    const svc = new SearchService();
    await assert.rejects(() => svc.index({ id: '', text: 'x' }), /document id/);
    await assert.rejects(() => svc.index({ id: '1', text: 123 as never }), /text must be a string/);
    await assert.rejects(() => svc.remove(''), /id must be/);
  });
});
