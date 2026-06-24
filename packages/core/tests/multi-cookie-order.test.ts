import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fc from 'fast-check';

import { createContext, serializeCookie, type CookieOptions } from '../src/core/context.js';

// Feature: security-hardening, Property 2: Multiple cookies are preserved in write order
//
// For any sequence of cookies written to a single response, the response's
// `Set-Cookie` header SHALL be a list whose entries equal the serialized cookies
// in the exact order they were written, with length equal to the number of writes
// and no prior value dropped.
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4

// ---- minimal fakes ----------------------------------------------------------

/**
 * Minimal fake `ServerResponse` exposing only the header-bag surface that
 * `setCookie` touches (`getHeader` / `setHeader`). Node serializes a `string[]`
 * `Set-Cookie` header as multiple `Set-Cookie` lines, so storing the array shape
 * here faithfully mirrors the production behavior under test.
 */
function makeFakeResponse(): {
  res: ServerResponse;
  getSetCookie: () => number | string | string[] | undefined;
} {
  const bag = new Map<string, number | string | string[]>();
  const res = {
    getHeader(name: string): number | string | string[] | undefined {
      return bag.get(name.toLowerCase());
    },
    setHeader(name: string, value: number | string | string[]): void {
      bag.set(name.toLowerCase(), value);
    },
  } as unknown as ServerResponse;
  return { res, getSetCookie: () => bag.get('set-cookie') };
}

/** Minimal fake `IncomingMessage` providing the fields `createContext` reads. */
function makeFakeRequest(): IncomingMessage {
  return { headers: {}, method: 'GET' } as unknown as IncomingMessage;
}

// ---- generators -------------------------------------------------------------

// Token-safe cookie names so distinct names stay distinct and the `name=value`
// head never contains the `'; '` attribute separator.
const nameArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split(''),
    ),
    { minLength: 1, maxLength: 12 },
  )
  .map((chars) => chars.join(''));

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

interface CookieSpec {
  name: string;
  value: string;
  options: CookieOptions;
}

// An array of N distinct cookies over a bounded range. Names are made unique so
// each write is a genuinely distinct cookie (selector key = name).
const cookieSequenceArb: fc.Arbitrary<CookieSpec[]> = fc
  .uniqueArray(nameArb, { minLength: 1, maxLength: 10 })
  .chain((names) =>
    fc.tuple(
      ...names.map((name) =>
        fc.record({
          name: fc.constant(name),
          value: fc.string(),
          options: optionsArb,
        }),
      ),
    ),
  );

// ---- property ---------------------------------------------------------------

describe('Property 2: multiple cookies are preserved in write order', () => {
  it('writes N distinct cookies as a Set-Cookie list of length N in write order', () => {
    fc.assert(
      fc.property(cookieSequenceArb, (cookies) => {
        const { res, getSetCookie } = makeFakeResponse();
        const ctx = createContext(makeFakeRequest(), res, '/', {});

        for (const { name, value, options } of cookies) {
          ctx.setCookie(name, value, options);
        }

        const header = getSetCookie();

        // The header is a list (Req 2.1).
        assert.ok(Array.isArray(header), 'Set-Cookie should be an array');
        const list = header as string[];

        // Length equals the number of writes; no prior value dropped (Req 2.3).
        assert.equal(
          list.length,
          cookies.length,
          `expected ${cookies.length} Set-Cookie values, got ${list.length}`,
        );

        // Entries equal the serialized cookies in the exact write order
        // (Req 2.2 append-not-overwrite, Req 2.4 order preserved).
        const expected = cookies.map(({ name, value, options }) =>
          serializeCookie(name, value, options),
        );
        assert.deepEqual(list, expected);
      }),
      { numRuns: 200 },
    );
  });
});
