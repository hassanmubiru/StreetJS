import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { serializeCookie, type CookieOptions } from '../src/core/context.js';

// Feature: security-hardening, Property 1: Cookie flags resolve to the secure default unless explicitly overridden
//
// For any cookie name, value, option set, and NODE_ENV value, the string produced
// by `serializeCookie` SHALL:
//   - include `HttpOnly` exactly when `httpOnly` is not `false`;
//   - include `Secure` exactly when `secure === true`, OR (`secure` unspecified AND
//     NODE_ENV === 'production');
//   - include `SameSite=<v>` where `v` is the caller's `sameSite` when provided and
//     `Lax` otherwise.
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 10.1, 10.3

// ---- generators -------------------------------------------------------------

// Cookie names from token-safe characters so the `name=value` head never contains
// the `'; '` attribute separator (keeps attribute parsing unambiguous).
const nameArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')), {
    minLength: 1,
    maxLength: 16,
  })
  .map((chars) => chars.join(''));

// Arbitrary value; serializeCookie encodes it with encodeURIComponent, so it can be
// anything (including characters that would otherwise break the header).
const valueArb = fc.string();

// Each flag is independently present-or-absent, and when present is an explicit
// true/false (or an explicit SameSite value). `requiredKeys: []` makes every key
// optional, so "absent" means `undefined` (the unspecified case).
const optionsArb: fc.Arbitrary<CookieOptions> = fc.record(
  {
    httpOnly: fc.boolean(),
    secure: fc.boolean(),
    sameSite: fc.constantFrom<'Strict' | 'Lax' | 'None'>('Strict', 'Lax', 'None'),
    maxAge: fc.nat({ max: 86_400 }),
    path: fc.constantFrom('/', '/app', '/a/b'),
    domain: fc.constantFrom('example.com', 'sub.example.com'),
  },
  { requiredKeys: [] },
);

// Both production and non-production NODE_ENV states, including "unset" (deleted).
const NODE_ENV_SENTINEL_UNSET = '\u0000__unset__';
const nodeEnvArb = fc.constantFrom('production', 'development', 'test', 'staging', NODE_ENV_SENTINEL_UNSET);

// ---- helpers ----------------------------------------------------------------

function applyNodeEnv(env: string): void {
  if (env === NODE_ENV_SENTINEL_UNSET) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = env;
  }
}

/** Parse the attribute segments (everything after the leading `name=value`). */
function attributesOf(cookie: string): string[] {
  return cookie.split('; ').slice(1);
}

// ---- property ---------------------------------------------------------------

describe('Property 1: cookie flags resolve to the secure default unless explicitly overridden', () => {
  it('resolves HttpOnly, Secure, and SameSite per the secure-by-default rules across all inputs', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      fc.assert(
        fc.property(nameArb, valueArb, optionsArb, nodeEnvArb, (name, value, options, env) => {
          applyNodeEnv(env);

          const cookie = serializeCookie(name, value, options);
          const attrs = attributesOf(cookie);

          const isProduction = env === 'production';

          // --- HttpOnly: present iff httpOnly is not false (Req 1.1, 1.5) ---
          const expectHttpOnly = options.httpOnly !== false;
          assert.equal(
            attrs.includes('HttpOnly'),
            expectHttpOnly,
            `HttpOnly mismatch for httpOnly=${String(options.httpOnly)} (env=${env})`,
          );

          // --- Secure: present iff secure===true OR (unspecified AND production)
          //     (Req 1.2, 1.3, 1.6, 1.9) ---
          const expectSecure =
            options.secure === true || (options.secure === undefined && isProduction);
          assert.equal(
            attrs.includes('Secure'),
            expectSecure,
            `Secure mismatch for secure=${String(options.secure)} env=${env}`,
          );

          // --- SameSite: caller's value when provided, else Lax (Req 1.4, 1.7) ---
          const expectedSameSite = options.sameSite ?? 'Lax';
          assert.ok(
            attrs.includes(`SameSite=${expectedSameSite}`),
            `expected SameSite=${expectedSameSite} for sameSite=${String(options.sameSite)}`,
          );
          // Exactly one SameSite attribute is emitted.
          assert.equal(
            attrs.filter((a) => a.startsWith('SameSite=')).length,
            1,
            'exactly one SameSite attribute expected',
          );
        }),
        { numRuns: 200 },
      );
    } finally {
      // Restore the original NODE_ENV regardless of outcome.
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });
});
