// packages/storage/src/internal.ts
// Shared types + helpers used by both the barrel (index.ts) and the individual
// provider adapters (pg.ts, gcs.ts, azure.ts). Providers import from here — never
// from ./index.js — so the barrel does not form an import cycle with its members.

export interface PutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  data: Buffer;
  contentType: string;
  size: number;
  metadata: Record<string, string>;
}

export interface ObjectInfo {
  key: string;
  size: number;
  contentType: string;
}

/** Pluggable storage backend. Keys are forward-slash paths (e.g. `a/b.png`). */
export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer, options?: PutOptions): Promise<ObjectInfo>;
  get(key: string): Promise<StoredObject | undefined>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  list(prefix?: string): Promise<ObjectInfo[]>;
}

/** Validate an object key: non-empty, no NUL, no `..` segments, no leading `/`. */
export function validateKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('storage: key must be a non-empty string');
  }
  if (key.includes('\u0000')) throw new Error('storage: key must not contain NUL');
  if (key.startsWith('/') || key.startsWith('\\')) throw new Error('storage: key must be relative');
  const parts = key.split(/[/\\]/);
  if (parts.some((p) => p === '..')) throw new Error('storage: key must not contain ".." segments');
  return key;
}
