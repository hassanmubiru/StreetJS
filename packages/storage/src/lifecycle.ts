/**
 * @streetjs/storage — the lifecycle engine.
 *
 * Lifecycle rules act on objects automatically based on their age or state, so
 * stored objects are cleaned up, archived, or tiered over time (Requirement
 * 13). {@link LifecycleEngine} evaluates a single {@link LifecycleRule} and
 * applies its action to every qualifying object in a **provider-agnostic** way:
 *
 * - When the backing {@link StorageDriver} implements the optional native
 *   `lifecycle` capability, the engine delegates evaluation to the driver so a
 *   provider with first-class lifecycle policies (e.g. S3 lifecycle
 *   configuration) is used directly.
 * - Otherwise the engine **simulates** the rule over the mandatory driver
 *   primitives (`list`/`stat`/`get`/`put`/`delete`). It enumerates candidate
 *   keys with `list`, reads each object's `createdAt` with `stat`, computes the
 *   object's age relative to the injected {@link Clock}, and applies the rule's
 *   action to the objects whose age meets the rule's threshold. This is what
 *   lets the zero-dependency drivers simulate lifecycle entirely in memory /
 *   over the local filesystem (Requirement 13.3).
 *
 * Supported rule types (Requirement 13.1):
 * - `delete-after-days` — delete objects older than `days`.
 * - `archive-after-months` — archive objects older than `months` by relocating
 *   them under the reserved {@link ARCHIVE_KEY_PREFIX}.
 * - `expire-temp-uploads` — delete transient multipart-part / resumable-session
 *   state older than `afterMs` (the reserved temp-upload key spaces).
 * - `move-to-cold` — relocate objects older than `afterDays` under `coldPrefix`.
 *
 * **Exactly-once (Requirement 13.2).** Each action removes the qualifying object
 * from the space that a subsequent evaluation scans: `delete`/`expire` remove
 * the object outright, and `archive`/`move-to-cold` relocate it to a prefix that
 * the scan excludes (the reserved archive prefix, or `coldPrefix`). Because the
 * relocated copy is written with a fresh `createdAt` at the evaluation instant,
 * it is also too young to re-qualify at the same `now`. The net effect is that a
 * second evaluation produces no further action on an already-actioned object.
 *
 * The module depends only on the driver contract, the shared type surface, the
 * metadata layer, and the core `Clock`, keeping the dependency direction
 * acyclic. Event publication for applied actions (Requirement 13.4) is wired
 * separately by the Events bridge (task 21.1); this engine only performs the
 * actions and returns their {@link LifecycleOutcome} descriptors.
 *
 * _Requirements: 13.1, 13.2, 13.3_
 */

import { systemClock, type Clock } from "streetjs";

import type { LifecycleCapability, StorageDriver } from "./driver.js";
import { toWriteMetadata } from "./metadata.js";
import type { LifecycleOutcome, LifecycleRule } from "./types.js";

/** Milliseconds in a single day, used to convert day-based thresholds. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The number of days used to approximate one month when converting a
 * month-based threshold to milliseconds. Lifecycle thresholds are coarse
 * age policies rather than calendar arithmetic, so a fixed 30-day month keeps
 * the simulation deterministic and provider-agnostic.
 */
const DAYS_PER_MONTH = 30;

/**
 * Reserved key prefix under which objects archived by an `archive-after-months`
 * rule are relocated. An archived `<key>` lives at `${ARCHIVE_KEY_PREFIX}<key>`.
 * The prefix is excluded from every lifecycle scan so an archived object is
 * never re-actioned (Requirement 13.2).
 */
export const ARCHIVE_KEY_PREFIX = ".archive/";

/**
 * Reserved key prefixes that hold transient upload state (multipart parts and
 * resumable session bytes), mirroring the `.multipart/<uploadId>/…` and
 * `.resumable/<sessionId>` layouts used by the session managers. These are the
 * key spaces an `expire-temp-uploads` rule scans and expires.
 */
