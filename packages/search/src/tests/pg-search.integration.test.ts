// pg-search.integration.test.ts
// Integration tests for the Postgres FTS provider against a live database.
// Gated on PG env vars (skips DB-free).
//
//   PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street \
//   PG_PASSWORD=street_secret PG_DATABASE=street_test \
//   npm run test -w packages/search

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool } from 'streetjs';
import { SearchService, PgSearchProvider, SEARCH_MIGRATION_SQL } from '../index.js';

const HAS_PG = Boolean(process.env['PG_HOST'] && process.env['PG_DATABASE']);

describe('PgSearchProvider (live Postgres FTS)', { skip: !HAS_PG ? 'PG_* env not set' : false }, () => {
  let pool: PgPool;
  let svc: SearchService;

  before(async () => {
    pool = new PgPool({
      host: process.env['PG_HOST']!,
      port: Number(process.env['PG_PORT'] ?? 5432),
      user: process.env['PG_USER'] ?? 'street',
      password: process.env['PG_PASSWORD'] ?? '',
      database: process.env['PG_DATABASE']!,
      maxConnections: 4,
      acquireTimeoutMs: 5_000,
    });
    await pool.query(SEARCH_MIGRATION_SQL);
    svc = new SearchService({ provider: new PgSearchProvider(pool, { indexName: 'it_search' }) });
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM street_search_documents WHERE index_name = 'it_search'`);
    await svc.indexAll([
      { id: '1', text: 'The quick brown fox', attributes: { kind: 'animal', color: 'brown' } },
      { id: '2', text: 'A quick red fox jumps', attributes: { kind: 'animal', color: 'red' } },
      { id: '3', text: 'Slow green turtle', attributes: { kind: 'animal', color: 'green' } },
      { id: '4', text: 'Quick running rabbits', attributes: { kind: 'animal', color: 'white' } },
      { id: '5', text: 'A red sports car', attributes: { kind: 'vehicle', color: 'red' } },
    ]);
  });

  after(async () => {
    await pool.query('DROP TABLE IF EXISTS street_search_documents');
    await pool.close();
  });

  it('full-text ranks matches and returns documents', async () => {
    const res = await svc.search('fox');
    assert.deepEqual(res.hits.map((h) => h.id).sort(), ['1', '2']);
    assert.equal(res.total, 2);
    assert.ok(res.hits[0]!.score > 0);
    assert.equal(res.hits[0]!.document.attributes!['kind'], 'animal');
  });

  it('stems with the english config (rabbits matches rabbit)', async () => {
    const res = await svc.search('rabbit');
    assert.deepEqual(res.hits.map((h) => h.id), ['4']);
  });

  it('applies attribute filters', async () => {
    const res = await svc.search('red', { filter: { kind: 'vehicle' } });
    assert.deepEqual(res.hits.map((h) => h.id), ['5']);
  });

  it('computes facet counts over all matches', async () => {
    const res = await svc.search('quick', { facets: ['color'] });
    assert.deepEqual(res.hits.map((h) => h.id).sort(), ['1', '2', '4']);
    const total = (res.facets!['color'] ?? []).reduce((a, f) => a + f.count, 0);
    assert.equal(total, 3);
  });

  it('paginates with limit/offset', async () => {
    const page1 = await svc.search('quick', { limit: 2 });
    assert.equal(page1.hits.length, 2);
    assert.equal(page1.total, 3);
    const page2 = await svc.search('quick', { limit: 2, offset: 2 });
    assert.equal(page2.hits.length, 1);
  });

  it('suggests prefix terms and reflects removals', async () => {
    const out = await svc.suggest('qu');
    assert.ok(out.includes('quick'));
    assert.equal(await svc.remove('4'), true);
    const res = await svc.search('quick');
    assert.deepEqual(res.hits.map((h) => h.id).sort(), ['1', '2']);
  });
});
