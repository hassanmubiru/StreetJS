import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PgConnection, StreetPostgresWireStream, PgHaClient, POSTGRES } from '../index.js';

test('the public API is exported from the barrel', () => {
  assert.equal(typeof PgConnection, 'function');
  assert.equal(typeof StreetPostgresWireStream, 'function');
  assert.equal(typeof PgHaClient, 'function');
  // The stream and HA client construct without a live server.
  const s = new StreetPostgresWireStream();
  assert.ok(s instanceof StreetPostgresWireStream);
  s.destroy();
  const ha = new PgHaClient({ hosts: [{ host: 'x', port: 5432 }], user: 'u', password: 'p', database: 'd' });
  assert.ok(ha instanceof PgHaClient);
});

test('POSTGRES is a stable global symbol', () => {
  assert.equal(POSTGRES, Symbol.for('@streetjs/postgres:Connection'));
});
