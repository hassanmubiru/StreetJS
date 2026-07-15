import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StreetPostgresWireStream } from '../wire.js';

test('streams pushed rows to a data consumer then ends', async () => {
  const s = new StreetPostgresWireStream();
  const got: unknown[] = [];
  s.on('data', (r: unknown) => got.push(r));
  s.pushRow({ x: '1' });
  s.pushRow({ x: '2' });
  s.pushRow({ x: '3' });
  s.finalize();
  await new Promise<void>((resolve) => s.on('end', resolve));
  assert.deepEqual(got, [{ x: '1' }, { x: '2' }, { x: '3' }]);
});

test('supports for-await-of consumption', async () => {
  const s = new StreetPostgresWireStream();
  s.pushRow({ v: 'a' });
  s.pushRow({ v: 'b' });
  s.finalize();
  const got: unknown[] = [];
  for await (const row of s) {
    got.push(row);
  }
  assert.deepEqual(got, [{ v: 'a' }, { v: 'b' }]);
});

test('an empty stream ends with no rows', async () => {
  const s = new StreetPostgresWireStream();
  const got: unknown[] = [];
  s.on('data', (r: unknown) => got.push(r));
  s.finalize();
  await new Promise<void>((resolve) => s.on('end', resolve));
  assert.equal(got.length, 0);
});

test('pushRow after finalize returns false and pushes nothing', () => {
  const s = new StreetPostgresWireStream();
  s.finalize();
  assert.equal(s.pushRow({ a: '1' }), false);
  s.destroy();
});

test('finalize(error) destroys the stream with that error', async () => {
  const s = new StreetPostgresWireStream();
  const err = await new Promise<Error>((resolve) => {
    s.on('error', (e: Error) => resolve(e));
    s.finalize(new Error('stream boom'));
  });
  assert.match(err.message, /stream boom/);
});

test('_read is a safe no-op', () => {
  const s = new StreetPostgresWireStream();
  assert.doesNotThrow(() => s.read(0));
  s.destroy();
});
