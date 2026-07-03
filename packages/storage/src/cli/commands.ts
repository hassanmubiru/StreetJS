// src/cli/commands.ts
// @streetjs/storage — CLI commands registered through the reused core CliKernel.
//
// Provides `make:storage`, `storage:list`, `storage:sync`, `storage:clean`,
// `storage:migrate`, and `storage:verify` as `@Command`-decorated methods.
//
// `make:storage` delegates to the pure functions in `generators.ts`: it
// validates the name before writing anything, refuses to overwrite an existing
// target, and otherwise emits a typed scaffold that compiles under `tsc`
// (Requirement 21.2). The operational commands build a configured
// `Storage`/`StorageDriver` from CLI flags and act through the public facade
// surface. `storage:verify` runs the shared contract-conformance suite against
// the configured driver and reports pass/fail per check (Requirement 21.4).
//
// No class-level decorator is used, so no constructor dependency metadata is
// emitted and the core `CliKernel` can `container.resolve` the class with no
// registered dependencies. This mirrors the `@streetjs/events` cli/commands.ts
// pattern.
//
// _Requirements: 21.1, 21.2, 21.3, 21.4_

import { Command } from "streetjs";
import type { ParsedArgs } from "streetjs";

import { createStorage } from "../facade.js";
import type { Storage } from "../facade.js";
import { MemoryStorageDriver } from "../drivers/memory.js";
import { LocalStorageDriver } from "../drivers/local.js";
import { StorageConfigError } from "../errors.js";
import type { StorageConfig } from "../types.js";
import { runStorageDriverContract } from "../tests/contract.js";
import type { StorageDriverFactory } from "../tests/contract.js";
import {
  generateStorage,
  isValidGeneratorName,
  isValidProvider,
  writeScaffold,
  DEFAULT_STORAGE_DIR,
  type BuiltInProvider,
  type GenerateResult,
} from "./generators.js";

/**
 * The set of `@Command`-decorated storage commands, registered through the core
 * `CliKernel`. A plain class (no class-level decorator) so the kernel can
 * `container.resolve` it without constructor dependency metadata.
 */
export class StorageCommands {
  // ── make:storage ─────────────────────────────────────────────────────────

