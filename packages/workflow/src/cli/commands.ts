// src/cli/commands.ts
// @streetjs/workflow — CLI commands registered through the reused core CliKernel.
//
// Provides `make:workflow`, `make:activity`, `workflow:list`, `workflow:run`,
// `workflow:cancel`, and `workflow:retry` as `@Command`-decorated methods
// (Requirement 24.1).
//
// `make:workflow`/`make:activity` delegate to the PURE functions in
// `generators.ts`: the name is validated and the scaffold rendered before this
// command layer performs the single guarded filesystem write, refusing to
// overwrite an existing target (Requirements 24.2, 31.4). The operational
// commands act through a `WorkflowEngine`: `workflow:list` prints each run's
// runId + Run_Status (24.3), `workflow:run <name>` starts a run and prints its
// runId (24.4), `workflow:cancel <runId>` cancels a run and prints the resulting
// status (24.5), and `workflow:retry <runId>` retries a failed run (24.6).
//
// The engine defaults to the zero-dependency in-memory `createWorkflow()`, but a
// pre-built engine may be injected through the constructor (used by the CLI
// tests to register definitions and observe runs). No class-level decorator is
// used, so the core `CliKernel` can `container.resolve` the class with no
// constructor dependency metadata — mirroring the `@streetjs/storage`
// cli/commands.ts pattern.
//
// _Requirements: 24.1, 24.3, 24.4, 24.5, 24.6_

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Command } from "streetjs";
import type { ParsedArgs } from "streetjs";

import { createWorkflow } from "../engine.js";
import type { WorkflowEngine } from "../engine.js";
import type { GenerateResult } from "./generators.js";
import {
  DEFAULT_ACTIVITY_DIR,
  DEFAULT_WORKFLOW_DIR,
  generateActivity,
  generateWorkflow,
  isValidGeneratorName,
} from "./generators.js";

/**
 * The set of `@Command`-decorated workflow commands, registered through the core
 * `CliKernel`. A plain class (no class-level decorator) so the kernel can
 * `container.resolve` it without constructor dependency metadata; the optional
 * `engine` argument is only used when the class is constructed directly (e.g. by
 * the CLI tests), and defaults to the in-memory `createWorkflow()` engine.
 */
export class WorkflowCommands {
  /** The lazily-resolved engine backing the operational commands. */
  private engineInstance: WorkflowEngine | undefined;

  constructor(engine?: WorkflowEngine) {
    this.engineInstance = engine;
  }

  // ── make:workflow ──────────────────────────────────────────────────────────

  /**
   * `street make:workflow <Name> [--dir <dir>]` — scaffold a typed workflow
   * module. Delegates to the pure {@link generateWorkflow}: the name is validated
   * and the source rendered before this layer writes it, and an existing target
   * is never overwritten (Requirements 24.2, 31.4).
   */
  @Command(
    "make:workflow",
    "Scaffold a new workflow module (make:workflow <Name> [--dir <dir>])",
  )
  makeWorkflow(args: ParsedArgs): void {
    this.scaffold(args, "workflow", generateWorkflow, DEFAULT_WORKFLOW_DIR);
  }

  // ── make:activity ──────────────────────────────────────────────────────────

  /**
   * `street make:activity <Name> [--dir <dir>]` — scaffold a typed activity
   * module. Delegates to the pure {@link generateActivity} with the same
   * validate-before-write, no-overwrite guarantees (Requirements 24.2, 31.4).
   */
  @Command(
    "make:activity",
    "Scaffold a new activity module (make:activity <Name> [--dir <dir>])",
  )
  makeActivity(args: ParsedArgs): void {
    this.scaffold(args, "activity", generateActivity, DEFAULT_ACTIVITY_DIR);
  }

  // ── workflow:list ──────────────────────────────────────────────────────────

  /**
   * `street workflow:list` — print the runId and Run_Status of every recorded
   * run for the configured engine (Requirement 24.3).
   */
  @Command("workflow:list", "List every recorded run's runId and Run_Status")
  async workflowList(_args: ParsedArgs): Promise<void> {
    const runs = await this.engine().list();
    if (runs.length === 0) {
      console.log("[workflow] No runs recorded.");
      return;
    }
    for (const run of runs) {
      console.log(`${run.runId}\t${run.status}`);
    }
    console.log(`[workflow] ${runs.length} run(s).`);
  }

  // ── workflow:run ───────────────────────────────────────────────────────────

