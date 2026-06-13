# @streetjs/search

Official Street Framework search module: a **provider-based search API** —
indexing, ranked queries, equality filters, facet counts, and prefix
suggestions — with an in-memory default and a PostgreSQL full-text-search
adapter.

- One `SearchService` API, swappable providers
- Ranked search, attribute filters, facet counts, pagination
- Prefix suggestions (autocomplete)
- `InMemorySearchProvider` (default, zero-dep) and `PgSearchProvider` (Postgres FTS)

## Install

```bash
npm install @streetjs/search streetjs
```

## Quick start (in-memory)

```ts
import { SearchService } from '@streetjs/search';

const search = new SearchService(); // in-memory provider by default

await search.indexAll([
  { id: '1', text: 'The quick brown fox', attributes: { kind: 'animal', color: 'brown' } },
  { id: '2', text: 'A red sports car',    attributes: { kind: 'vehicle', color: 'red' } },
]);

await search.search('quick fox');                       // ranked hits
await search.search('red', { filter: { kind: 'vehicle' } });
await search.search('quick', { facets: ['color'] });    // result.facets.color = [{ value, count }]
await search.search('fox', { limit: 10, offset: 0 });
await search.suggest('qu');                              // ['quick', …]
```

## PostgreSQL full-text search

```ts
import { PgPool } from 'streetjs';
import { SearchService, PgSearchProvider, SEARCH_MIGRATION_SQL } from '@streetjs/search';

const pool = new PgPool({ /* … */ });
await pool.query(SEARCH_MIGRATION_SQL);

const search = new SearchService({
  provider: new PgSearchProvider(pool, { indexName: 'products', config: 'english' }),
});
```

`PgSearchProvider` uses `to_tsvector`/`plainto_tsquery` + `ts_rank`, filters and
facets via a JSONB `attributes` column, and a GIN index on the `tsvector`.

## Providers compared

| | InMemorySearchProvider | PgSearchProvider |
|---|---|---|
| matching | exact lowercased tokens | `tsquery` with **stemming** (`english`) |
| ranking | summed term frequency | `ts_rank` |
| filters / facets | attribute equality | JSONB `attributes` |
| scale | small / single instance | production datasets |

> Note: ranking *scores* are provider-specific; treat them as relative, not
> portable. Result membership and ordering semantics are consistent.

## Roadmap

Meilisearch and Elasticsearch providers implement the same `SearchProvider`
interface and are tracked as follow-ups; application code does not change when
swapping providers.

## API

- `new SearchService({ provider? })`
- `index(doc)` / `indexAll(docs)` / `remove(id)` / `clear()`
- `search(query, { limit?, offset?, filter?, facets? })` → `SearchResult`
- `suggest(prefix, { limit? })` → `string[]`
- helper: `tokenize(text)`

Providers: `InMemorySearchProvider`, `PgSearchProvider`. Schema: `SEARCH_MIGRATION_SQL`.

## Testing

```bash
npm run test -w packages/search       # unit + property tests (no DB)
PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street PG_PASSWORD=street_secret \
  PG_DATABASE=street_test npm run test -w packages/search
```

## License

MIT
