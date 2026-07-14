// packages/config/src/namespace.ts
// A namespace is a prefix-scoped read view over a resolved configuration. It
// delegates to the root reader with prefixed paths, so it holds no state and can
// never diverge from the root. Depends only on `types.ts` (no cycle with config).

import type { ConfigReaderCore, FieldMetadata, SerializeOptions } from './types.js';

/** Serialize a (already secret-masked) plain config object. Single source of truth. */
export function stringifyConfig(masked: Record<string, unknown>, options: SerializeOptions = {}): string {
  const format = options.format ?? 'json';
  if (format === 'flat') {
    const rows: string[] = [];
    flatten(masked, '', rows);
    return rows.sort().join('\n');
  }
  return JSON.stringify(masked, null, options.pretty === false ? 0 : 2);
}

function flatten(value: unknown, prefix: string, out: string[]): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.push(`${prefix}=${Array.isArray(value) ? JSON.stringify(value) : String(value)}`);
  }
}

/** Navigate a nested object by dotted path; returns `[found, value]`. */
export function navigate(obj: Record<string, unknown>, path: string): [boolean, unknown] {
  const segments = path.split('.');
  let node: unknown = obj;
  for (const seg of segments) {
    if (node !== null && typeof node === 'object' && !Array.isArray(node) && seg in (node as object)) {
      node = (node as Record<string, unknown>)[seg];
    } else {
      return [false, undefined];
    }
  }
  return [true, node];
}

/** A prefix-scoped view. Implements the same read surface as the root config. */
export class Namespace implements ConfigReaderCore {
  constructor(
    private readonly root: ConfigReaderCore,
    private readonly prefix: string,
  ) {}

  private full(path: string): string {
    return `${this.prefix}.${path}`;
  }

  get environment() {
    return this.root.environment;
  }

  get(path: string): unknown {
    return this.root.get(this.full(path));
  }

  has(path: string): boolean {
    return this.root.has(this.full(path));
  }

  keys(): string[] {
    const p = `${this.prefix}.`;
    return this.root
      .keys()
      .filter((k) => k.startsWith(p))
      .map((k) => k.slice(p.length))
      .sort();
  }

  metadata(path: string): FieldMetadata | undefined {
    const meta = this.root.metadata(this.full(path));
    return meta ? { ...meta, key: path } : undefined;
  }

  /** A nested namespace, e.g. `config.namespace('database').namespace('pool')`. */
  namespace(prefix: string): Namespace {
    return new Namespace(this.root, this.full(prefix));
  }

  toJSON(): Record<string, unknown> {
    const [found, value] = navigate(this.root.toJSON(), this.prefix);
    if (!found || value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  serialize(options?: SerializeOptions): string {
    return stringifyConfig(this.toJSON(), options);
  }
}
