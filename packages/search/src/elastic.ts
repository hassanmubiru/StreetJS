// packages/search/src/elastic.ts
// Elasticsearch-backed SearchProvider. Implements the same SearchProvider
// contract as the in-memory, Postgres, and Meilisearch providers.
//
// Documents are flattened ({ id, text, ...attributes }). Full-text uses a
// `match` query on `text`; equality filters and facets use the `.keyword`
// sub-field that ES's dynamic mapping creates for string fields. Writes use
// `refresh=wait_for` so reads are immediately consistent.

import type {
  SearchProvider, SearchDocument, SearchResult, SearchHit, FacetValue, ResolvedSearchOptions, AttributeValue,
} from './index.js';
import { tokenize } from './index.js';
import type { FetchLike } from './meili.js';

export interface ElasticsearchProviderOptions {
  host: string;
  index: string;
  apiKey?: string;
  username?: string;
  password?: string;
  fetch?: FetchLike;
}

export class ElasticsearchProvider implements SearchProvider {
  readonly name = 'elasticsearch';
  private readonly host: string;
  private readonly indexName: string;
  private readonly authHeader: string | undefined;
  private readonly fetch: FetchLike;

  constructor(options: ElasticsearchProviderOptions) {
    this.host = options.host.replace(/\/$/, '');
    this.indexName = options.index;
    if (options.apiKey) this.authHeader = `ApiKey ${options.apiKey}`;
    else if (options.username) this.authHeader = `Basic ${Buffer.from(`${options.username}:${options.password ?? ''}`).toString('base64')}`;
    const g = (globalThis as { fetch?: unknown }).fetch;
    this.fetch = options.fetch ?? (g as FetchLike);
    if (typeof this.fetch !== 'function') throw new Error('ElasticsearchProvider: no fetch available');
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.authHeader ? { authorization: this.authHeader } : {}) };
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetch(`${this.host}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) throw new Error(`elasticsearch ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return json;
  }

  async index(doc: SearchDocument): Promise<void> {
    await this.call('PUT', `/${this.indexName}/_doc/${encodeURIComponent(doc.id)}?refresh=wait_for`, {
      id: doc.id,
      text: doc.text,
      ...(doc.attributes ?? {}),
    });
  }

  async indexAll(docs: SearchDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const lines: string[] = [];
    for (const d of docs) {
      lines.push(JSON.stringify({ index: { _index: this.indexName, _id: d.id } }));
      lines.push(JSON.stringify({ id: d.id, text: d.text, ...(d.attributes ?? {}) }));
    }
    const res = await this.fetch(`${this.host}/_bulk?refresh=wait_for`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson', ...(this.authHeader ? { authorization: this.authHeader } : {}) },
      body: lines.join('\n') + '\n',
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok || json['errors'] === true) {
      throw new Error(`elasticsearch bulk index failed: ${JSON.stringify(json).slice(0, 300)}`);
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.call('DELETE', `/${this.indexName}/_doc/${encodeURIComponent(id)}?refresh=wait_for`);
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    await this.call('POST', `/${this.indexName}/_delete_by_query?refresh=true&conflicts=proceed`, {
      query: { match_all: {} },
    });
  }

  async search(query: string, options: ResolvedSearchOptions): Promise<SearchResult> {
    const must = query.trim().length > 0 ? [{ match: { text: query } }] : [{ match_all: {} }];
    const filter = Object.entries(options.filter).map(([k, v]) => ({ term: { [`${k}.keyword`]: String(v) } }));
    const body: Record<string, unknown> = {
      from: options.offset,
      size: options.limit,
      track_total_hits: true,
      query: { bool: { must, filter } },
    };
    if (options.facets.length) {
      body['aggs'] = Object.fromEntries(options.facets.map((f) => [f, { terms: { field: `${f}.keyword`, size: 100 } }]));
    }

    const json = await this.call('POST', `/${this.indexName}/_search`, body);
    const hitsObj = (json['hits'] as Record<string, unknown>) ?? {};
    const rawHits = (hitsObj['hits'] as Array<Record<string, unknown>>) ?? [];
    const hits: SearchHit[] = rawHits.map((h) => ({
      id: String(h['_id']),
      score: typeof h['_score'] === 'number' ? (h['_score'] as number) : 0,
      document: sourceToDocument(h['_source'] as Record<string, unknown>),
    }));
    const totalObj = hitsObj['total'] as { value?: number } | number | undefined;
    const total = typeof totalObj === 'number' ? totalObj : Number(totalObj?.value ?? hits.length);

    const result: SearchResult = { hits, total };
    const aggs = json['aggregations'] as Record<string, { buckets?: Array<{ key: unknown; doc_count: number }> }> | undefined;
    if (options.facets.length && aggs) {
      result.facets = {};
      for (const field of options.facets) {
        const buckets = aggs[field]?.buckets ?? [];
        result.facets[field] = buckets
          .map((b) => ({ value: String(b.key), count: b.doc_count }))
          .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1)) as FacetValue[];
      }
    }
    return result;
  }

  async suggest(prefix: string, limit: number): Promise<string[]> {
    const p = prefix.toLowerCase();
    if (p.length === 0) return [];
    const json = await this.call('POST', `/${this.indexName}/_search`, {
      size: 50,
      query: { match_phrase_prefix: { text: prefix } },
    });
    const rawHits = ((json['hits'] as Record<string, unknown>)?.['hits'] as Array<Record<string, unknown>>) ?? [];
    const freq = new Map<string, number>();
    for (const h of rawHits) {
      const src = (h['_source'] as Record<string, unknown>) ?? {};
      for (const tok of new Set(tokenize(String(src['text'] ?? '')))) {
        if (tok.startsWith(p)) freq.set(tok, (freq.get(tok) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([term]) => term);
  }
}

function sourceToDocument(src: Record<string, unknown>): SearchDocument {
  const attributes: Record<string, AttributeValue> = {};
  for (const [k, v] of Object.entries(src ?? {})) {
    if (k === 'id' || k === 'text') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') attributes[k] = v;
  }
  return { id: String(src?.['id']), text: String(src?.['text'] ?? ''), attributes };
}