  /**
   * `street make:storage <Name> [--dir <dir>] [--provider memory|local]` —
   * scaffold a typed storage module. Delegates to the pure generators: the name
   * (and scaffold provider) are validated before any file is written, and an
   * existing target is never overwritten (Requirement 21.2).
   */
  @Command(
    "make:storage",
    "Scaffold a new storage module (make:storage <Name> [--dir <dir>] [--provider memory|local])",
  )
  makeStorage(args: ParsedArgs): void {
    const name = this.resolveName(args);
    if (!isValidGeneratorName(name)) {
      console.error(
        `[storage] Invalid storage name: "${name}". ` +
          `Use a PascalCase identifier (a letter followed by letters or digits).`,
      );
      process.exitCode = 1;
      return;
    }

    const providerFlag =
      typeof args.flags["provider"] === "string" ? args.flags["provider"] : undefined;
    let provider: BuiltInProvider | undefined;
    if (providerFlag !== undefined) {
      if (!isValidProvider(providerFlag)) {
        console.error(
          `[storage] Invalid scaffold provider: "${providerFlag}". ` +
            `Use a built-in zero-dependency provider ("memory" or "local").`,
        );
        process.exitCode = 1;
        return;
      }
      provider = providerFlag;
    }

    const dir = typeof args.flags["dir"] === "string" ? args.flags["dir"] : DEFAULT_STORAGE_DIR;

    let result: GenerateResult;
    try {
      result = generateStorage(name, dir, provider);
      writeScaffold(result);
    } catch (err) {
      console.error(`[storage] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[storage] Generated storage module: ${result.path}`);
  }

  // ── storage:list ───────────────────────────────────────────────────────────

  /**
   * `street storage:list [<prefix>] [--provider memory|local] [--root <dir>]` —
   * list the stored object keys for the configured driver. Builds a `Storage`
   * from the CLI flags and prints every key under the prefix (Requirement 21.3).
   */
  @Command(
    "storage:list",
    "List stored object keys for the configured driver (storage:list [<prefix>] [--provider <p>] [--root <dir>])",
  )
  async storageList(args: ParsedArgs): Promise<void> {
    const prefix = this.resolvePrefix(args);
    const storage = this.buildStorage(this.configFromArgs(args));
    try {
      const items = await storage.list(prefix);
      if (items.length === 0) {
        console.log(`[storage] No objects found under "${prefix}".`);
      } else {
        for (const item of items) {
          console.log(item.key);
        }
        console.log(`[storage] ${items.length} object(s).`);
      }
    } catch (err) {
      console.error(`[storage] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      await this.closeQuietly(storage);
    }
  }

  // ── storage:clean ────────────────────────────────────────────────────────────

  /**
   * `street storage:clean <prefix> [--provider memory|local] [--root <dir>]` —
   * remove every object under a prefix from the configured driver. A prefix is
   * required so the command never silently wipes an entire store; deletion of
   * each object is isolated so one failure does not abort the rest
   * (Requirement 21.3).
   */
  @Command(
    "storage:clean",
    "Remove all objects under a prefix (storage:clean <prefix> [--provider <p>] [--root <dir>])",
  )
  async storageClean(args: ParsedArgs): Promise<void> {
    const prefix = this.resolvePrefix(args);
    if (prefix === "") {
      console.error(
        `[storage] storage:clean requires a non-empty prefix (refusing to remove every object). ` +
          `Pass a prefix positionally or via --prefix.`,
      );
      process.exitCode = 1;
      return;
    }

    const storage = this.buildStorage(this.configFromArgs(args));
    let removed = 0;
    try {
      const items = await storage.list(prefix);
      for (const item of items) {
        try {
          await storage.delete(item.key);
          removed += 1;
        } catch (err) {
          console.error(
            `[storage] Failed to remove "${item.key}": ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(`[storage] Removed ${removed} object(s) under "${prefix}".`);
    } catch (err) {
      console.error(`[storage] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      await this.closeQuietly(storage);
    }
  }

  // ── storage:sync ─────────────────────────────────────────────────────────────

  /**
   * `street storage:sync [<prefix>] --from-provider <p> [--from-root <dir>]
   * --to-provider <p> [--to-root <dir>]` — copy every object under a prefix from
   * a source store to a destination store, leaving the source untouched
   * (Requirement 21.3). Each object copy is isolated so a single failure does
   * not abort the whole sync.
   */
  @Command(
    "storage:sync",
    "Copy objects between two configured stores (storage:sync [<prefix>] --from-provider <p> --to-provider <p>)",
  )
  async storageSync(args: ParsedArgs): Promise<void> {
    await this.transfer(args, { verb: "Synced" });
  }

  // ── storage:migrate ──────────────────────────────────────────────────────────

  /**
   * `street storage:migrate [<prefix>] --from-provider <p> [--from-root <dir>]
   * --to-provider <p> [--to-root <dir>]` — move every object under a prefix from
   * a source store to a destination store (copy, then remove from the source),
   * so the destination becomes the new home for the data (Requirement 21.3).
   * Each object migration is isolated so a single failure does not abort the
   * whole migration.
   */
  @Command(
    "storage:migrate",
    "Migrate objects from one store to another (storage:migrate [<prefix>] --from-provider <p> --to-provider <p>)",
  )
  async storageMigrate(args: ParsedArgs): Promise<void> {
    await this.transfer(args, { removeSource: true, verb: "Migrated" });
  }

  // ── storage:verify ───────────────────────────────────────────────────────────

  /**
   * `street storage:verify [--provider memory|local] [--root <dir>]` — run the
   * shared driver contract-conformance suite against the configured driver and
   * report pass/fail per check, exiting non-zero when any check fails
   * (Requirement 21.4).
   */
  @Command(
    "storage:verify",
    "Run the contract-conformance suite against the configured driver (storage:verify [--provider <p>] [--root <dir>])",
  )
  async storageVerify(args: ParsedArgs): Promise<void> {
    const config = this.configFromArgs(args);
    let factory: StorageDriverFactory;
    try {
      factory = this.driverFactory(config);
    } catch (err) {
      console.error(`[storage] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    const report = await runStorageDriverContract(factory);
    console.log(`[storage] Contract conformance for driver "${report.driver}":`);
    for (const result of report.results) {
      const status = result.passed ? "PASS" : "FAIL";
      console.log(`  [${status}] (${result.requirement}) ${result.name}`);
      if (!result.passed && result.error !== undefined) {
        console.log(`         ${result.error}`);
      }
    }
    const passedCount = report.results.filter((r) => r.passed).length;
    console.log(
      `[storage] ${passedCount}/${report.results.length} check(s) passed — ` +
        `${report.passed ? "PASS" : "FAIL"}.`,
    );
    if (!report.passed) {
      process.exitCode = 1;
    }
  }

  // ── Shared helpers ───────────────────────────────────────────────────────────

  /**
   * Copy (and optionally remove-from-source) every object under a prefix from a
   * source store to a destination store. Shared by `storage:sync` (copy) and
   * `storage:migrate` (move). Every per-object transfer is isolated so one
   * failure does not abort the rest.
   */
  private async transfer(
    args: ParsedArgs,
    options: { removeSource?: boolean; verb: string },
  ): Promise<void> {
    const prefix = this.resolvePrefix(args);
    const source = this.buildStorage(this.transferConfig(args, "from"));
    const destination = this.buildStorage(this.transferConfig(args, "to"));
    let transferred = 0;
    try {
      const items = await source.list(prefix);
      for (const item of items) {
        try {
          const got = await source.get(item.key);
          if (!got.found || got.bytes === undefined) {
            continue;
          }
          const metadata = got.metadata;
          await destination.put(item.key, got.bytes, {
            contentType: metadata?.contentType,
            owner: metadata?.owner,
            tenant: metadata?.tenant,
            accessLevel: metadata?.accessLevel,
            custom: metadata?.custom as Record<string, unknown> | undefined,
          });
          if (options.removeSource === true) {
            await source.delete(item.key);
          }
          transferred += 1;
        } catch (err) {
          console.error(
            `[storage] Failed to transfer "${item.key}": ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(`[storage] ${options.verb} ${transferred} object(s) under "${prefix}".`);
    } catch (err) {
      console.error(`[storage] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      await this.closeQuietly(source);
      await this.closeQuietly(destination);
    }
  }

  /** Build a live {@link Storage} facade from a resolved {@link StorageConfig}. */
  private buildStorage(config: StorageConfig): Storage {
    return createStorage(config);
  }

  /**
   * Resolve a {@link StorageConfig} from the CLI flags: `--provider` (defaults to
   * `memory`) and `--root` (used by the `local` provider).
   */
  private configFromArgs(args: ParsedArgs): StorageConfig {
    const provider =
      typeof args.flags["provider"] === "string" ? args.flags["provider"] : "memory";
    const root = typeof args.flags["root"] === "string" ? args.flags["root"] : undefined;
    return { provider, root };
  }

  /**
   * Resolve a source (`from`) or destination (`to`) {@link StorageConfig} from a
   * prefixed pair of flags, e.g. `--from-provider`/`--from-root` and
   * `--to-provider`/`--to-root`. Defaults to the `memory` provider.
   */
  private transferConfig(args: ParsedArgs, side: "from" | "to"): StorageConfig {
    const providerFlag = args.flags[`${side}-provider`];
    const rootFlag = args.flags[`${side}-root`];
    const provider = typeof providerFlag === "string" ? providerFlag : "memory";
    const root = typeof rootFlag === "string" ? rootFlag : undefined;
    return { provider, root };
  }

  /**
   * Build a {@link StorageDriverFactory} for the configured driver, used by
   * `storage:verify` to obtain a freshly constructed driver per contract check.
   * A pre-constructed `config.driver` is returned as-is; the built-in `memory`
   * and `local` providers are constructed fresh each call. An unknown provider
   * with no supplied driver throws a descriptive {@link StorageConfigError}.
   */
  private driverFactory(config: StorageConfig): StorageDriverFactory {
    if (config.driver !== undefined) {
      const driver = config.driver;
      return () => driver;
    }
    if (config.provider === "memory") {
      return () => new MemoryStorageDriver({ clock: config.clock });
    }
    if (config.provider === "local") {
      if (config.root === undefined || config.root === "") {
        throw new StorageConfigError(
          'The "local" storage provider requires a "root" directory (pass --root <dir>).',
          { provider: "local" },
        );
      }
      const root = config.root;
      return () => new LocalStorageDriver({ root, clock: config.clock });
    }
    throw new StorageConfigError(
      `Unknown storage provider "${config.provider}". Provide a built-in provider ` +
        `("memory" or "local"), or supply a pre-constructed "driver" for cloud providers.`,
      { provider: config.provider },
    );
  }

  /** Read the generator name from the first positional arg or `--name`. */
  private resolveName(args: ParsedArgs): string {
    const positional = args.positional[0];
    if (typeof positional === "string") {
      return positional;
    }
    return typeof args.flags["name"] === "string" ? args.flags["name"] : "";
  }

  /** Read the key prefix from the first positional arg or `--prefix` (default ""). */
  private resolvePrefix(args: ParsedArgs): string {
    const positional = args.positional[0];
    if (typeof positional === "string") {
      return positional;
    }
    return typeof args.flags["prefix"] === "string" ? args.flags["prefix"] : "";
  }

  /** Close a storage facade, swallowing any error so cleanup never masks results. */
  private async closeQuietly(storage: Storage): Promise<void> {
    try {
      await storage.close();
    } catch {
      // Ignore close failures during CLI cleanup.
    }
  }
}
