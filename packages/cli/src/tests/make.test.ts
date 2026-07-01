// packages/cli/src/tests/make.test.ts
// Unit tests for `street make:channel` — name normalization/validation,
// missing-name usage exit, no-overwrite protection, and template output.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MakeCommand, toMakePascalCase, toMakeChannelName } from '../commands/make.js';

function captureConsole(): { logs: string[]; errors: string[]; restore: () => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

function makeContext(cwd: string, positional: string[]) {
  return {
    cwd,
    args: { command: 'make:channel', positional, flags: {} as Record<string, string | boolean> },
  };
}

function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'street-make-test-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

void describe('make:channel helpers', () => {
  void it('normalizes names to PascalCase', () => {
    assert.equal(toMakePascalCase('general'), 'General');
    assert.equal(toMakePascalCase('chatRoom'), 'ChatRoom');
    assert.equal(toMakePascalCase('ABC'), 'ABC');
  });

  void it('derives a camelCase channel name from a PascalCase name', () => {
    assert.equal(toMakeChannelName('General'), 'general');
    assert.equal(toMakeChannelName('ChatRoom'), 'chatRoom');
  });
});

void describe('MakeCommand.executeChannel', () => {
  void it('generates src/channels/<Name>Channel.ts with typed template', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      const { logs, restore } = captureConsole();
      await new MakeCommand().executeChannel(makeContext(dir, ['general']));
      restore();

      assert.equal(process.exitCode, 0);
      const filePath = join(dir, 'src', 'channels', 'GeneralChannel.ts');
      assert.ok(existsSync(filePath), 'GeneralChannel.ts should be created');

      const content = readFileSync(filePath, 'utf8');
      assert.ok(content.includes("from '@streetjs/realtime'"), 'imports public realtime symbols');
      assert.ok(content.includes('export class GeneralChannel'), 'exports PascalCase class');
      assert.ok(content.includes('export type GeneralMessage'), 'exports typed message union');
      assert.ok(content.includes("channelName = 'general' as const"), 'binds camelCase channel name');
      assert.ok(logs.some((l) => l.includes('Generated channel')), 'prints success message');
    });
  });

  void it('lowercases the first letter for the channel name of an uppercase input', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      const { restore } = captureConsole();
      await new MakeCommand().executeChannel(makeContext(dir, ['ChatRoom']));
      restore();

      const content = readFileSync(join(dir, 'src', 'channels', 'ChatRoomChannel.ts'), 'utf8');
      assert.ok(content.includes("channelName = 'chatRoom' as const"));
      assert.ok(content.includes('export class ChatRoomChannel'));
    });
  });

  void it('exits non-zero with usage guidance when no name is given', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      const { errors, restore } = captureConsole();
      await new MakeCommand().executeChannel(makeContext(dir, []));
      restore();

      assert.notEqual(process.exitCode, 0);
      assert.ok(errors.some((e) => e.includes('Usage: street make:channel <Name>')));
      assert.ok(!existsSync(join(dir, 'src', 'channels')), 'no channel dir created on missing name');
    });
  });

  void it('exits non-zero for an invalid name and writes no file', async () => {
    await withTempDir(async (dir) => {
      for (const bad of ['my-channel', '1chat', 'chat room', 'chat.room']) {
        process.exitCode = 0;
        const { errors, restore } = captureConsole();
        await new MakeCommand().executeChannel(makeContext(dir, [bad]));
        restore();
        assert.notEqual(process.exitCode, 0, `"${bad}" should be rejected`);
        assert.ok(errors.some((e) => e.includes('Invalid name')));
      }
      assert.ok(!existsSync(join(dir, 'src', 'channels')), 'no files created for invalid names');
    });
  });

  void it('does not overwrite an existing file and exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const channelsDir = join(dir, 'src', 'channels');
      mkdirSync(channelsDir, { recursive: true });
      const filePath = join(channelsDir, 'GeneralChannel.ts');
      const sentinel = '// pre-existing content — must not be overwritten\n';
      writeFileSync(filePath, sentinel, 'utf8');

      process.exitCode = 0;
      const { errors, restore } = captureConsole();
      await new MakeCommand().executeChannel(makeContext(dir, ['general']));
      restore();

      assert.notEqual(process.exitCode, 0);
      assert.ok(errors.some((e) => e.includes('already exists')));
      assert.equal(readFileSync(filePath, 'utf8'), sentinel, 'existing content left byte-for-byte intact');
    });
  });

  void it('trims surrounding whitespace before validating and normalizing', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      const { restore } = captureConsole();
      await new MakeCommand().executeChannel(makeContext(dir, ['  general  ']));
      restore();

      assert.equal(process.exitCode, 0);
      assert.ok(existsSync(join(dir, 'src', 'channels', 'GeneralChannel.ts')));
    });
  });
});

void describe('MakeCommand.executeGateway', () => {
  void it('generates src/gateways/<Name>Gateway.ts wired to the Realtime facade', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      const { logs, restore } = captureConsole();
      await new MakeCommand().executeGateway(makeContext(dir, ['chat']));
      restore();

      assert.equal(process.exitCode, 0);
      const filePath = join(dir, 'src', 'gateways', 'ChatGateway.ts');
      assert.ok(existsSync(filePath), 'ChatGateway.ts should be created');

      const content = readFileSync(filePath, 'utf8');
      assert.ok(content.includes("from '@streetjs/realtime'"), 'imports public realtime symbols');
      assert.ok(content.includes('export class ChatGateway'), 'exports PascalCase gateway class');
      assert.ok(content.includes('private readonly realtime: Realtime'), 'wired to the Realtime facade');
      assert.ok(content.includes("room = 'chat' as const"), 'binds camelCase room name');
      assert.ok(logs.some((l) => l.includes('Generated gateway')), 'prints success message');
    });
  });

  void it('exits non-zero with usage guidance when no name is given', async () => {
    await withTempDir(async (dir) => {
      process.exitCode = 0;
      const { errors, restore } = captureConsole();
      await new MakeCommand().executeGateway(makeContext(dir, []));
      restore();

      assert.notEqual(process.exitCode, 0);
      assert.ok(errors.some((e) => e.includes('Usage: street make:gateway <Name>')));
      assert.ok(!existsSync(join(dir, 'src', 'gateways')), 'no gateway dir created on missing name');
    });
  });

  void it('does not overwrite an existing file and exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const gatewaysDir = join(dir, 'src', 'gateways');
      mkdirSync(gatewaysDir, { recursive: true });
      const filePath = join(gatewaysDir, 'ChatGateway.ts');
      const sentinel = '// pre-existing content — must not be overwritten\n';
      writeFileSync(filePath, sentinel, 'utf8');

      process.exitCode = 0;
      const { errors, restore } = captureConsole();
      await new MakeCommand().executeGateway(makeContext(dir, ['chat']));
      restore();

      assert.notEqual(process.exitCode, 0);
      assert.ok(errors.some((e) => e.includes('already exists')));
      assert.equal(readFileSync(filePath, 'utf8'), sentinel, 'existing content left byte-for-byte intact');
      // Reset so the exit code set by the command-under-test does not leak into
      // the test runner's own process exit status.
      process.exitCode = 0;
    });
  });
});
