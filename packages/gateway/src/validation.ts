/**
 * @streetjs/gateway — request validation.
 *
 * A pure, dependency-light validator that evaluates a {@link ValidationSchema}
 * against the four request locations and produces a consistent, ordered list of
 * {@link ValidationIssue}s. Nothing here performs I/O or mutates its inputs, so
 * results are fully deterministic for a given schema + input.
 *
 *  - {@link validateRequest} — collect all issues (empty when valid).
 *  - {@link assertValid} — throw {@link RequestValidationError} when invalid.
 *  - {@link required}, {@link isString}, {@link matches}, {@link isInteger} —
 *    small reusable {@link FieldRule} helpers.
 */

import type { FieldRule, ValidationIssue, ValidationSchema } from "./types.js";
import { RequestValidationError } from "./errors.js";

/** The request material to validate, keyed by location. */
export interface ValidationInput {
  readonly headers?: Record<string, unknown>;
  readonly query?: Record<string, unknown>;
  readonly params?: Record<string, unknown>;
  readonly body?: unknown;
}

/** Case-insensitive header lookup: returns the value for `field`, else `undefined`. */
function lookupHeader(headers: Record<string, unknown>, field: string): unknown {
  const wanted = field.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) {
      return headers[key];
    }
  }
  return undefined;
}

/**
 * Validate `input` against `schema`, returning every issue found.
 *
 * Locations are evaluated in the stable order `headers → params → query → body`
 * and, within a location, rules run in their declared (insertion) order. Each
 * declared field rule is invoked with the corresponding value; when it returns
 * a string that message becomes an issue. Header field names are matched
 * case-insensitively. Returns `[]` when everything is valid. Pure.
 */
export function validateRequest(schema: ValidationSchema, input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (schema.headers) {
    const headers = input.headers ?? {};
    for (const [field, rule] of Object.entries(schema.headers)) {
      const result = rule(lookupHeader(headers, field));
      if (result !== true) {
        issues.push({ location: "headers", field, message: result });
      }
    }
  }

  if (schema.params) {
    const params = input.params ?? {};
    for (const [field, rule] of Object.entries(schema.params)) {
      const result = rule(params[field]);
      if (result !== true) {
        issues.push({ location: "params", field, message: result });
      }
    }
  }

  if (schema.query) {
    const query = input.query ?? {};
    for (const [field, rule] of Object.entries(schema.query)) {
      const result = rule(query[field]);
      if (result !== true) {
        issues.push({ location: "query", field, message: result });
      }
    }
  }

  if (schema.body) {
    const result = schema.body(input.body);
    if (result !== true) {
      issues.push({ location: "body", field: "body", message: result });
    }
  }

  return issues;
}

/**
 * Validate `input` against `schema` and throw when invalid.
 *
 * Delegates to {@link validateRequest}; if the resulting issue list is
 * non-empty it throws a {@link RequestValidationError} carrying those issues
 * (HTTP 400). Returns normally (void) when the request is valid.
 */
export function assertValid(schema: ValidationSchema, input: ValidationInput): void {
  const issues = validateRequest(schema, input);
  if (issues.length > 0) {
    throw new RequestValidationError(issues);
  }
}

// ── Reusable rule helpers ─────────────────────────────────────────────────────────

/** A rule that fails when the value is missing (`undefined` or `null`). */
export function required(): FieldRule {
  return (value) => (value === undefined || value === null ? "is required" : true);
}

/** A rule that fails when the value is not a string. */
export function isString(): FieldRule {
  return (value) => (typeof value === "string" ? true : "must be a string");
}

/** A rule that fails when the value is not a string matching `re`. */
export function matches(re: RegExp): FieldRule {
  return (value) =>
    typeof value === "string" && re.test(value) ? true : `must match ${re.toString()}`;
}

/** A rule that fails when the value is not a safe integer. */
export function isInteger(): FieldRule {
  return (value) => (typeof value === "number" && Number.isInteger(value) ? true : "must be an integer");
}
