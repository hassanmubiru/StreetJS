// packages/config/src/types.ts
// Shared public types for @streetjs/config.
//
// This module has NO imports from other modules in the package, so it forms the
// root of an acyclic dependency graph: every other module may import from here,
// and this module imports from nothing internal.

/** Normalized runtime environment. Detected from NODE_ENV (see `detectEnvironment`). */
export type Environment = 'development' | 'test' | 'staging' | 'production';

/** The distinct value kinds a schema field can declare. */
export type ConfigValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object'
  | 'duration'
  | 'url'
  | 'path'
  | 'hostname'
  | 'ip'
  | 'email'
  | 'custom';

/** A plain nested object as produced by a configuration source. */
export type PlainObject = { readonly [key: string]: ConfigInput };

/** Any value a source may yield before schema coercion/validation. */
export type ConfigInput = string | number | boolean | null | ConfigInput[] | PlainObject;

/** Identifies which source supplied a value, for diagnostics and metadata. */
export interface SourceRef {
  /** Provider name, e.g. `env`, `json:config.json`, `toml:app.toml`, or a custom name. */
  readonly provider: string;
  /** Optional in-source location, e.g. the environment variable name `DATABASE_URL`. */
  readonly location?: string;
}

/** Per-key resolution metadata, retrievable via `config.metadata(path)`. */
export interface FieldMetadata {
  /** Dotted key path, e.g. `database.host`. */
  readonly key: string;
  /** Declared schema type. */
  readonly type: ConfigValueType;
  /** Whether the field is marked secret (masked in serialize/errors). */
  readonly secret: boolean;
  /** Whether the schema requires the field. */
  readonly required: boolean;
  /** True when a configuration source supplied the value (vs. a default). */
  readonly present: boolean;
  /** True when the resolved value came from the schema default. */
  readonly defaulted: boolean;
  /** The source that supplied the value, or `null` when defaulted/absent. */
  readonly source: SourceRef | null;
}

/** Options for `config.serialize()`. */
export interface SerializeOptions {
  /** `json` (nested) or `flat` (dotted keys). Default `json`. */
  readonly format?: 'json' | 'flat';
  /** Pretty-print JSON. Default `true`. */
  readonly pretty?: boolean;
  /**
   * Include secret values verbatim. Default `false` — secrets are replaced with
   * the mask. Enabling this defeats secret protection; only for trusted, local
   * inspection, never for logs.
   */
  readonly includeSecrets?: boolean;
  /** Mask string used for secret values when not included. Default `"********"`. */
  readonly mask?: string;
}

/**
 * Read-only surface shared by the root `Config` and every namespace view. Kept
 * minimal and untyped-by-path so `namespace.ts` can depend on this interface
 * without importing the concrete `Config` implementation (breaks the cycle).
 */
export interface ConfigReaderCore {
  /** Resolve a value by dotted path. Throws if the path is unknown. */
  get(path: string): unknown;
  /** True if a value exists at the dotted path. */
  has(path: string): boolean;
  /** All known dotted key paths (leaf keys), sorted. */
  keys(): string[];
  /** Resolution metadata for a dotted path, or `undefined` if unknown. */
  metadata(path: string): FieldMetadata | undefined;
  /** The detected runtime environment. */
  readonly environment: Environment;
  /** Secret-masked plain object of the resolved configuration. */
  toJSON(): Record<string, unknown>;
  /** Serialize the resolved configuration (secrets masked by default). */
  serialize(options?: SerializeOptions): string;
}
