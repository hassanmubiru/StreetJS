// packages/config/src/config.ts
// The public builder (`createConfig`) and the immutable `Config` it produces.

import { ConfigStateError } from './errors.js';
import { loadAndValidate, type LoadResult } from './loader.js';
import { MetadataStore } from './metadata.js';
import { Namespace, navigate, stringifyConfig } from './namespace.js';
import {
  envProvider,
  fileProvider,
  jsonFileProvider,
  objectProvider,
  tomlFileProvider,
  yamlFileProvider,
  type EnvProviderOptions,
  type FileProviderOptions,
  type Provider,
} from './provider.js';
import { defineSchema, type Infer, type SchemaShape } from './schema.js';
import type {
  ConfigReaderCore,
  Environment,
  FieldMetadata,
  PlainObject,
  SerializeOptions,
} from './types.js';

/** Options for `createConfig`. */
export interface CreateConfigOptions {
  /** Override the detected runtime environment. */
  readonly environment?: Environment;
  /** Env map used for environment detection and the default env provider. Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Reject source keys not declared in the schema. Default false. */
  readonly strict?: boolean;
  /** Enable `config.reload()`. Default false — configuration is immutable after load. */
  readonly reloadable?: boolean;
  /** Mask used for secret values in serialize()/toJSON(). Default `"********"`. */
  readonly secretMask?: string;
}

const DEFAULT_MASK = '********';

/** Detect and normalize the runtime environment from `NODE_ENV`. */
export function detectEnvironment(env: NodeJS.ProcessEnv = process.env): Environment {
  const raw = (env.NODE_ENV ?? '').trim().toLowerCase();
  switch (raw) {
    case 'production':
    case 'prod':
      return 'production';
    case 'staging':
    case 'stage':
      return 'staging';
    case 'test':
    case 'testing':
      return 'test';
    case 'development':
    case 'dev':
    case '':
      return 'development';
    default:
      return 'development';
  }
}

/** Non-throwing validation result. */
export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: import('./errors.js').ConfigValidationError['issues'] };

/**
 * Fluent builder. `createConfig()` → declare `.schema()`, add `.provider()`s,
 * then `.load()` (validates + freezes) or `.validate()` (non-throwing check).
 */
export class ConfigBuilder<T> {
  private shape: SchemaShape | null = null;
  private readonly providers: Provider[] = [];

  /** @internal */
  constructor(private readonly options: CreateConfigOptions) {}

  /** Declare the configuration schema. Fixes the resolved config's type. */
  schema<S extends SchemaShape>(shape: S): ConfigBuilder<Infer<S>> {
    this.shape = defineSchema(shape);
    return this as unknown as ConfigBuilder<Infer<S>>;
  }

  /** Add a custom or built-in provider. Later providers override earlier ones. */
  provider(provider: Provider): this {
    this.providers.push(provider);
    return this;
  }

  /** Add the environment-variable provider. */
  env(options: EnvProviderOptions = {}): this {
    return this.provider(envProvider({ env: this.options.env ?? process.env, ...options }));
  }

  /** Add an in-memory object provider (e.g. programmatic overrides). */
  object(data: PlainObject, name?: string): this {
    return this.provider(objectProvider(data, name));
  }

  /** Add a file provider, dispatching by extension (.json/.yaml/.yml/.toml). */
  file(path: string, options?: FileProviderOptions): this {
    return this.provider(fileProvider(path, options));
  }

  json(path: string, options?: FileProviderOptions): this {
    return this.provider(jsonFileProvider(path, options));
  }
  yaml(path: string, options?: FileProviderOptions): this {
    return this.provider(yamlFileProvider(path, options));
  }
  toml(path: string, options?: FileProviderOptions): this {
    return this.provider(tomlFileProvider(path, options));
  }

  private environment(): Environment {
    return this.options.environment ?? detectEnvironment(this.options.env ?? process.env);
  }

  private requireShape(): SchemaShape {
    if (!this.shape) throw new ConfigStateError('a schema must be declared with .schema() before loading');
    return this.shape;
  }

