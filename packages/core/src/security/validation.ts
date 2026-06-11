// src/security/validation.ts
// Phase 1 — Runtime Input Validator (Requirement 2).
//
// Zod-backed validation for every External_Input source (body, query, params,
// headers, cookies) plus startup validation of environment variables and CLI
// arguments. Schemas are parsed BEFORE the route handler runs, so malformed or
// malicious input is rejected with HTTP 400 and the handler never executes
// (R2.3). Failure responses list only field paths + reasons — never stack
// traces or internal types (R2.4/R2.5). Validation is a pure parse, so repeated
// validation of the same conforming input yields a structurally equal value
// (R2.9).

import { z } from 'zod';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';
import { StreetException } from '../http/exceptions.js';

/** The External_Input sources the Validator can validate independently (R2.1). */
export type InputSource = 'body' | 'query' | 'params' | 'headers' | 'cookies';

/**
 * A per-source schema set. Any subset of sources may be declared; only declared
 * sources are validated (R2.1).
 */
export interface RouteSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  headers?: ZodTypeAny;
  cookies?: ZodTypeAny;
}

/** A single field failure in serialized form: path + reason only (R2.4). */
export interface FieldIssue {
  path: string;
  message: string;
}

/** The shape written to `ctx.state.valid` once a source has been validated. */
export type ValidatedState = Partial<Record<InputSource, unknown>>;

/**
 * Error produced when an External_Input fails its Validation_Schema. Carries
 * HTTP status 400 and serializes to a body containing only field paths and
 * reasons (R2.4/R2.5). Extends {@link StreetException} so the existing router
 * error handler emits the 400 status and the safe body via `toJSON()` without
 * any additional wiring or leaking of stack traces / internal types.
 */
export class ValidationError extends StreetException {
  readonly issues: FieldIssue[];

  constructor(issues: FieldIssue[]) {
    super(400, 'ValidationError', issues);
    this.name = 'ValidationError';
    this.issues = issues;
  }

  /** Safe response body: field paths + reasons only — no stack/internal types (R2.5). */
  toResponse(): { error: 'ValidationError'; issues: FieldIssue[] } {
    return { error: 'ValidationError', issues: this.issues };
  }

  /** Router error handler serializes this; keep it identical to the safe body (R2.5). */
  override toJSON(): object {
    return this.toResponse();
  }
}

/** Convert a Zod error into the safe {@link FieldIssue} list (path + message only). */
function toFieldIssues(error: z.ZodError, source: InputSource): FieldIssue[] {
  return error.issues.map((issue) => {
    const segments = issue.path.map((p) => String(p));
    const path = [source, ...segments].join('.');
    return { path, message: issue.message };
  });
}

/** Parse the `Cookie` request header into a plain `{ name: value }` record. */
function parseCookies(ctx: StreetContext): Record<string, string> {
  const header = ctx.headers['cookie'] ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    const value = part.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/** Extract the raw input for a given source from the request context. */
function rawSource(ctx: StreetContext, source: InputSource): unknown {
  switch (source) {
    case 'body':
      return ctx.body;
    case 'query':
      return ctx.query;
    case 'params':
      return ctx.params;
    case 'headers':
      return ctx.headers;
    case 'cookies':
      return parseCookies(ctx);
  }
}

const SOURCES: readonly InputSource[] = ['body', 'query', 'params', 'headers', 'cookies'];

/**
 * Validate each declared source against its schema. On success, the parsed and
 * typed values are written to `ctx.state.valid.<source>` and the handler runs
 * (R2.2/R2.6). On ANY failure, a {@link ValidationError} (HTTP 400) is thrown
 * BEFORE `next()`, so the route handler never begins execution (R2.3). Issues
 * from all declared sources are aggregated so the response lists every failing
 * field path and reason (R2.4).
 */
export function validate(schemas: RouteSchemas): MiddlewareFn {
  return async (ctx: StreetContext, next: () => Promise<void>): Promise<void> => {
    const parsed: ValidatedState = {};
    const issues: FieldIssue[] = [];

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(rawSource(ctx, source));
      if (result.success) {
        parsed[source] = result.data;
      } else {
        issues.push(...toFieldIssues(result.error, source));
      }
    }

    // Reject before next(): the handler must not run on failure (R2.3).
    if (issues.length > 0) {
      throw new ValidationError(issues);
    }

    if (!ctx.state || typeof ctx.state !== 'object') {
      (ctx as { state: Record<string, unknown> }).state = {};
    }
    const existing = ctx.state['valid'];
    const valid: ValidatedState =
      existing && typeof existing === 'object' ? (existing as ValidatedState) : {};
    Object.assign(valid, parsed);
    ctx.state['valid'] = valid;

    await next();
  };
}

/**
 * Typed accessor that returns the validated values for the declared sources,
 * with each value's type inferred from its schema (R2.6). Must be called inside
 * a handler that ran behind {@link validate} with the same schemas.
 */
export function validated<S extends RouteSchemas>(
  ctx: StreetContext,
  schemas: S,
): { [K in keyof S]: S[K] extends ZodTypeAny ? ZodInfer<S[K]> : never } {
  const valid = (ctx.state?.['valid'] ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(schemas) as (keyof S)[]) {
    if (schemas[key]) out[key as string] = valid[key as string];
  }
  return out as { [K in keyof S]: S[K] extends ZodTypeAny ? ZodInfer<S[K]> : never };
}

/** Top-level field names that failed a startup schema — names only, never values. */
function failingNames(error: z.ZodError): string[] {
  const names = new Set<string>();
  for (const issue of error.issues) {
    const name = issue.path.length > 0 ? String(issue.path[0]) : '<root>';
    names.add(name);
  }
  return [...names];
}

/**
 * Validate declared environment variables against a schema at process startup
 * (R2.7). On failure, the failing variable NAMES are written to stderr — never
 * their values — and the process exits with a non-zero code (R2.8). Mirrors the
 * required-variable behavior of `vault.loadConfig`.
 */
export function validateEnv<S extends ZodTypeAny>(
  schema: S,
  env: NodeJS.ProcessEnv = process.env,
): ZodInfer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const names = failingNames(result.error);
    process.stderr.write(
      `Environment validation failed for: ${names.join(', ')}\n`,
    );
    process.exit(1);
  }
  return result.data as ZodInfer<S>;
}

/**
 * Parse `argv` tokens (`--flag`, `--flag value`, `--flag=value`) into a record
 * suitable for schema validation. Repeated flags collect into arrays.
 */
function parseArgv(argv: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      out[key] = value;
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      assign(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const nextToken = argv[i + 1];
    if (nextToken !== undefined && !nextToken.startsWith('--')) {
      assign(body, nextToken);
      i++;
    } else {
      assign(body, true);
    }
  }
  return out;
}

/**
 * Validate declared CLI arguments against a schema at process startup (R2.7).
 * On failure, the failing argument NAMES are written to stderr — never their
 * values — and the process exits with a non-zero code (R2.8).
 */
export function validateArgv<S extends ZodTypeAny>(
  schema: S,
  argv: string[] = process.argv.slice(2),
): ZodInfer<S> {
  const result = schema.safeParse(parseArgv(argv));
  if (!result.success) {
    const names = failingNames(result.error);
    process.stderr.write(`Argument validation failed for: ${names.join(', ')}\n`);
    process.exit(1);
  }
  return result.data as ZodInfer<S>;
}
