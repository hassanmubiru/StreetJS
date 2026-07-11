// packages/cli/src/tests/env.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, loadEnvFile } from '../env.js';

describe('parseEnv', () => {
  it('parses KEY=value, quotes, export, comments, and blanks', () => {
    const env = parseEnv([
      '# a comment',
      '',
      'PORT=3000',
      'export HOST=127.0.0.1',
      'JWT_SECRET="a b c"',
      "SESSION_KEY='deadbeef'",
      'CORS= ',
      'TRAILING=value # inline comment',
      'not a var line',
      'BAD-KEY=nope',
    ].join('\n'));
    assert.equal(env['PORT'], '3000');
    assert.equal(env['HOST'], '127.0.0.1');
    assert.equal(env['JWT_SECRET'], 'a b c');
    assert.equal(env['SESSION_KEY'], 'deadbeef');
    assert.equal(env['CORS'], '');
    assert.equal(env['TRAILING'], 'value');
    assert.equal(env['BAD-KEY'], undefined);
  });
});

describe('loadEnvFile', () => {
  it('loads absent vars but never overrides existing process.env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-'));
    writeFileSync(join(dir, '.env'), 'FROM_DOTENV=yes\nALREADY_SET=from-dotenv\n');
    process.env['ALREADY_SET'] = 'from-shell';
    delete process.env['FROM_DOTENV'];
    const n = loadEnvFile(dir);
    assert.equal(process.env['FROM_DOTENV'], 'yes', 'absent var loaded');
    assert.equal(process.env['ALREADY_SET'], 'from-shell', 'existing var NOT overridden');
    assert.ok(n >= 1);
    delete process.env['FROM_DOTENV'];
    delete process.env['ALREADY_SET'];
  });

  it('is a no-op when no .env exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-'));
    assert.equal(loadEnvFile(dir), 0);
  });
});