const TEMP_UPLOAD_PREFIXES: readonly string[] = [".multipart/", ".resumable/"];

/**
 * Reserved key prefixes that are internal bookkeeping rather than
 * application-visible objects. Age-based rules (`delete-after-days`,
 * `archive-after-months`, `move-to-cold`) never touch keys under these prefixes
 * so lifecycle policies act only on real objects, not on version snapshots,
 * multipart parts, resumable session bytes, or already-archived copies.
 */
const RESERVED_KEY_PREFIXES: readonly string[] = [
  ".versions/",
  ".multipart/",
  ".resumable/",
  ARCHIVE_KEY_PREFIX,
];

/** Options for constructing a {@link LifecycleEngine}. */
export interface LifecycleEngineOptions {
  /** The driver every action is delegated to or simulated over. */
  readonly driver: StorageDriver;
  /**
   * Injected clock used to compute object age at evaluation time. Default
   * `systemClock`, so time is deterministic in tests (Requirement 13.3).
   */
  readonly clock?: Clock;
}

/**
 * Provider-agnostic lifecycle engine built on the driver contract.
 *
 * A single instance is held by the facade and bound to one {@link StorageDriver}
 * for its lifetime, so the native-vs-simulated decision (based on whether the
 * driver exposes a `lifecycle` capability) is stable across every call.
 */
export class LifecycleEngine {
  /** The driver every action is delegated to or simulated over. */
  private readonly driver: StorageDriver;

  /** Injected clock used to compute object age at evaluation time. */
  private readonly clock: Clock;

  constructor(options: LifecycleEngineOptions) {
    this.driver = options.driver;
    this.clock = options.clock ?? systemClock;
  }

  /** The driver's native lifecycle capability, when present. */
  private get native(): LifecycleCapability | undefined {
    return this.driver.lifecycle;
  }

  /**
   * Evaluate `rule` against the current object set and apply its action to every
   * qualifying object, returning one {@link LifecycleOutcome} per actioned
   * object (Requirements 13.1, 13.2). Object age is measured relative to `now`,
   * which defaults to the injected clock. When the driver exposes a native
   * `lifecycle` capability the evaluation is delegated to it; otherwise the rule
   * is simulated over the driver primitives.
   */
  async apply(rule: LifecycleRule, now: number = this.clock()): Promise<LifecycleOutcome[]> {
    if (this.native !== undefined) {
      return this.native.apply(rule, now);
    }

    switch (rule.type) {
      case "delete-after-days":
        return this.applyDelete(rule.prefix ?? "", rule.days * MS_PER_DAY, now);
      case "archive-after-months":
        return this.applyArchive(rule.prefix ?? "", rule.months * DAYS_PER_MONTH * MS_PER_DAY, now);
      case "expire-temp-uploads":
        return this.applyExpire(rule.afterMs, now);
      case "move-to-cold":
        return this.applyMoveToCold(
          rule.prefix ?? "",
          rule.coldPrefix,
          rule.afterDays * MS_PER_DAY,
          now,
        );
    }
  }

  /**
   * Delete every managed object under `prefix` whose age is at least
   * `thresholdMs`. The deletion removes the object from the scanned space, so a
   * repeated evaluation finds nothing further to delete (Requirement 13.2).
   */
  private async applyDelete(
    prefix: string,
    thresholdMs: number,
    now: number,
  ): Promise<LifecycleOutcome[]> {
    const keys = await this.collectQualifying(prefix, thresholdMs, now, (key) =>
      this.isManagedKey(key),
    );
    const outcomes: LifecycleOutcome[] = [];
    for (const key of keys) {
      await this.driver.delete(key);
      outcomes.push({ key, action: "deleted" });
    }
    return outcomes;
  }

