// src/tests/cli.test.ts
// CLI tests for @streetjs/workflow (Requirements 24.1, 24.2, 24.3, 24.4, 24.5,
// 24.6, 31.4).
//
// Covers three concerns:
//   (1) Command registration — the six workflow commands (`make:workflow`,
//       `make:activity`, `workflow:list`, `workflow:run`, `workflow:cancel`,
//       `workflow:retry`) are exposed through the `@Command` metadata and can be
//       registered on the core `CliKernel` without collision (Req 24.1).
//   (2) Compile-clean scaffold output — the pure generators emit typed TypeScript
//       that imports only public `@streetjs/workflow` symbols and declares the
//       expected typed exports, so the generated source compiles under `tsc`
//       (Req 24.2, 31.4).
//   (3) Operational commands — `workflow:run` starts a run and prints its runId
//       (24.4); `workflow:list` prints each run's runId + Run_Status (24.3);
//       `workflow:cancel` cancels a waiting run and prints the resulting status
//       (24.5); `workflow:retry` retries a failed run and prints the new runId
//       (24.6). Each drives a `WorkflowCommands` built with an injected
//       `createWorkflow()` engine that has registered definitions.
//
// Uses the Node.js built-in test runner (node:test), executed via
// `node --test dist/tests/*.test.js`. Everything runs against the
// zero-dependency in-memory engine, so the tests need no external services.

import test from "node:test";
import assert from "node:assert/strict";

import { CliKernel, getCommandMeta } from "streetjs";
import type { Clock, ParsedArgs } from "streetjs";

import { WorkflowCommands } from "../cli/commands.js";
import {
  DEFAULT_ACTIVITY_DIR,
  DEFAULT_WORKFLOW_DIR,
  generateActivity,
  generateWorkflow,
} from "../cli/generators.js";
import { createWorkflow } from "../engine.js";
import type { WorkflowEngine } from "../engine.js";
import type { WorkflowFunction } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A deterministic fixed Clock so a far-future `ctx.sleep` stays `waiting`. */
const CLOCK: Clock = () => 1_000;

/** The six commands the Workflow_CLI must provide (Req 24.1). */
const EXPECTED_COMMANDS = [
  "make:workflow",
  "make:activity",
  "workflow:list",
  "workflow:run",
  "workflow:cancel",
  "workflow:retry",
] as const;

/** Build a ParsedArgs object matching the shape streetjs' parseArgv produces. */
function parsedArgs(
  { command = null, positional = [], flags = {} }: Partial<ParsedArgs> = {},
): ParsedArgs {
  return { command, positional, flags };
}

/**
 * Run `fn` while capturing everything written to console.log/console.error and
 * with process.exitCode reset, restoring all three afterwards. Returns the
 * captured output plus the exitCode observed after `fn` completes.
 */
async function captureRun(
  fn: () => void | Promise<void>,
): Promise<{ logs: string[]; errors: string[]; exitCode: number | string | undefined }> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const logs: string[] = [];
  const errors: string[] = [];
  console.log = (...args: unknown[]): void => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]): void => {
    errors.push(args.map(String).join(" "));
  };
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

// ── (1) Command registration (Req 24.1) ─────────────────────────────────────────

test("WorkflowCommands exposes the six workflow commands via @Command metadata (Req 24.1)", () => {
  const meta = getCommandMeta(WorkflowCommands);
  const names = meta.map((cmd) => cmd.name);

  for (const expected of EXPECTED_COMMANDS) {
    assert.ok(names.includes(expected), `missing @Command "${expected}" (found: ${names.join(", ")})`);
  }
  // Every registered command must carry a non-empty description and a handler.
  for (const cmd of meta) {
    assert.equal(typeof cmd.handlerMethod, "string");
    assert.ok(cmd.handlerMethod.length > 0, `command "${cmd.name}" has no handler method`);
    assert.ok(cmd.description.length > 0, `command "${cmd.name}" has no description`);
  }
});

test("WorkflowCommands registers on the core CliKernel without collision (Req 24.1)", () => {
  const kernel = new CliKernel({ appName: "street" });
  // Registration resolves the plain class through the DI container (no ctor deps)
  // and installs each @Command; a duplicate command name would throw.
  assert.doesNotThrow(() => kernel.register(WorkflowCommands));
});

// ── (2) Compile-clean scaffold output (Req 24.2, 31.4) ──────────────────────────

