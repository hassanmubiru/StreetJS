// packages/config/src/loader.ts
// The loader ties sources to schema. It (1) loads every provider, (2) deep-merges
// them with per-path provenance (later providers override earlier), and (3) walks
// the schema to coerce/validate/default/transform each field, aggregating every
// failure into a single ConfigValidationError.

import { ConfigValidationError, REDACTED, type ValidationIssue } from './errors.js';
import { navigate } from './namespace.js';
import type { Provider } from './provider.js';
import { isField, type FieldDescriptor, type SchemaShape } from './schema.js';
import type { Environment, FieldMetadata, PlainObject, SourceRef } from './types.js';

export interface LoaderOptions {
  /** Reject unknown keys present in sources but absent from the schema. Default false. */
  readonly strict?: boolean;
  readonly environment: Environment;
}

export interface LoadResult {
  /** Resolved, validated, transformed nested configuration object. */
  readonly values: Record<string, unknown>;
  /** Per-key resolution metadata (leaf fields). */
  readonly metadata: FieldMetadata[];
  /** Dotted paths whose fields are marked secret. */
  readonly secretPaths: ReadonlySet<string>;
}

interface Merged {
  readonly merged: Record<string, unknown>;
  readonly provenance: Map<string, SourceRef>;
}

export async function loadAndValidate(
  shape: SchemaShape,
  providers: readonly Provider[],
  options: LoaderOptions,
): Promise<LoadResult> {
  const { merged, provenance } = await mergeProviders(providers);

  const values: Record<string, unknown> = {};
  const metadata: FieldMetadata[] = [];
  const secretPaths = new Set<string>();
  const issues: ValidationIssue[] = [];

  walk(shape, '', { merged, provenance, values, metadata, secretPaths, issues });

  if (options.strict) {
    collectUnknownKeys(shape, merged, '', provenance, issues);
  }

  if (issues.length > 0) throw new ConfigValidationError(issues);
  return { values, metadata, secretPaths };
}

interface WalkCtx {
  readonly merged: Record<string, unknown>;
  readonly provenance: Map<string, SourceRef>;
  readonly values: Record<string, unknown>;
  readonly metadata: FieldMetadata[];
  readonly secretPaths: Set<string>;
  readonly issues: ValidationIssue[];
}

function walk(shape: SchemaShape, prefix: string, ctx: WalkCtx): void {
  for (const [key, entry] of Object.entries(shape)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isField(entry)) {
      resolveField(entry, path, ctx);
    } else {
      walk(entry, path, ctx);
    }
  }
}

function resolveField(field: FieldDescriptor<unknown>, path: string, ctx: WalkCtx): void {
  if (field.isSecret) ctx.secretPaths.add(path);
  const [present, raw] = navigate(ctx.merged, path);
  const source = ctx.provenance.get(path) ?? null;

  if (present) {
    const outcome = field.validate(raw);
    if (outcome.ok) {
      const value = field.applyTransform(outcome.value);
      setPath(ctx.values, path, value);
      ctx.metadata.push(meta(path, field, true, false, source));
    } else {
      ctx.issues.push({
        key: path,
        source,
        invalidValue: field.isSecret ? REDACTED : raw,
        expectedType: outcome.expected,
        message: outcome.message,
        secret: field.isSecret,
      });
    }
    return;
  }

  // absent from all sources
  if (field.hasDefault) {
    const value = field.applyTransform(field.defaultValue);
    setPath(ctx.values, path, value);
    ctx.metadata.push(meta(path, field, false, true, null));
  } else if (field.required) {
    ctx.issues.push({
      key: path,
      source: null,
      invalidValue: undefined,
      expectedType: field.type,
      message: 'required configuration value is missing',
      secret: field.secret,
    });
  } else {
    // optional and absent → recorded as known-but-unset
    ctx.metadata.push(meta(path, field, false, false, null));
  }
}

function meta(
  path: string,
  field: FieldDescriptor<unknown>,
  present: boolean,
  defaulted: boolean,
  source: SourceRef | null,
): FieldMetadata {
  return {
    key: path,
    type: field.type,
    secret: field.secret,
    required: field.required,
    present,
    defaulted,
    source,
  };
}

async function mergeProviders(providers: readonly Provider[]): Promise<Merged> {
  const merged: Record<string, unknown> = {};
  const provenance = new Map<string, SourceRef>();
  for (const provider of providers) {
    const data = await provider.load();
    deepAssign(merged, data, '', provenance, { provider: provider.name });
  }
  return { merged, provenance };
}

function deepAssign(
  target: Record<string, unknown>,
  source: PlainObject,
  prefix: string,
  provenance: Map<string, SourceRef>,
  ref: SourceRef,
): void {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    // Record provenance with the in-source location for the leaf when available.
    provenance.set(path, ref.provider === 'env' ? { ...ref, location: path } : ref);
    if (isPlainObject(value)) {
      const existing = target[key];
      const child = isPlainObject(existing) ? (existing as Record<string, unknown>) : {};
      target[key] = child;
      deepAssign(child, value, path, provenance, ref);
    } else {
      target[key] = value; // scalar, array, or null replaces
    }
  }
}

function collectUnknownKeys(
  shape: SchemaShape,
  merged: Record<string, unknown>,
  prefix: string,
  provenance: Map<string, SourceRef>,
  issues: ValidationIssue[],
): void {
  for (const [key, value] of Object.entries(merged)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const entry = shape[key];
    if (entry === undefined) {
      issues.push({
        key: path,
        source: provenance.get(path) ?? null,
        invalidValue: '(unknown key)',
        expectedType: 'not present in schema',
        message: 'unknown configuration key is not declared in the schema (strict mode)',
        secret: false,
      });
    } else if (!isField(entry) && isPlainObject(value)) {
      collectUnknownKeys(entry, value as Record<string, unknown>, path, provenance, issues);
    }
  }
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]!;
    const next = node[key];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      node[key] = created;
      node = created;
    } else {
      node = next as Record<string, unknown>;
    }
  }
  node[segments[segments.length - 1]!] = value;
}

function isPlainObject(v: unknown): v is PlainObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
