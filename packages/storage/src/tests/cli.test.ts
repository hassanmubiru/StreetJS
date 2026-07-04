// cli.test.js — unit tests for the @streetjs/storage CLI generators and the
// storage:verify command (Requirements 21.2, 21.4).
//
// Covers three concerns:
//   (1) Generator name validation — isValidGeneratorName / generateStorage
//       reject invalid names and accept valid PascalCase identifiers.
//   (2) Compile-clean scaffold output — the generated `contents` imports only
//       public @streetjs/storage symbols (createStorage + StorageConfig) and
//       wires them into a typed factory.
//   (3) storage:verify pass/fail reporting — StorageCommands.storageVerify
//       reports a pass for the built-in memory provider (process.exitCode is
//       not set to 1) and a failure for an unknown/misconfigured provider
//       (process.exitCode === 1).
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.

import test from "node:test";
import assert from "node:assert/strict";

import type { ParsedArgs } from "streetjs";

import {
  generateStorage,
  isValidGeneratorName,
  isValidProvider,
  DEFAULT_STORAGE_DIR,
} from "../cli/generators.js";
import type { BuiltInProvider } from "../cli/generators.js";
import { StorageCommands } from "../cli/commands.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a ParsedArgs object matching the shape streetjs' parseArgv produces. */
function parsedArgs(
  options: {
    command?: string | null;
    positional?: string[];
    flags?: Record<string, string | boolean>;
  } = {},
): ParsedArgs {
  const { command = null, positional = [], flags = {} } = options;
  return { command, positional, flags };
}

/**
 * Run `fn` while capturing everything written to console.log/console.error and
 * with process.exitCode reset, restoring both afterwards. Returns the captured
 * output plus the exitCode observed after `fn` completes.
 */
async function captureRun(fn: () => unknown): Promise<{
  logs: string[];
  errors: string[];
  exitCode: typeof process.exitCode;
}> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const logs: string[] = [];
  const errors: string[] = [];
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  process.exitCode = undefined;
  try {
    await fn();
    return { logs, errors, exitCode: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

// ── (1) Generator name validation ──────────────────────────────────────────────

test("isValidGeneratorName rejects invalid names and accepts PascalCase", () => {
  // Invalid: empty, non-identifier, leading digit, hyphen/space/dot.
  assert.equal(isValidGeneratorName(""), false);
  assert.equal(isValidGeneratorName("1Uploads"), false);
  assert.equal(isValidGeneratorName("my-storage"), false);
  assert.equal(isValidGeneratorName("my storage"), false);
  assert.equal(isValidGeneratorName("Up.loads"), false);
  assert.equal(isValidGeneratorName("$Uploads"), false);

  // Valid: identifier-safe tokens including PascalCase.
  assert.equal(isValidGeneratorName("Uploads"), true);
  assert.equal(isValidGeneratorName("UserAvatars"), true);
  assert.equal(isValidGeneratorName("A1"), true);
  assert.equal(isValidGeneratorName("uploads"), true);
});

test("generateStorage throws for invalid names before producing output", () => {
  assert.throws(() => generateStorage(""), /Invalid generator name/);
  assert.throws(() => generateStorage("bad-name"), /Invalid generator name/);
  assert.throws(() => generateStorage("9lives"), /Invalid generator name/);
});

test("generateStorage throws for a non-built-in provider", () => {
  assert.throws(
    () => generateStorage("Uploads", DEFAULT_STORAGE_DIR, "s3" as BuiltInProvider),
    /Invalid storage provider/,
  );
  assert.equal(isValidProvider("memory"), true);
  assert.equal(isValidProvider("local"), true);
  assert.equal(isValidProvider("s3"), false);
});

// ── (2) Compile-clean scaffold output ──────────────────────────────────────────

test("generateStorage emits a scaffold importing only public @streetjs/storage symbols", () => {
  const result = generateStorage("Uploads");

  // Path is derived from the PascalCase class name under the default dir.
  assert.ok(result.path.endsWith("UploadsStorage.ts"), `unexpected path: ${result.path}`);

  const contents = result.contents;

  // Imports only the public package entry point (no deep/internal imports).
  assert.match(contents, /import \{ createStorage \} from "@streetjs\/storage";/);
  assert.match(contents, /import type \{ Storage, StorageConfig \} from "@streetjs\/storage";/);
  assert.ok(
    !/from "\.\//.test(contents) && !/from "\.\.\//.test(contents),
    "scaffold must not import from relative/internal paths",
  );

  // Wires a typed StorageConfig and a factory that calls createStorage.
  assert.match(contents, /: StorageConfig = \{/);
  assert.match(contents, /provider: "memory"/);
  assert.match(contents, /export function createUploadsStorage\(\): Storage \{/);
  assert.match(contents, /return createStorage\(/);
});

test("generateStorage local provider scaffold supplies a root and stays on the public surface", () => {
  const result = generateStorage("Assets", DEFAULT_STORAGE_DIR, "local");
  const contents = result.contents;
  assert.match(contents, /provider: "local"/);
  assert.match(contents, /root: "\.\/var\/assets"/);
  assert.match(contents, /import \{ createStorage \} from "@streetjs\/storage";/);
});

// ── (3) storage:verify pass/fail reporting ──────────────────────────────────────

test("storageVerify reports a pass for the built-in memory provider", async () => {
  const commands = new StorageCommands();
  const args = parsedArgs({ command: "storage:verify", flags: { provider: "memory" } });

  const { logs, exitCode } = await captureRun(() => commands.storageVerify(args));

  // A passing run must NOT set a failure exit code.
  assert.notEqual(exitCode, 1);
  const output = logs.join("\n");
  assert.match(output, /Contract conformance for driver "memory"/);
  assert.match(output, /— PASS\./);
  // No FAIL check lines expected.
  assert.ok(!/\[FAIL\]/.test(output), "memory provider should have no failing checks");
});

test("storageVerify reports failure for an unknown provider (exitCode 1)", async () => {
  const commands = new StorageCommands();
  const args = parsedArgs({ command: "storage:verify", flags: { provider: "does-not-exist" } });

  const { errors, exitCode } = await captureRun(() => commands.storageVerify(args));

  assert.equal(exitCode, 1);
  assert.match(errors.join("\n"), /Unknown storage provider "does-not-exist"/);
});

test("storageVerify reports failure for a misconfigured local provider (missing root)", async () => {
  const commands = new StorageCommands();
  const args = parsedArgs({ command: "storage:verify", flags: { provider: "local" } });

  const { errors, exitCode } = await captureRun(() => commands.storageVerify(args));

  assert.equal(exitCode, 1);
  assert.match(errors.join("\n"), /"local" storage provider requires a "root" directory/);
});