  /**
   * `street workflow:run <name> [--input <json|path>]` — start a run of a
   * registered definition and print its runId (Requirement 24.4). `--input` is
   * parsed as inline JSON, falling back to reading the value as a JSON file path;
   * when omitted the run starts with an empty input object.
   */
  @Command(
    "workflow:run",
    "Start a run of a registered workflow (workflow:run <name> [--input <json|path>])",
  )
  async workflowRun(args: ParsedArgs): Promise<void> {
    const name = this.resolveName(args);
    if (name === "") {
      console.error("[workflow] workflow:run requires a workflow name.");
      process.exitCode = 1;
      return;
    }

    let input: unknown;
    try {
      input = this.resolveInput(args);
    } catch (err) {
      console.error(`[workflow] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    try {
      const handle = await this.engine().run(name, input);
      console.log(handle.runId);
    } catch (err) {
      console.error(`[workflow] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  // ── workflow:cancel ────────────────────────────────────────────────────────

  /**
   * `street workflow:cancel <runId>` — cancel a run and print the resulting
   * Run_Status (Requirement 24.5). An unknown runId is reported as an error.
   */
  @Command(
    "workflow:cancel",
    "Cancel a run and print the resulting Run_Status (workflow:cancel <runId>)",
  )
  async workflowCancel(args: ParsedArgs): Promise<void> {
    const runId = this.resolveRunId(args);
    if (runId === "") {
      console.error("[workflow] workflow:cancel requires a runId.");
      process.exitCode = 1;
      return;
    }

    try {
      await this.engine().cancel(runId);
      const status = await this.engine().status(runId);
      if (status === null) {
        console.error(`[workflow] No run "${runId}" was found.`);
        process.exitCode = 1;
        return;
      }
      console.log(status);
    } catch (err) {
      console.error(`[workflow] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  // ── workflow:retry ─────────────────────────────────────────────────────────

  /**
   * `street workflow:retry <runId>` — retry a failed run by starting a fresh run
   * of the same definition, printing the new runId (Requirement 24.6). Only a
   * run currently in the `failed` Run_Status is retried; any other status is
   * reported without starting a new run.
   */
  @Command(
    "workflow:retry",
    "Retry a failed run (workflow:retry <runId>)",
  )
  async workflowRetry(args: ParsedArgs): Promise<void> {
    const runId = this.resolveRunId(args);
    if (runId === "") {
      console.error("[workflow] workflow:retry requires a runId.");
      process.exitCode = 1;
      return;
    }

    try {
      const status = await this.engine().status(runId);
      if (status === null) {
        console.error(`[workflow] No run "${runId}" was found.`);
        process.exitCode = 1;
        return;
      }
      if (status !== "failed") {
        console.error(
          `[workflow] Refusing to retry run "${runId}": expected a "failed" run ` +
            `but its status is "${status}".`,
        );
        process.exitCode = 1;
        return;
      }
      const handle = await this.engine().restart(runId);
      console.log(handle.runId);
    } catch (err) {
      console.error(`[workflow] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  // ── Shared helpers ───────────────────────────────────────────────────────────

  /**
   * Resolve the engine backing the operational commands, lazily creating the
   * zero-dependency in-memory {@link createWorkflow} engine when none was
   * injected through the constructor (Requirement 1.2).
   */
  private engine(): WorkflowEngine {
    if (this.engineInstance === undefined) {
      this.engineInstance = createWorkflow();
    }
    return this.engineInstance;
  }

  /**
   * Shared `make:*` body: validate the name, render the scaffold through the pure
   * generator, then perform the single guarded write. Any invalid name or
   * existing target is reported and sets a non-zero exit code without writing.
   */
  private scaffold(
    args: ParsedArgs,
    kind: "workflow" | "activity",
    generate: (name: string, dir: string) => GenerateResult,
    defaultDir: string,
  ): void {
    const name = this.resolveName(args);
    if (!isValidGeneratorName(name)) {
      console.error(
        `[workflow] Invalid ${kind} name: "${name}". ` +
          `Use a PascalCase identifier (a letter followed by letters or digits).`,
      );
      process.exitCode = 1;
      return;
    }

    const dir = typeof args.flags["dir"] === "string" ? args.flags["dir"] : defaultDir;

    let result: GenerateResult;
    try {
      result = generate(name, dir);
      this.writeScaffold(result);
    } catch (err) {
      console.error(`[workflow] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[workflow] Generated ${kind} module: ${result.path}`);
  }

  /**
   * Write a generated scaffold to disk, refusing to overwrite an existing target
   * and creating a fresh file otherwise. The parent directory is created as
   * needed; the `wx` flag makes the no-overwrite check atomic. This is the
   * command layer's guarded filesystem write over the pure generators.
   *
   * @throws Error when the target file already exists.
   */
  private writeScaffold(result: GenerateResult): void {
    if (existsSync(result.path)) {
      throw new Error(`Refusing to overwrite existing file: ${result.path}`);
    }
    mkdirSync(dirname(result.path), { recursive: true });
    writeFileSync(result.path, result.contents, { encoding: "utf8", flag: "wx" });
  }

  /** Read the workflow/generator name from the first positional arg or `--name`. */
  private resolveName(args: ParsedArgs): string {
    const positional = args.positional[0];
    if (typeof positional === "string") {
      return positional;
    }
    return typeof args.flags["name"] === "string" ? args.flags["name"] : "";
  }

  /** Read a runId from the first positional arg or `--run` (default ""). */
  private resolveRunId(args: ParsedArgs): string {
    const positional = args.positional[0];
    if (typeof positional === "string") {
      return positional;
    }
    return typeof args.flags["run"] === "string" ? args.flags["run"] : "";
  }

  /**
   * Resolve the run input from `--input`: parse it as inline JSON, and on a parse
   * failure read the value as a path to a JSON file and parse its contents. When
   * `--input` is absent (or a bare boolean flag) an empty object is used.
   */
  private resolveInput(args: ParsedArgs): unknown {
    const flag = args.flags["input"];
    if (typeof flag !== "string" || flag === "") {
      return {};
    }
    try {
      return JSON.parse(flag);
    } catch {
      // Not inline JSON — treat the value as a path to a JSON file.
    }
    let raw: string;
    try {
      raw = readFileSync(flag, { encoding: "utf8" });
    } catch (err) {
      throw new Error(
        `Could not read --input "${flag}" as inline JSON or as a file: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `The --input file "${flag}" does not contain valid JSON: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
