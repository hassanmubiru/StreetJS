// @streetjs/config — public API.
//
// The configuration foundation for StreetJS: typed, schema-validated, immutable
// configuration with pluggable sources, namespaces, secret masking, and
// descriptive startup validation. Zero runtime dependencies.
//
// Quick start:
//   import { createConfig, s } from '@streetjs/config';
//   const config = await createConfig()
//     .schema({
//       port: s.number({ integer: true, min: 1, max: 65535 }).default(3000),
//       database: { url: s.url({ protocols: ['postgres'] }).secret() },
//       logLevel: s.enum(['debug', 'info', 'warn', 'error'] as const).default('info'),
//     })
//     .json('config.json', { optional: true })
//     .env({ prefix: 'APP_' })
//     .load();
//   config.get('port');                 // number
//   config.namespace('database').get('url');

// ── builder + config ──────────────────────────────────────────────────────────
export {
  createConfig,
  ConfigBuilder,
  Config,
  detectEnvironment,
  type CreateConfigOptions,
  type ValidationResult,
} from './config.js';

// ── schema + fields ─────────────────────────────────────────────────────────────
export { s, defineSchema, schema, Field, isField } from './schema.js';
export type { FieldDescriptor, SchemaShape, Infer } from './schema.js';

// ── providers (sources) ─────────────────────────────────────────────────────────
export {
  objectProvider,
  envProvider,
  fileProvider,
  jsonFileProvider,
  yamlFileProvider,
  tomlFileProvider,
  parseYaml,
  parseToml,
  type Provider,
  type EnvProviderOptions,
  type FileProviderOptions,
} from './provider.js';

// ── validators (for building custom fields) ──────────────────────────────────────
export {
  makeOk,
  makeErr,
  validateString,
  validateNumber,
  validateBoolean,
  validateEnum,
  validateArray,
  validateObject,
  validateDuration,
  validateUrl,
  validatePath,
  validateHostname,
  validateIp,
  validateEmail,
  type Outcome,
  type StringOptions,
  type NumberOptions,
  type ArrayOptions,
  type UrlOptions,
} from './validator.js';

// ── namespace view ──────────────────────────────────────────────────────────────
export { Namespace } from './namespace.js';

// ── errors ──────────────────────────────────────────────────────────────────────
export {
  ConfigError,
  ConfigValidationError,
  ConfigParseError,
  ConfigStateError,
  REDACTED,
  type ValidationIssue,
} from './errors.js';

// ── shared types ────────────────────────────────────────────────────────────────
export type {
  Environment,
  ConfigValueType,
  SourceRef,
  FieldMetadata,
  SerializeOptions,
  PlainObject,
  ConfigInput,
  ConfigReaderCore,
} from './types.js';
