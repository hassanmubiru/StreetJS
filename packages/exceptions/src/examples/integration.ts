/**
 * @streetjs/exceptions — runnable integration example.
 *
 * Demonstrates throwing the typed HTTP exceptions, serializing them to JSON,
 * and using the `isStreetException` type guard inside an error handler — the
 * exact shape a framework error middleware relies on.
 *
 * Run with: `npm run example -w packages/exceptions`
 */

import {
  StreetException,
  BadRequestException,
  NotFoundException,
  ConflictException,
  DatabaseConnectionError,
  FeatureUnavailableInEdgeRuntimeError,
  isStreetException,
} from '../index.js';

/** A minimal error handler like a framework would install. */
function toHttpResponse(err: unknown): { status: number; body: string } {
  if (isStreetException(err)) {
    return { status: err.status, body: JSON.stringify(err) };
  }
  // Unknown errors collapse to a generic 500 — never leak internals.
  return { status: 500, body: JSON.stringify({ error: 'InternalException', status: 500 }) };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

// 1. A validation failure with structured details.
const bad = new BadRequestException('email is required', { field: 'email' });
const badRes = toHttpResponse(bad);
assert(badRes.status === 400, 'bad request maps to 400');
console.log('400 ->', badRes.body);

// 2. A missing resource.
const missing = new NotFoundException('user 42 not found');
const missingRes = toHttpResponse(missing);
assert(missingRes.status === 404, 'not found maps to 404');
console.log('404 ->', missingRes.body);

// 3. A conflict with details.
const conflict = new ConflictException('username taken', { username: 'ada' });
assert(toHttpResponse(conflict).status === 409, 'conflict maps to 409');
console.log('409 ->', toHttpResponse(conflict).body);

// 4. A database outage with an operator suggestion (extra JSON field).
const dbDown = new DatabaseConnectionError('cannot reach primary', 'check DATABASE_URL');
const dbJson = dbDown.toJSON() as Record<string, unknown>;
assert(dbJson.suggestion === 'check DATABASE_URL', 'db error carries suggestion');
console.log('503 ->', JSON.stringify(dbDown));

// 5. An Edge-runtime capability gap.
const edge = new FeatureUnavailableInEdgeRuntimeError('WebSockets');
assert(edge.status === 501, 'edge feature maps to 501');
console.log('501 ->', JSON.stringify(edge));

// 6. The guard rejects non-framework errors so they collapse to a safe 500.
const plain = toHttpResponse(new Error('unexpected boom'));
assert(plain.status === 500, 'plain errors collapse to 500');
assert(!isStreetException(new Error('x')), 'guard rejects plain errors');

// 7. The base class is directly usable for custom status codes.
const teapot = new StreetException(418, "I'm a teapot");
assert(teapot.status === 418, 'base class carries arbitrary status');

console.log('\nAll @streetjs/exceptions example assertions passed.');
