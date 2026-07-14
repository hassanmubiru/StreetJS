// packages/config/src/validator.ts
// Low-level, pure type validators + coercers. Configuration sources yield either
// already-typed values (JSON/YAML/TOML) or strings (environment variables), so
// every validator accepts both and coerces from string where unambiguous.
//
// Each validator returns a discriminated `Outcome` — never throws — so the
// loader can aggregate every failure into one ConfigValidationError.

import { isIP } from 'node:net';

/** Result of validating/coercing a single raw value. */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly expected: string; readonly message: string };

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const err = (expected: string, message: string): Outcome<never> => ({ ok: false, expected, message });

// ── string ──────────────────────────────────────────────────────────────────

export interface StringOptions {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
  /** Trim surrounding whitespace before validating. Default true. */
  readonly trim?: boolean;
}

export function validateString(raw: unknown, opts: StringOptions = {}): Outcome<string> {
  if (typeof raw !== 'string') return err('string', `expected a string, got ${typeName(raw)}`);
  const v = opts.trim === false ? raw : raw.trim();
  if (opts.minLength !== undefined && v.length < opts.minLength) {
    return err(`string (min length ${opts.minLength})`, `string is too short (${v.length} < ${opts.minLength})`);
  }
  if (opts.maxLength !== undefined && v.length > opts.maxLength) {
    return err(`string (max length ${opts.maxLength})`, `string is too long (${v.length} > ${opts.maxLength})`);
  }
  if (opts.pattern && !opts.pattern.test(v)) {
    return err(`string matching ${opts.pattern}`, `string does not match required pattern ${opts.pattern}`);
  }
  return ok(v);
}

// ── number ──────────────────────────────────────────────────────────────────

