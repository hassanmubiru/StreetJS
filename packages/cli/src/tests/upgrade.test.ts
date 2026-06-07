// packages/cli/src/tests/upgrade.test.ts
// Tests `street upgrade`: dry-run preview (no file mutation), --write apply,
// --list, and codemod selection across a temp project tree.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UpgradeCommand } from '../commands/upgrade.js';

function captureConsole() {
  const logs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { logs.push(a.join(' ')); };
  return { logs, restore: () => { console.log = origLog; console.error = origErr; } };
}

function ctx(cwd: string, positional: string[] = [], flags: Record<string, unknown> = {}) {
  return { cwd, args: { command: 'upgrade', positional, flags } };
}

void describe('UpgradeCommand', () => {
  let dir: string;
  const before2 = "import { RabbitMQTransport } from '@streetjs/core';\nconst t = new RabbitMQTransport({ host: 'h' });\n";

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'street-upgrade-'));
    mkdirSync(join(dir, 'src', 'sub'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), before2);
    writeFileSync(join(dir, 'src', 'sub', 'b.ts'), "export const ok = new RabbitMqTransport();\n"); // already migrated
    writeFileSync(join(dir, 'node_modules', 'pkg', 'c.ts'), before2); // must be ignored
  });

  after(() => { rmSync(dir, { recursive: true, force: true }); });

  void it('--list prints available codemods', async () => {
    const { logs, restore } = captureConsole();
    try { await new UpgradeCommand().execute(ctx(dir, [], { list: true })); } finally { restore(); }
    const out = logs.join('\n');
    assert.match(out, /rename-rabbitmq-transport/);
  });

  void it('dry-run reports changes WITHOUT modifying files', async () => {
    const { logs, restore } = captureConsole();
    try { await new UpgradeCommand().execute(ctx(dir, ['src'], {})); } finally { restore(); }
    const out = logs.join('\n');
    assert.match(out, /would update/);
    assert.match(out, /files changed:\s*1/);
    assert.match(out, /total changes:\s*2/);
    // File on disk is unchanged after a dry-run.
    assert.equal(readFileSync(join(dir, 'src', 'a.ts'), 'utf8'), before2);
    // node_modules was not scanned.
    assert.ok(!out.includes('node_modules'));
  });

  void it('--write applies codemods to disk', async () => {
    const { logs, restore } = captureConsole();
    try { await new UpgradeCommand().execute(ctx(dir, ['src'], { write: true })); } finally { restore(); }
    const out = logs.join('\n');
    assert.match(out, /mode:\s*WRITE/);
    const updated = readFileSync(join(dir, 'src', 'a.ts'), 'utf8');
    assert.match(updated, /import \{ RabbitMqTransport \}/);
    assert.match(updated, /new RabbitMqTransport\(/);
    assert.ok(!/RabbitMQTransport/.test(updated));
    // Already-migrated file is untouched / unaffected.
    assert.match(readFileSync(join(dir, 'src', 'sub', 'b.ts'), 'utf8'), /RabbitMqTransport/);
  });

  void it('re-running after --write reports zero changes (idempotent)', async () => {
    const { logs, restore } = captureConsole();
    try { await new UpgradeCommand().execute(ctx(dir, ['src'], {})); } finally { restore(); }
    assert.match(logs.join('\n'), /total changes:\s*0/);
  });
});
