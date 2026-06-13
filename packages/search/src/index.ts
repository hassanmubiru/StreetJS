// packages/search/src/index.ts
// Official Street Framework search module: @streetjs/search.
//
// A provider-based search API: index documents, run ranked full-text queries,
// apply equality filters, compute facet counts, and offer prefix suggestions.
//
//   * SearchService.index / indexAll / remove / clear
//   * SearchService.search(query, { limit, offset, filter, facets })
//   * SearchService.suggest(prefix, { limit })
//
// Two providers ship:
//   * InMemorySearchProvider — exact (lowercased) token matching with term-
//     frequency ranking. Zero dependencies; the default for tests/examples.
//   * PgSearchProvider — PostgreSQL full-text search (`tsvector`/`ts_rank`,
//     'english' config with stemming) over {@link SEARCH_MIGRATION_SQL}.
//
// Both implement the same {@link SearchProvider} contract, so application code
// is provider-agnostic. Ranking details differ by provider (PG stems; the
// in-memory provider matches exact lowercased tokens) — documented per provider.

// ── Migration SQL ─────────────────────────────────────────────────────────────

/** Schema for the Postgres FTS provider. Apply once at bootstrap. */
export const SEARCH_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_search_documents (
  index_name TEXT NOT NULL,
  id         TEXT NOT NULL,
  text       TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  tsv        TSVECTOR,
  PRIMARY KEY (index_name, id)
);
CREATE INDEX IF NOT EXISTS street_search_documents_tsv_idx
  ON street_search_documents USING GIN (tsv);
