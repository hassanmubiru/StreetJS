// packages/config/src/secrets.ts
// Secret resolution + rotation, extending the config source model.
//
// `@streetjs/config` already loads static configuration and masks fields marked
// `.secret()`. This module adds the dynamic side: resolving secret *values* from
// pluggable backends (env, mounted files, or a cloud secret manager the app
// supplies), with caching, rotation, and an access-audit hook — plus a bridge
// `Provider` so resolved secrets flow into typed config at load time.
//
// Zero runtime dependencies. Providers are injectable, so everything is testable
// with no real secret store.

import { ConfigError } from './errors.js';
import type { Provider } from './provider.js';
import type { ConfigInput, PlainObject } from './types.js';

/**
 * A pluggable secret backend. `get` returns the secret value or `undefined` when
 * absent; it may be sync or async so cloud SDK adapters fit without ceremony.
 */
export interface SecretProvider {
  /** Stable identifier for diagnostics, e.g. `env`, `file:/run/secrets`. */
  readonly name: string;
  get(key: string): string | undefined | Promise<string | undefined>;
}

/** Read secrets from an environment map (optionally under a prefix). */
export function envSecretProvider(options: { env?: NodeJS.ProcessEnv; prefix?: string } = {}): SecretProvider {
  const env = options.env ?? process.env;
  const prefix = options.prefix ?? '';
  return {
    name: 'env',
    get(key: string): string | undefined {
      return env[`${prefix}${key}`];
    },
  };
}

/** Resolve secrets from an in-memory record (tests, or programmatic overrides). */
export function memorySecretProvider(
  secrets: Record<string, string>,
  name = 'memory',
): SecretProvider {
  return {
    name,
    get(key: string): string | undefined {
      return Object.prototype.hasOwnProperty.call(secrets, key) ? secrets[key] : undefined;
    },
  };
}

/**
 * Read each secret from `<dir>/<key>` (the Docker/Kubernetes mounted-secret
 * convention). Requires an injected reader so the package stays dependency-free
 * and testable; wire it to `fs.promises.readFile` in production:
 *
 * ```ts
 * import { readFile } from 'node:fs/promises';
 * fileSecretProvider('/run/secrets', {
 *   read: (p) => readFile(p, 'utf8').then((s) => s.trimEnd()),
 * });
 * ```
 */
export function fileSecretProvider(
  dir: string,
  options: { read: (path: string) => Promise<string | undefined>; separator?: string },
): SecretProvider {
  const sep = options.separator ?? '/';
  const base = dir.endsWith(sep) ? dir.slice(0, -sep.length) : dir;
  return {
    name: `file:${dir}`,
    async get(key: string): Promise<string | undefined> {
      return options.read(`${base}${sep}${key}`);
    },
  };
}

/** Thrown when a required secret cannot be resolved from any provider. */
export class SecretNotFoundError extends ConfigError {
  constructor(public readonly key: string) {
    super(`Secret "${key}" was not found in any configured provider`);
    this.name = 'SecretNotFoundError';
  }
}

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

export interface SecretStoreOptions {
  /** Providers checked in order; the first to return a value wins. */
  providers: SecretProvider[];
  /** Cache TTL in ms. `0` (default) caches until an explicit `rotate()`. */
  ttlMs?: number;
  /** Injectable clock (ms). Default `Date.now`. */
  now?: () => number;
  /** Access-audit hook, invoked with the key on every resolve (before cache). */
  onAccess?: (key: string) => void;
}

/**
 * Resolves secrets across ordered providers with caching, rotation, and an
 * access-audit hook. Values are cached until their TTL lapses or `rotate()` is
 * called; rotation notifies listeners so consumers (e.g. a DB pool) can refresh.
 */
export class SecretStore {
  private readonly providers: SecretProvider[];
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly onAccess: ((key: string) => void) | undefined;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly rotateHandlers = new Set<(key?: string) => void>();

  constructor(options: SecretStoreOptions) {
    if (!Array.isArray(options?.providers) || options.providers.length === 0) {
      throw new ConfigError('SecretStore: at least one provider is required');
    }
    this.providers = [...options.providers];
    this.ttlMs = options.ttlMs ?? 0;
    this.now = options.now ?? (() => Date.now());
    this.onAccess = options.onAccess;
  }

  /** Resolve a secret, throwing {@link SecretNotFoundError} when absent. */
  async get(key: string): Promise<string> {
    const value = await this.getOptional(key);
    if (value === undefined) throw new SecretNotFoundError(key);
    return value;
  }

  /** Resolve a secret, returning `undefined` when absent. */
  async getOptional(key: string): Promise<string | undefined> {
    this.onAccess?.(key);

    const cached = this.cache.get(key);
    if (cached && (this.ttlMs === 0 || this.now() - cached.fetchedAt < this.ttlMs)) {
      return cached.value;
    }

    for (const provider of this.providers) {
      const value = await provider.get(key);
      if (value !== undefined) {
        this.cache.set(key, { value, fetchedAt: this.now() });
        return value;
      }
    }
    // Not found anywhere: drop any stale cache entry.
    this.cache.delete(key);
    return undefined;
  }

  /** Whether a secret resolves (does not throw). */
  async has(key: string): Promise<boolean> {
    return (await this.getOptional(key)) !== undefined;
  }

  /**
   * Invalidate the cache for one key (or all keys when omitted) and notify
   * rotation listeners. The next `get` re-fetches from the providers, so a
   * rotated secret is picked up on demand.
   */
  rotate(key?: string): void {
    if (key === undefined) this.cache.clear();
    else this.cache.delete(key);
    for (const handler of this.rotateHandlers) handler(key);
  }

  /** Register a rotation listener; returns an unsubscribe function. */
  onRotate(handler: (key?: string) => void): () => void {
    this.rotateHandlers.add(handler);
    return () => {
      this.rotateHandlers.delete(handler);
    };
  }

  /** Drop all cached values without notifying rotation listeners. */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * A config {@link Provider} that resolves secrets from a {@link SecretStore} and
 * places them at dotted config paths, so secret values flow into typed,
 * validated configuration at load time.
 *
 * `mapping` is `{ 'database.password': 'DB_PASSWORD', ... }` (dotted config path
 * → secret key). Missing optional secrets are skipped; set `required: true` to
 * fail loading when a mapped secret is absent.
 */
export function secretsProvider(
  store: SecretStore,
  mapping: Record<string, string>,
  options: { required?: boolean; name?: string } = {},
): Provider {
  const required = options.required ?? false;
  return {
    name: options.name ?? 'secrets',
    async load(): Promise<PlainObject> {
      const root: Record<string, ConfigInput> = {};
      for (const [path, secretKey] of Object.entries(mapping)) {
        const value = required ? await store.get(secretKey) : await store.getOptional(secretKey);
        if (value === undefined) continue;
        assignPath(root, path.split('.'), value);
      }
      return root as PlainObject;
    },
  };
}

function assignPath(root: Record<string, ConfigInput>, path: string[], value: ConfigInput): void {
  let node = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    const next = node[key];
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
      const created: Record<string, ConfigInput> = {};
      node[key] = created;
      node = created;
    } else {
      node = next as Record<string, ConfigInput>;
    }
  }
  node[path[path.length - 1]!] = value;
}
