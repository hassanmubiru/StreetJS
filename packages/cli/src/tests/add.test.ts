// add.test.ts
// Unit tests for `street add <feature>`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AddCommand, FEATURES } from '../commands/add.js';

function capture() {
  const out = { logs: [] as string[], errors: [] as string[] };
  const ol = console.log, oe = console.error;
  console.log = (...a: unknown[]) => { out.logs.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { out.errors.push(a.join(' ')); };
  return { out, restore: () => { console.log = ol; console.error = oe; } };
}

function ctx(positional: string[], flags: Record<string, string | boolean> = {}) {
  process.exitCode = 0;
  return { cwd: process.cwd(), args: { command: 'add', positional, flags } };
}

describe('street add', () => {
  it('errors with usage when no feature given', async () => {
    const c = capture();
    try { await new AddCommand().execute(ctx([])); } finally { c.restore(); }
    assert.equal(process.exitCode, 1);
    assert.ok(c.out.errors.join('\n').includes('Usage: street add'));
    process.exitCode = 0;
  });

  it('errors on unknown feature and lists available', async () => {
    const c = capture();
    try { await new AddCommand().execute(ctx(['nonsense'])); } finally { c.restore(); }
    assert.equal(process.exitCode, 1);
    assert.ok(c.out.errors.join('\n').includes('Unknown feature'));
    assert.ok(c.out.errors.join('\n').includes('ai'));
    process.exitCode = 0;
  });

  it('core feature (postgres) needs no install and prints a snippet', async () => {
    const c = capture();
    try { await new AddCommand().execute(ctx(['postgres'])); } finally { c.restore(); }
    const log = c.out.logs.join('\n');
    assert.ok(log.includes('built into streetjs core'));
    assert.ok(log.includes('PgPool'));
    assert.equal(process.exitCode, 0);
  });

  it('external feature (ai) with --dry-run shows the install plan, does not install', async () => {
    const c = capture();
    try { await new AddCommand().execute(ctx(['ai'], { 'dry-run': true })); } finally { c.restore(); }
    const log = c.out.logs.join('\n');
    assert.ok(log.includes('@streetjs/ai'));
    assert.ok(log.includes('(dry-run) would run: npm install @streetjs/ai'));
    assert.equal(process.exitCode, 0);
  });

  it('exposes the documented feature set', () => {
    for (const f of ['auth', 'postgres', 'websocket', 'search', 'ai']) {
      assert.ok(FEATURES[f], `feature ${f} must exist`);
    }
  });
});