test("generateWorkflow emits typed TS importing only public @streetjs/workflow symbols (Req 24.2, 31.4)", () => {
  const result = generateWorkflow("Sample");

  // Path derives from the PascalCase name under the default workflow dir.
  assert.ok(result.path.endsWith("SampleWorkflow.ts"), `unexpected path: ${result.path}`);
  assert.ok(result.path.startsWith(DEFAULT_WORKFLOW_DIR), `path not under default dir: ${result.path}`);

  const contents = result.contents;

  // Imports ONLY the public package entry point (no deep/relative imports).
  assert.match(contents, /import \{ createWorkflow \} from "@streetjs\/workflow";/);
  assert.match(
    contents,
    /import type \{ WorkflowContext, WorkflowEngine \} from "@streetjs\/workflow";/,
  );
  assert.ok(
    !/from "\.\.?\//.test(contents),
    "scaffold must not import from relative/internal paths",
  );

  // Declares the expected typed exports (input/output types, name const, the
  // imperative Workflow_Function, and a typed engine factory).
  assert.match(contents, /export interface SampleInput \{/);
  assert.match(contents, /export interface SampleOutput \{/);
  assert.match(contents, /export const SAMPLE_WORKFLOW = "sample" as const;/);
  assert.match(
    contents,
    /export async function sampleWorkflow\(\s*ctx: WorkflowContext,\s*input: SampleInput,\s*\): Promise<SampleOutput>/,
  );
  assert.match(contents, /export function createSampleWorkflow\(\): WorkflowEngine \{/);
});

test("generateActivity emits a typed Activity importing only public @streetjs/workflow symbols (Req 24.2, 31.4)", () => {
  const result = generateActivity("Charge");

  assert.ok(result.path.endsWith("ChargeActivity.ts"), `unexpected path: ${result.path}`);
  assert.ok(result.path.startsWith(DEFAULT_ACTIVITY_DIR), `path not under default dir: ${result.path}`);

  const contents = result.contents;

  // Imports only the public `Activity` type (type-only, no relative imports).
  assert.match(contents, /import type \{ Activity \} from "@streetjs\/workflow";/);
  assert.ok(
    !/from "\.\.?\//.test(contents),
    "scaffold must not import from relative/internal paths",
  );

  // Declares the expected typed result interface and the typed Activity const.
  assert.match(contents, /export interface ChargeResult \{/);
  assert.match(
    contents,
    /export const chargeActivity: Activity<ChargeResult> = async \(\s*signal: AbortSignal,\s*\): Promise<ChargeResult>/,
  );
});

// ── (3) Operational commands over an injected engine (Req 24.3–24.6) ────────────

/**
 * Build a `WorkflowCommands` over a freshly created in-memory engine with three
 * registered definitions:
 *   - "greet" completes immediately with a value,
 *   - "waiter" parks `waiting` on a far-future timer (under the fixed clock),
 *   - "boom" throws, so its run terminates `failed`.
 */
function makeCommands(): { commands: WorkflowCommands; engine: WorkflowEngine } {
  const engine = createWorkflow({ clock: CLOCK });

  const greet: WorkflowFunction<unknown, string> = async () => "hello";
  const waiter: WorkflowFunction<unknown, string> = async (ctx) => {
    await ctx.sleep(1_000_000);
    return "eventually";
  };
  const boom: WorkflowFunction<unknown, string> = async () => {
    throw new Error("boom");
  };

  engine.define("greet", greet);
  engine.define("waiter", waiter);
  engine.define("boom", boom);

  return { commands: new WorkflowCommands(engine), engine };
}

test("workflow:run starts a registered run and prints its runId (Req 24.4)", async () => {
  const { commands, engine } = makeCommands();
  try {
    const { logs, exitCode } = await captureRun(() =>
      commands.workflowRun(parsedArgs({ command: "workflow:run", positional: ["greet"] })),
    );

    assert.notEqual(exitCode, 1, "a successful run must not set a failure exit code");
    assert.equal(logs.length, 1, "workflow:run prints exactly the runId");
    const runId = logs[0]!;
    assert.ok(runId.length > 0, "workflow:run printed a non-empty runId");

    // The printed runId is a real, recorded run on the engine.
    assert.notEqual(await engine.status(runId), null, "the printed runId is a recorded run");
  } finally {
    await engine.close();
  }
});

test("workflow:run of an unregistered name reports an error and sets exit code 1 (Req 24.4)", async () => {
  const { commands, engine } = makeCommands();
  try {
    const { errors, exitCode } = await captureRun(() =>
      commands.workflowRun(parsedArgs({ command: "workflow:run", positional: ["does-not-exist"] })),
    );
    assert.equal(exitCode, 1);
    assert.ok(errors.join("\n").length > 0, "an error message is reported for an unknown workflow");
  } finally {
    await engine.close();
  }
});

test("workflow:list prints each run's runId and Run_Status (Req 24.3)", async () => {
  const { commands, engine } = makeCommands();
  try {
    // Start a run through the command so it is recorded on the engine.
    const runLog = await captureRun(() =>
      commands.workflowRun(parsedArgs({ command: "workflow:run", positional: ["greet"] })),
    );
    const runId = runLog.logs[0]!;

    const { logs, exitCode } = await captureRun(() =>
      commands.workflowList(parsedArgs({ command: "workflow:list" })),
    );
    assert.notEqual(exitCode, 1);

    const output = logs.join("\n");
    assert.match(output, new RegExp(runId), "workflow:list output contains the runId");
    assert.match(output, /completed/, "workflow:list output contains the Run_Status");
  } finally {
    await engine.close();
  }
});

test("workflow:list reports when there are no recorded runs (Req 24.3)", async () => {
  const engine = createWorkflow({ clock: CLOCK });
  const commands = new WorkflowCommands(engine);
  try {
    const { logs, exitCode } = await captureRun(() =>
      commands.workflowList(parsedArgs({ command: "workflow:list" })),
    );
    assert.notEqual(exitCode, 1);
    assert.match(logs.join("\n"), /No runs recorded/);
  } finally {
    await engine.close();
  }
});

test("workflow:cancel cancels a waiting run and prints the resulting Run_Status (Req 24.5)", async () => {
  const { commands, engine } = makeCommands();
  try {
    // Start a run that parks `waiting` on a far-future timer under the fixed clock.
    const handle = await engine.run("waiter", {});
    assert.equal(await engine.status(handle.runId), "waiting", "the run parks as waiting");

    const { logs, exitCode } = await captureRun(() =>
      commands.workflowCancel(parsedArgs({ command: "workflow:cancel", positional: [handle.runId] })),
    );
    assert.notEqual(exitCode, 1);
    assert.match(logs.join("\n"), /cancelled/, "workflow:cancel prints the resulting cancelled status");
    assert.equal(await engine.status(handle.runId), "cancelled", "the run is cancelled on the engine");
  } finally {
    await engine.close();
  }
});

test("workflow:cancel of an unknown runId reports an error and sets exit code 1 (Req 24.5)", async () => {
  const { commands, engine } = makeCommands();
  try {
    const { errors, exitCode } = await captureRun(() =>
      commands.workflowCancel(parsedArgs({ command: "workflow:cancel", positional: ["no-such-run"] })),
    );
    assert.equal(exitCode, 1);
    assert.match(errors.join("\n"), /no-such-run/, "the error names the unknown runId");
  } finally {
    await engine.close();
  }
});

test("workflow:retry retries a failed run and prints a new runId (Req 24.6)", async () => {
  const { commands, engine } = makeCommands();
  try {
    // Start a run that terminates `failed`.
    const failed = await engine.run("boom", {});
    await assert.rejects(failed.result(), "the seed run fails");
    assert.equal(await engine.status(failed.runId), "failed", "the seed run is failed");

    const { logs, exitCode } = await captureRun(() =>
      commands.workflowRetry(parsedArgs({ command: "workflow:retry", positional: [failed.runId] })),
    );
    assert.notEqual(exitCode, 1);
    assert.equal(logs.length, 1, "workflow:retry prints exactly the new runId");
    const newRunId = logs[0]!;
    assert.ok(newRunId.length > 0, "workflow:retry printed a non-empty runId");
    assert.notEqual(newRunId, failed.runId, "the retry starts a fresh run with a new runId");
    assert.notEqual(await engine.status(newRunId), null, "the new runId is a recorded run");
  } finally {
    await engine.close();
  }
});

test("workflow:retry refuses a non-failed run and sets exit code 1 (Req 24.6)", async () => {
  const { commands, engine } = makeCommands();
  try {
    // A completed run is not eligible for retry.
    const done = await engine.run("greet", {});
    await done.result();
    assert.equal(await engine.status(done.runId), "completed");

    const { errors, exitCode } = await captureRun(() =>
      commands.workflowRetry(parsedArgs({ command: "workflow:retry", positional: [done.runId] })),
    );
    assert.equal(exitCode, 1);
    assert.match(errors.join("\n"), /failed/, "the refusal message references the required failed status");
  } finally {
    await engine.close();
  }
});