  /** Load all providers, validate against the schema, and return a frozen Config. */
  async load(): Promise<Config<T>> {
    const shape = this.requireShape();
    const environment = this.environment();
    const providers = [...this.providers];
    const strict = this.options.strict ?? false;
    const mask = this.options.secretMask ?? DEFAULT_MASK;
    const reloadable = this.options.reloadable ?? false;

    const reload = (): Promise<LoadResult> => loadAndValidate(shape, providers, { strict, environment });
    const result = await reload();
    return new Config<T>(result, environment, mask, reloadable ? reload : null);
  }

  /** Validate without throwing. Returns `{ ok }` or `{ ok: false, issues }`. */
  async validate(): Promise<ValidationResult> {
    try {
      await this.load();
      return { ok: true };
    } catch (e) {
      const { ConfigValidationError } = await import('./errors.js');
      if (e instanceof ConfigValidationError) return { ok: false, issues: e.issues };
      throw e;
    }
  }
}

/** Immutable, typed, validated configuration. Produced by `ConfigBuilder.load()`. */
export class Config<T> implements ConfigReaderCore {
  private values: Record<string, unknown>;
  private metaStore: MetadataStore;
  private secretPaths: ReadonlySet<string>;
  private frozen = false;

  /** @internal */
  constructor(
    result: LoadResult,
    public readonly environment: Environment,
    private readonly mask: string,
    private readonly reloader: (() => Promise<LoadResult>) | null,
  ) {
    this.values = deepFreeze(result.values);
    this.metaStore = new MetadataStore(result.metadata);
    this.secretPaths = result.secretPaths;
    this.frozen = true;
  }

  /** Typed access to a top-level key, or untyped access to a dotted path. */
  get<K extends keyof T & string>(key: K): T[K];
  get(path: string): unknown;
  get(path: string): unknown {
    const [found, value] = navigate(this.values, path);
    if (found) return value;
    if (this.metaStore.has(path)) return undefined; // known optional, unset
    throw new ConfigStateError(`unknown configuration key: "${path}"`);
  }

  has(path: string): boolean {
    const [found, value] = navigate(this.values, path);
    return found && value !== undefined;
  }

  keys(): string[] {
    return this.metaStore.keys();
  }

  metadata(path: string): FieldMetadata | undefined {
    return this.metaStore.get(path);
  }

  /** A prefix-scoped read view. */
  namespace(prefix: string): Namespace {
    return new Namespace(this, prefix);
  }

  /** Secret-masked plain object of the resolved configuration. */
  toJSON(): Record<string, unknown> {
    return maskObject(this.values, this.secretPaths, '', this.mask, false);
  }

  /** Serialize the configuration. Secrets are masked unless `includeSecrets` is set. */
  serialize(options: SerializeOptions = {}): string {
    const masked = maskObject(
      this.values,
      this.secretPaths,
      '',
      options.mask ?? this.mask,
      options.includeSecrets ?? false,
    );
    return stringifyConfig(masked, options);
  }

  /** Idempotently freeze the configuration (already frozen after load). */
  freeze(): this {
    this.frozen = true;
    deepFreeze(this.values);
    return this;
  }

  /** True once the configuration is immutable (always true after load). */
  get isFrozen(): boolean {
    return this.frozen;
  }

  /**
   * Re-read every source and re-validate, atomically swapping in a new snapshot
   * on success. Only available when `createConfig({ reloadable: true })`. On a
   * validation failure it throws and keeps the current configuration unchanged.
   */
  async reload(): Promise<void> {
    if (!this.reloader) {
      throw new ConfigStateError('reload() is disabled; construct with createConfig({ reloadable: true })');
    }
    const result = await this.reloader(); // throws on validation failure — current snapshot untouched
    this.values = deepFreeze(result.values);
    this.metaStore = new MetadataStore(result.metadata);
    this.secretPaths = result.secretPaths;
  }
}

/** Entry point: create a configuration builder. */
export function createConfig(options: CreateConfigOptions = {}): ConfigBuilder<unknown> {
  return new ConfigBuilder<unknown>(options);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function deepFreeze<V>(value: V): V {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function maskObject(
  values: Record<string, unknown>,
  secretPaths: ReadonlySet<string>,
  prefix: string,
  mask: string,
  includeSecrets: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!includeSecrets && secretPaths.has(path)) {
      out[key] = mask;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = maskObject(value as Record<string, unknown>, secretPaths, path, mask, includeSecrets);
    } else {
      out[key] = value;
    }
  }
  return out;
}