export interface NumberOptions {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

export function validateNumber(raw: unknown, opts: NumberOptions = {}): Outcome<number> {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    n = Number(raw);
  } else {
    return err('number', `expected a number, got ${typeName(raw)}`);
  }
  if (!Number.isFinite(n)) return err('number', 'value is not a finite number');
  if (opts.integer && !Number.isInteger(n)) return err('integer', `expected an integer, got ${n}`);
  if (opts.min !== undefined && n < opts.min) return err(`number >= ${opts.min}`, `value ${n} is below minimum ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) return err(`number <= ${opts.max}`, `value ${n} is above maximum ${opts.max}`);
  return ok(n);
}

// ── boolean ──────────────────────────────────────────────────────────────────

const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off']);

export function validateBoolean(raw: unknown): Outcome<boolean> {
  if (typeof raw === 'boolean') return ok(raw);
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (TRUE.has(v)) return ok(true);
    if (FALSE.has(v)) return ok(false);
  }
  return err('boolean', `expected a boolean (true/false/1/0/yes/no/on/off), got ${typeName(raw)}`);
}

// ── enum ──────────────────────────────────────────────────────────────────────

export function validateEnum<T extends string>(raw: unknown, values: readonly T[]): Outcome<T> {
  if (typeof raw !== 'string') return err(`one of: ${values.join(', ')}`, `expected a string, got ${typeName(raw)}`);
  const v = raw.trim();
  if ((values as readonly string[]).includes(v)) return ok(v as T);
  return err(`one of: ${values.join(', ')}`, `"${v}" is not an allowed value`);
}

// ── array ──────────────────────────────────────────────────────────────────────

export interface ArrayOptions {
  /** Delimiter used to split a delimited string into items. Default ",". */
  readonly delimiter?: string;
  readonly minItems?: number;
  readonly maxItems?: number;
}

/**
 * Split/accept an array. A string is split on the delimiter (env-friendly, e.g.
 * `"a,b,c"`). Item-level validation is applied by the caller via `itemValidator`.
 */
export function validateArray<T>(
  raw: unknown,
  itemValidator: (item: unknown, index: number) => Outcome<T>,
  opts: ArrayOptions = {},
): Outcome<T[]> {
  let items: unknown[];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    const delimiter = opts.delimiter ?? ',';
    items = raw.trim() === '' ? [] : raw.split(delimiter).map((s) => s.trim());
  } else {
    return err('array', `expected an array or delimited string, got ${typeName(raw)}`);
  }
  if (opts.minItems !== undefined && items.length < opts.minItems) {
    return err(`array (min ${opts.minItems} items)`, `array has too few items (${items.length} < ${opts.minItems})`);
  }
  if (opts.maxItems !== undefined && items.length > opts.maxItems) {
    return err(`array (max ${opts.maxItems} items)`, `array has too many items (${items.length} > ${opts.maxItems})`);
  }
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = itemValidator(items[i], i);
    if (!r.ok) return err(`array of ${r.expected}`, `item ${i}: ${r.message}`);
    out.push(r.value);
  }
  return ok(out);
}

// ── object ──────────────────────────────────────────────────────────────────────

export function validateObject(raw: unknown): Outcome<Record<string, unknown>> {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return ok(raw as Record<string, unknown>);
  }
  return err('object', `expected an object, got ${typeName(raw)}`);
}

// ── duration (→ milliseconds) ────────────────────────────────────────────────

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};
const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i;

/** Accepts a number (already ms) or a duration string (`"500ms"`, `"2s"`, `"1h"`). Returns ms. */
export function validateDuration(raw: unknown): Outcome<number> {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return ok(raw);
  if (typeof raw === 'string') {
    const v = raw.trim();
    if (/^\d+$/.test(v)) return ok(Number(v)); // bare number string = ms
    const m = DURATION_RE.exec(v);
    if (m) return ok(Number(m[1]) * DURATION_UNITS[m[2]!.toLowerCase()]!);
  }
  return err('duration', `expected a duration (e.g. "500ms", "2s", "1h") or a millisecond number, got ${typeName(raw)}`);
}

// ── url ──────────────────────────────────────────────────────────────────────

export interface UrlOptions {
  /** Allowed protocols (without colon), e.g. `["http", "https"]`. */
  readonly protocols?: readonly string[];
}

export function validateUrl(raw: unknown, opts: UrlOptions = {}): Outcome<string> {
  if (typeof raw !== 'string') return err('url', `expected a URL string, got ${typeName(raw)}`);
  const v = raw.trim();
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return err('url', `"${v}" is not a valid URL`);
  }
  if (opts.protocols && opts.protocols.length > 0) {
    const proto = url.protocol.replace(/:$/, '');
    if (!opts.protocols.includes(proto)) {
      return err(`url (protocol one of: ${opts.protocols.join(', ')})`, `URL protocol "${proto}" is not allowed`);
    }
  }
  return ok(v);
}

// ── file path ──────────────────────────────────────────────────────────────────

export function validatePath(raw: unknown): Outcome<string> {
  if (typeof raw !== 'string') return err('path', `expected a filesystem path string, got ${typeName(raw)}`);
  const v = raw.trim();
  if (v === '') return err('path', 'path must not be empty');
  if (v.includes('\0')) return err('path', 'path must not contain a null byte');
  return ok(v);
}

// ── hostname (RFC 1123) ────────────────────────────────────────────────────────

const HOSTNAME_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

export function validateHostname(raw: unknown): Outcome<string> {
  if (typeof raw !== 'string') return err('hostname', `expected a hostname string, got ${typeName(raw)}`);
  const v = raw.trim();
  if (v.length === 0 || v.length > 253) return err('hostname', 'hostname length must be 1–253 characters');
  const labels = v.split('.');
  if (!labels.every((l) => HOSTNAME_LABEL.test(l))) {
    return err('hostname', `"${v}" is not a valid RFC-1123 hostname`);
  }
  return ok(v);
}

// ── ip address ──────────────────────────────────────────────────────────────────

export function validateIp(raw: unknown, version?: 4 | 6): Outcome<string> {
  if (typeof raw !== 'string') return err('ip', `expected an IP address string, got ${typeName(raw)}`);
  const v = raw.trim();
  const detected = isIP(v); // 0 = invalid, 4 or 6
  if (detected === 0) return err('ip', `"${v}" is not a valid IP address`);
  if (version && detected !== version) {
    return err(`IPv${version} address`, `"${v}" is IPv${detected}, expected IPv${version}`);
  }
  return ok(v);
}

// ── email ──────────────────────────────────────────────────────────────────────

// Pragmatic, defensive email check: single @, non-empty local part, a dotted
// domain with valid labels. Not a full RFC-5322 parser (deliberately strict).
const EMAIL_RE = /^[^\s@]+@(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))+$/i;

export function validateEmail(raw: unknown): Outcome<string> {
  if (typeof raw !== 'string') return err('email', `expected an email string, got ${typeName(raw)}`);
  const v = raw.trim();
  if (!EMAIL_RE.test(v) || v.length > 254) return err('email', `"${v}" is not a valid email address`);
  return ok(v);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export { ok as makeOk, err as makeErr };
