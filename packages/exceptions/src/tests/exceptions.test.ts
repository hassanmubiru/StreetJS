import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  StreetException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  UnprocessableException,
  InternalException,
  ServiceUnavailableException,
  DatabaseConnectionError,
  FeatureUnavailableInEdgeRuntimeError,
  isStreetException,
} from '../index.js';

test('StreetException carries status, message, name, and serializes to JSON', () => {
  const e = new StreetException(418, "I'm a teapot", { hint: 'brew' });
  assert.equal(e.status, 418);
  assert.equal(e.message, "I'm a teapot");
  assert.equal(e.name, 'StreetException');
  assert.ok(e instanceof Error);
  assert.deepEqual(e.toJSON(), {
    error: 'StreetException',
    message: "I'm a teapot",
    status: 418,
    details: { hint: 'brew' },
  });
});

test('toJSON omits details when absent', () => {
  const e = new StreetException(500, 'boom');
  assert.deepEqual(e.toJSON(), { error: 'StreetException', message: 'boom', status: 500 });
});

test('each subclass sets the right status and name, with defaults', () => {
  const cases: Array<[StreetException, number, string]> = [
    [new BadRequestException(), 400, 'BadRequestException'],
    [new UnauthorizedException(), 401, 'UnauthorizedException'],
    [new ForbiddenException(), 403, 'ForbiddenException'],
    [new NotFoundException(), 404, 'NotFoundException'],
    [new ConflictException(), 409, 'ConflictException'],
    [new UnprocessableException(), 422, 'UnprocessableException'],
    [new InternalException(), 500, 'InternalException'],
    [new ServiceUnavailableException(), 503, 'ServiceUnavailableException'],
  ];
  for (const [e, status, name] of cases) {
    assert.equal(e.status, status);
    assert.equal(e.name, name);
    assert.ok(isStreetException(e));
  }
});

test('subclasses accept custom messages and details', () => {
  assert.equal(new BadRequestException('bad', { field: 'x' }).details !== undefined, true);
  assert.equal(new ConflictException('dup', { key: 1 }).status, 409);
  assert.equal(new UnauthorizedException('nope').message, 'nope');
});

test('DatabaseConnectionError includes a suggestion in JSON when set', () => {
  const e = new DatabaseConnectionError('cannot connect', 'start docker compose');
  assert.equal(e.status, 503);
  const json = e.toJSON() as Record<string, unknown>;
  assert.equal(json.suggestion, 'start docker compose');
  assert.equal(json.message, 'cannot connect');
  // Without a suggestion it is omitted.
  assert.equal('suggestion' in new DatabaseConnectionError().toJSON(), false);
});

test('FeatureUnavailableInEdgeRuntimeError formats a 501 message', () => {
  const e = new FeatureUnavailableInEdgeRuntimeError('WebSockets');
  assert.equal(e.status, 501);
  assert.match(e.message, /WebSockets is not available in the Edge runtime/);
});

test('isStreetException distinguishes framework errors from plain errors', () => {
  assert.equal(isStreetException(new NotFoundException()), true);
  assert.equal(isStreetException(new Error('plain')), false);
  assert.equal(isStreetException('nope'), false);
  assert.equal(isStreetException(null), false);
});