  /**
   * Archive every managed object under `prefix` whose age is at least
   * `thresholdMs` by relocating it under {@link ARCHIVE_KEY_PREFIX}. The archive
   * prefix is excluded from the scan, so an archived object is never re-archived
   * (Requirement 13.2).
   */
  private async applyArchive(
    prefix: string,
    thresholdMs: number,
    now: number,
  ): Promise<LifecycleOutcome[]> {
    const keys = await this.collectQualifying(prefix, thresholdMs, now, (key) =>
      this.isManagedKey(key),
    );
    const outcomes: LifecycleOutcome[] = [];
    for (const key of keys) {
      const moved = await this.relocate(key, `${ARCHIVE_KEY_PREFIX}${key}`);
      if (moved) {
        outcomes.push({ key, action: "archived" });
      }
    }
    return outcomes;
  }

  /**
   * Expire (delete) transient upload state older than `afterMs` across the
   * reserved temp-upload key spaces (multipart parts and resumable session
   * bytes). Because expiration deletes the state, a repeated evaluation finds
   * nothing further to expire (Requirement 13.2).
   */
  private async applyExpire(afterMs: number, now: number): Promise<LifecycleOutcome[]> {
    const outcomes: LifecycleOutcome[] = [];
    for (const prefix of TEMP_UPLOAD_PREFIXES) {
      // Every key under a temp-upload prefix is transient state, so no further
      // managed-key filtering is applied here.
      const keys = await this.collectQualifying(prefix, afterMs, now, () => true);
      for (const key of keys) {
        await this.driver.delete(key);
        outcomes.push({ key, action: "expired" });
      }
    }
    return outcomes;
  }

  /**
   * Relocate every managed object under `prefix` whose age is at least
   * `thresholdMs` to `${coldPrefix}<key>`. Keys already residing under
   * `coldPrefix` are excluded from the scan, so a repeated evaluation does not
   * move an already-tiered object again (Requirement 13.2).
   */
  private async applyMoveToCold(
    prefix: string,
    coldPrefix: string,
    thresholdMs: number,
    now: number,
  ): Promise<LifecycleOutcome[]> {
    const keys = await this.collectQualifying(
      prefix,
      thresholdMs,
      now,
      (key) => this.isManagedKey(key) && !key.startsWith(coldPrefix),
    );
    const outcomes: LifecycleOutcome[] = [];
    for (const key of keys) {
      const moved = await this.relocate(key, `${coldPrefix}${key}`);
      if (moved) {
        outcomes.push({ key, action: "moved" });
      }
    }
    return outcomes;
  }

  /**
   * List candidate keys under `prefix`, keep those accepted by `accept`, and
   * return the subset whose age (`now - createdAt`, read via `stat`) is at least
   * `thresholdMs`. Keys that vanish between `list` and `stat` are skipped.
   */
  private async collectQualifying(
    prefix: string,
    thresholdMs: number,
    now: number,
    accept: (key: string) => boolean,
  ): Promise<string[]> {
    const items = await this.driver.list(prefix);
    const qualifying: string[] = [];
    for (const item of items) {
      if (!accept(item.key)) {
        continue;
      }
      const metadata = await this.driver.stat(item.key);
      if (metadata === null) {
        continue;
      }
      if (now - metadata.createdAt >= thresholdMs) {
        qualifying.push(item.key);
      }
    }
    return qualifying;
  }

  /**
   * Move the object at `sourceKey` to `destinationKey` over the driver
   * primitives: the content and preserved write-time metadata are written to the
   * destination and the source is then removed. Returns `false` without writing
   * when the source has vanished.
   */
  private async relocate(sourceKey: string, destinationKey: string): Promise<boolean> {
    const result = await this.driver.get(sourceKey);
    if (!result.found) {
      return false;
    }
    await this.driver.put(destinationKey, result.bytes, toWriteMetadata(result.metadata));
    await this.driver.delete(sourceKey);
    return true;
  }

  /**
   * Report whether `key` is an application-visible object (as opposed to
   * internal bookkeeping such as version snapshots, multipart parts, resumable
   * session bytes, or already-archived copies). Age-based rules act only on
   * managed keys.
   */
  private isManagedKey(key: string): boolean {
    return !RESERVED_KEY_PREFIXES.some((reserved) => key.startsWith(reserved));
  }
}