`.trim();

// ── Types ─────────────────────────────────────────────────────────────────────

/** A primitive attribute value usable for filtering and faceting. */
export type AttributeValue = string | number | boolean;

/** A document to index. `text` is the searchable content. */
export interface SearchDocument {
  id: string;
  text: string;
  /** Structured attributes for equality filters and facet counts. */
  attributes?: Record<string, AttributeValue>;
}

/** A single ranked match. */
export interface SearchHit {
  id: string;
  /** Provider-specific relevance score; higher is more relevant. */
  score: number;
  document: SearchDocument;
}

/** One facet bucket: a value and how many matches carry it. */
export interface FacetValue {
  value: string;
  count: number;
}

/** A search result page. */
export interface SearchResult {
  hits: SearchHit[];
  /** Total matches before limit/offset. */
  total: number;
  /** Facet counts per requested attribute field (over all matches). */
  facets?: Record<string, FacetValue[]>;
}

/** Options for {@link SearchService.search}. */
export interface SearchOptions {
  /** Max hits to return. Default 10, clamped to [1, 100]. */
  limit?: number;
  /** Hits to skip (pagination). Default 0. */
  offset?: number;
  /** Equality filters on attributes (all must match). */
  filter?: Record<string, AttributeValue>;
  /** Attribute fields to compute facet counts for (over all matches). */
  facets?: string[];
}

/** Options for {@link SearchService.suggest}. */
export interface SuggestOptions {
  /** Max suggestions. Default 10, clamped to [1, 50]. */
  limit?: number;
}

/** Pluggable search backend. */
export interface SearchProvider {
  index(doc: SearchDocument): Promise<void>;
  indexAll(docs: SearchDocument[]): Promise<void>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
  search(query: string, options: ResolvedSearchOptions): Promise<SearchResult>;
  suggest(prefix: string, limit: number): Promise<string[]>;
}

/** Normalized options passed to providers (defaults already applied). */
export interface ResolvedSearchOptions {
  limit: number;
  offset: number;
  filter: Record<string, AttributeValue>;
  facets: string[];
}

// ── Tokenization (shared) ───────────────────────────────────────────────────────

/** Lowercase alphanumeric tokens of length >= 1. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

// ── In-memory provider (default) ───────────────────────────────────────────────

interface IndexedDoc {
  doc: SearchDocument;
  tokens: string[];
  tf: Map<string, number>;
}

/**
 * In-process search provider. Matches exact lowercased tokens (no stemming) and
 * ranks by summed term frequency of the query terms. Suitable for tests,
 * examples, and small single-instance datasets.
 */
export class InMemorySearchProvider implements SearchProvider {
  private readonly docs = new Map<string, IndexedDoc>();

  async index(doc: SearchDocument): Promise<void> {
    const tokens = tokenize(doc.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    this.docs.set(doc.id, { doc, tokens, tf });
  }

  async indexAll(docs: SearchDocument[]): Promise<void> {
    for (const d of docs) await this.index(d);
  }

  async remove(id: string): Promise<boolean> {
    return this.docs.delete(id);
  }

  async clear(): Promise<void> {
    this.docs.clear();
  }

  async search(query: string, options: ResolvedSearchOptions): Promise<SearchResult> {
    const terms = [...new Set(tokenize(query))];
    const filterEntries = Object.entries(options.filter);

    const matched: { hit: SearchHit; doc: SearchDocument }[] = [];
    for (const { doc, tf } of this.docs.values()) {
      if (!matchesFilter(doc, filterEntries)) continue;
      // Empty query with a filter acts as "match all (filtered)" with score 0.
      let score = 0;
      let anyTerm = false;
      for (const term of terms) {
        const c = tf.get(term) ?? 0;
        if (c > 0) anyTerm = true;
        score += c;
      }
      if (terms.length > 0 && !anyTerm) continue;
      matched.push({ hit: { id: doc.id, score, document: doc }, doc });
    }

    // Sort by score desc, then id asc for stable ordering.
    matched.sort((a, b) => b.hit.score - a.hit.score || (a.hit.id < b.hit.id ? -1 : a.hit.id > b.hit.id ? 1 : 0));

    const total = matched.length;
    const page = matched.slice(options.offset, options.offset + options.limit).map((m) => m.hit);

    const result: SearchResult = { hits: page, total };
    if (options.facets.length > 0) {
      result.facets = computeFacets(matched.map((m) => m.doc), options.facets);
    }
    return result;
  }

  async suggest(prefix: string, limit: number): Promise<string[]> {
    const p = prefix.toLowerCase();
    if (p.length === 0) return [];
    const freq = new Map<string, number>();
    for (const { tokens } of this.docs.values()) {
      for (const t of new Set(tokens)) {
        if (t.startsWith(p)) freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([term]) => term);
  }
}

function matchesFilter(doc: SearchDocument, filter: [string, AttributeValue][]): boolean {
  if (filter.length === 0) return true;
  const attrs = doc.attributes ?? {};
  for (const [k, v] of filter) {
    if (String(attrs[k]) !== String(v)) return false;
  }
  return true;
}

function computeFacets(docs: SearchDocument[], fields: string[]): Record<string, FacetValue[]> {
  const out: Record<string, FacetValue[]> = {};
  for (const field of fields) {
    const counts = new Map<string, number>();
    for (const d of docs) {
      const v = d.attributes?.[field];
      if (v === undefined) continue;
      const key = String(v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    out[field] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([value, count]) => ({ value, count }));
  }
  return out;
}

// ── Postgres FTS provider ────────────────────────────────────────────────────────

/** Minimal structural pool interface satisfied by Street's `PgPool`. */
export interface SearchPool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }>;
}

/** Options for {@link PgSearchProvider}. */
export interface PgSearchProviderOptions {
  /** Logical collection name (rows are scoped to it). Default 'default'. */
  indexName?: string;
  /** PostgreSQL text-search configuration. Default 'english' (stemming). */
  config?: string;
}

/**
 * PostgreSQL full-text-search provider over {@link SEARCH_MIGRATION_SQL}. Uses
 * `to_tsvector`/`plainto_tsquery` with the 'english' config (stemming), ranks
 * with `ts_rank`, filters/facets via the `attributes` JSONB column.
 */
export class PgSearchProvider implements SearchProvider {
  private readonly indexName: string;
  private readonly config: string;

  constructor(private readonly pool: SearchPool, options: PgSearchProviderOptions = {}) {
    this.indexName = options.indexName ?? 'default';
    // config is a fixed identifier; restrict to a safe identifier charset.
    const cfg = options.config ?? 'english';
    if (!/^[a-z_][a-z0-9_]*$/i.test(cfg)) {
      throw new Error(`PgSearchProvider: invalid text-search config "${cfg}"`);
    }
    this.config = cfg;
  }

  async index(doc: SearchDocument): Promise<void> {
    await this.pool.query(
      `INSERT INTO street_search_documents (index_name, id, text, attributes, tsv)
       VALUES ($1, $2, $3, $4::jsonb, to_tsvector('${this.config}', $3))
       ON CONFLICT (index_name, id)
       DO UPDATE SET text = EXCLUDED.text, attributes = EXCLUDED.attributes, tsv = EXCLUDED.tsv`,
      [this.indexName, doc.id, doc.text, JSON.stringify(doc.attributes ?? {})],
    );
  }

  async indexAll(docs: SearchDocument[]): Promise<void> {
    for (const d of docs) await this.index(d);
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM street_search_documents WHERE index_name = $1 AND id = $2`,
      [this.indexName, id],
    );
    return res.rowCount > 0;
  }

  async clear(): Promise<void> {
    await this.pool.query(`DELETE FROM street_search_documents WHERE index_name = $1`, [this.indexName]);
  }

  async search(query: string, options: ResolvedSearchOptions): Promise<SearchResult> {
    const { clause, params } = this.buildWhere(query, options.filter);

    // total
    const countRes = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM street_search_documents WHERE ${clause}`,
      params,
    );
    const total = Number(countRes.rows[0]?.['n'] ?? 0);

    // page (rank desc). $2 holds the query string for ranking.
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const rows = await this.pool.query(
      `SELECT id, text, attributes,
              ts_rank(tsv, plainto_tsquery('${this.config}', $2)) AS score
       FROM street_search_documents
       WHERE ${clause}
       ORDER BY score DESC, id ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, options.limit, options.offset],
    );

    const hits: SearchHit[] = rows.rows.map((r) => ({
      id: String(r['id']),
      score: Number(r['score']),
      document: rowToDocument(r),
    }));

    const result: SearchResult = { hits, total };
    if (options.facets.length > 0) {
      result.facets = {};
      for (const field of options.facets) {
        const fres = await this.pool.query(
          `SELECT (attributes->>$${params.length + 1}) AS value, COUNT(*)::int AS n
           FROM street_search_documents
           WHERE ${clause} AND (attributes ? $${params.length + 1})
           GROUP BY value ORDER BY n DESC, value ASC`,
          [...params, field],
        );
        result.facets[field] = fres.rows
          .filter((r) => r['value'] != null)
          .map((r) => ({ value: String(r['value']), count: Number(r['n']) }));
      }
    }
    return result;
  }

  async suggest(prefix: string, limit: number): Promise<string[]> {
    const p = prefix.toLowerCase();
    if (p.length === 0) return [];
    const res = await this.pool.query(
      `SELECT word, COUNT(*)::int AS n FROM (
         SELECT DISTINCT id, lower((regexp_matches(text, '[A-Za-z0-9]+', 'g'))[1]) AS word
         FROM street_search_documents WHERE index_name = $1
       ) t
       WHERE word LIKE $2 || '%'
       GROUP BY word ORDER BY n DESC, word ASC LIMIT $3`,
      [this.indexName, p, limit],
    );
    return res.rows.map((r) => String(r['word']));
  }

  /** Build the shared WHERE clause + params. $1 = index, $2 = query string. */
  private buildWhere(query: string, filter: Record<string, AttributeValue>): { clause: string; params: unknown[] } {
    const params: unknown[] = [this.indexName, query];
    const clauses = [`index_name = $1`];
    // Empty query => match all (within filters); otherwise require a tsquery match.
    if (query.trim().length > 0) {
      clauses.push(`tsv @@ plainto_tsquery('${this.config}', $2)`);
    }
    for (const [k, v] of Object.entries(filter)) {
      const ki = params.push(k);
      const vi = params.push(String(v));
      clauses.push(`(attributes->>$${ki}) = $${vi}`);
    }
    return { clause: clauses.join(' AND '), params };
  }
}

