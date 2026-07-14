// packages/config/src/metadata.ts
// Immutable registry of per-key resolution metadata, built by the loader and
// exposed read-only via `config.metadata(path)`.

import type { FieldMetadata } from './types.js';

export class MetadataStore {
  private readonly byKey: ReadonlyMap<string, FieldMetadata>;

  constructor(entries: Iterable<FieldMetadata>) {
    const map = new Map<string, FieldMetadata>();
    for (const e of entries) map.set(e.key, Object.freeze({ ...e }));
    this.byKey = map;
  }

  get(key: string): FieldMetadata | undefined {
    return this.byKey.get(key);
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  keys(): string[] {
    return [...this.byKey.keys()].sort();
  }

  all(): FieldMetadata[] {
    return this.keys().map((k) => this.byKey.get(k)!);
  }

  /** Metadata for a namespace prefix, re-keyed relative to the prefix. */
  scoped(prefix: string): MetadataStore {
    const p = `${prefix}.`;
    const scoped: FieldMetadata[] = [];
    for (const [key, meta] of this.byKey) {
      if (key.startsWith(p)) scoped.push({ ...meta, key: key.slice(p.length) });
    }
    return new MetadataStore(scoped);
  }
}