function rowToDocument(row: Record<string, unknown>): SearchDocument {
  const raw = row['attributes'];
  let attributes: Record<string, AttributeValue> = {};
  if (typeof raw === 'string' && raw.length > 0) attributes = JSON.parse(raw) as Record<string, AttributeValue>;
  else if (raw && typeof raw === 'object') attributes = raw as Record<string, AttributeValue>;
  return { id: String(row['id']), text: String(row['text']), attributes };
}

// ── SearchService ─────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const DEFAULT_SUGGEST_LIMIT = 10;
const MAX_SUGGEST_LIMIT = 50;

/** Options for {@link SearchService}. */
export interface SearchServiceOptions {
  /** Backend. Defaults to {@link InMemorySearchProvider}. */
  provider?: SearchProvider;
}

/** Provider-agnostic search facade with validation and option normalization. */
export class SearchService {
  private readonly provider: SearchProvider;

  constructor(options: SearchServiceOptions = {}) {
    this.provider = options.provider ?? new InMemorySearchProvider();
  }

  /** Index (or re-index) a single document. */
  async index(doc: SearchDocument): Promise<void> {
    return this.provider.index(validateDoc(doc));
  }

  /** Index (or re-index) many documents. */
  async indexAll(docs: SearchDocument[]): Promise<void> {
    if (!Array.isArray(docs)) throw new Error('SearchService.indexAll: docs must be an array');
    return this.provider.indexAll(docs.map(validateDoc));
  }

  /** Remove a document by id. Returns whether one was removed. */
  async remove(id: string): Promise<boolean> {
    return this.provider.remove(requireId(id, 'id'));
  }

  /** Remove all documents from the index. */
  async clear(): Promise<void> {
    return this.provider.clear();
  }

  /** Run a ranked search with optional filters and facets. */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    if (typeof query !== 'string') throw new Error('SearchService.search: query must be a string');
    return this.provider.search(query, {
      limit: clamp(options.limit, DEFAULT_LIMIT, MAX_LIMIT),
      offset: options.offset && options.offset > 0 ? Math.floor(options.offset) : 0,
      filter: options.filter ?? {},
      facets: options.facets ?? [],
    });
  }

  /** Prefix suggestions (autocomplete) drawn from indexed terms. */
  async suggest(prefix: string, options: SuggestOptions = {}): Promise<string[]> {
    if (typeof prefix !== 'string') throw new Error('SearchService.suggest: prefix must be a string');
    return this.provider.suggest(prefix, clamp(options.limit, DEFAULT_SUGGEST_LIMIT, MAX_SUGGEST_LIMIT));
  }
}

function clamp(value: number | undefined, dflt: number, max: number): number {
  if (value === undefined) return dflt;
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), max);
}

function validateDoc(doc: SearchDocument): SearchDocument {
  requireId(doc?.id, 'document id');
  if (typeof doc?.text !== 'string') throw new Error('SearchService: document text must be a string');
  return doc;
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`SearchService: ${field} must be a non-empty string`);
  }
  return value;
}

export * from './meili.js';
