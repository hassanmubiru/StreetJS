// src/security/moderation.ts
// Phase 7 — Moderation_Toolkit (Requirement 8).
//
// Report/block/mute APIs over a pluggable store, an exposed moderation queue,
// and an append-only audit log. The audit log composes the append-only pattern
// used by `auth/audit-writer.ts`: every report/block/mute/resolve action appends
// an immutable Audit_Event, and the public API exposes only append + list — there
// is no mutation path through which a recorded event can be altered (R8.5/R8.7).
//
// Responsibilities (mapped to acceptance criteria):
//   - Submitting a report stores it and places it in the moderation queue (R8.1).
//   - Blocking records the block relationship (R8.2).
//   - While A has blocked B, B cannot message A (R8.3).
//   - Muting suppresses a muted user's content for the muting user only, while
//     preserving it for other recipients (R8.4).
//   - Every report/block/mute/resolve appends an Audit_Event recording the
//     actor, target, action, and timestamp (R8.5).
//   - The moderation queue can be listed and each report resolved (R8.6).
//   - Audit_Events are not modifiable through the public moderation API (R8.7).
//
// All time inputs flow through an injected clock so timestamps are deterministic
// under test, mirroring the sibling `abuse.ts` / `store.ts` modules.

import { randomUUID } from 'node:crypto';

import type { Clock } from './store.js';
import { systemClock } from './store.js';

/** The set of actions recorded in the audit log (R8.5). */
export type ModerationAction = 'report' | 'block' | 'mute' | 'resolve';

/** Outcome recorded when a moderator resolves a report (R8.6). */
export interface ReportResolution {
  /** Identifier of the moderator who resolved the report. */
  moderator: string;
  /** Free-form outcome describing the resolution decision. */
  outcome: string;
  /** Timestamp (ms) at which the report was resolved. */
  resolvedAt: number;
}

/** A user-submitted report against another user (R8.1). */
export interface Report {
  /** Unique report identifier. */
  id: string;
  /** Identifier of the reporting user. */
  reporter: string;
  /** Identifier of the reported user. */
  target: string;
  /** Free-form reason for the report. */
  reason: string;
  /** Timestamp (ms) at which the report was created. */
  createdAt: number;
  /** Present once a moderator has recorded a resolution (R8.6). */
  resolution?: ReportResolution;
}

/**
 * An immutable, timestamped record describing a moderation action (R8.5).
 *
 * Every field is `readonly`; instances are deep-frozen on creation and the
 * public API never exposes a mutation path, so recorded events cannot be
 * modified through it (R8.7).
 */
export interface AuditEvent {
  readonly id: string;
  readonly actor: string;
  readonly target: string;
  readonly action: ModerationAction;
  readonly ts: number;
}

/**
 * Pluggable persistence surface for the {@link ModerationToolkit}.
 *
 * The audit surface is intentionally append-only: it exposes `appendAudit` and
 * `listAudit` and nothing that updates or deletes a recorded event (R8.7).
 */
export interface ModerationStore {
  /** Append an audit event. Implementations MUST NOT expose update/delete (R8.7). */
  appendAudit(e: AuditEvent): Promise<void>;
  /** List all recorded audit events in append order. */
  listAudit(): Promise<readonly AuditEvent[]>;

  /** Persist (or update) a report. */
  saveReport(r: Report): Promise<void>;
  /** Retrieve a report by id, or `undefined` if absent. */
  getReport(id: string): Promise<Report | undefined>;
  /** List pending reports (those without a recorded resolution) (R8.6). */
  listQueue(): Promise<Report[]>;

  /** Record that `blocker` has blocked `blocked` (R8.2). */
  setBlock(blocker: string, blocked: string): Promise<void>;
  /** Whether `blocker` has blocked `blocked`. */
  isBlocked(blocker: string, blocked: string): Promise<boolean>;

  /** Record that `muter` has muted `muted` (R8.4). */
  setMute(muter: string, muted: string): Promise<void>;
  /** Whether `muter` has muted `muted`. */
  isMuted(muter: string, muted: string): Promise<boolean>;
}

/** Deep-freeze an audit event so neither callers nor the store can mutate it. */
function freezeEvent(e: AuditEvent): Readonly<AuditEvent> {
  return Object.freeze({ ...e });
}

/**
 * Default in-memory {@link ModerationStore}.
 *
 * Audit events are stored frozen and `listAudit` returns a fresh array of those
 * frozen events, so neither mutating the returned array nor its elements affects
 * stored state — the only way to add an event is `appendAudit` (R8.7).
 */
export class InMemoryModerationStore implements ModerationStore {
  private readonly audit: Readonly<AuditEvent>[] = [];
  private readonly reports = new Map<string, Report>();
  // Set of `${blocker}\u0000${blocked}` keys.
  private readonly blocks = new Set<string>();
  // Set of `${muter}\u0000${muted}` keys.
  private readonly mutes = new Set<string>();

  private static pairKey(a: string, b: string): string {
    return `${a}\u0000${b}`;
  }

  async appendAudit(e: AuditEvent): Promise<void> {
    this.audit.push(freezeEvent(e));
  }

  async listAudit(): Promise<readonly AuditEvent[]> {
    // Return a copy of the (frozen) events so the internal log is not exposed.
    return this.audit.slice();
  }

  async saveReport(r: Report): Promise<void> {
    this.reports.set(r.id, { ...r });
  }

  async getReport(id: string): Promise<Report | undefined> {
    const r = this.reports.get(id);
    return r ? { ...r } : undefined;
  }

  async listQueue(): Promise<Report[]> {
    const pending: Report[] = [];
    for (const r of this.reports.values()) {
      if (!r.resolution) pending.push({ ...r });
    }
    return pending;
  }

  async setBlock(blocker: string, blocked: string): Promise<void> {
    this.blocks.add(InMemoryModerationStore.pairKey(blocker, blocked));
  }

  async isBlocked(blocker: string, blocked: string): Promise<boolean> {
    return this.blocks.has(InMemoryModerationStore.pairKey(blocker, blocked));
  }

  async setMute(muter: string, muted: string): Promise<void> {
    this.mutes.add(InMemoryModerationStore.pairKey(muter, muted));
  }

  async isMuted(muter: string, muted: string): Promise<boolean> {
    return this.mutes.has(InMemoryModerationStore.pairKey(muter, muted));
  }
}

/** Error thrown when an operation references a report id that does not exist. */
export class UnknownReportError extends Error {
  readonly reportId: string;
  constructor(reportId: string) {
    super(`Unknown report: ${reportId}`);
    this.name = 'UnknownReportError';
    this.reportId = reportId;
  }
}

/** Options for {@link ModerationToolkit}. */
export interface ModerationToolkitOptions {
  /** Injected now-provider; defaults to {@link systemClock}. */
  clock?: Clock;
}

/**
 * The Moderation_Toolkit (R8).
 *
 * A thin, auditable layer over a {@link ModerationStore}. Every state-changing
 * operation appends an {@link AuditEvent} before returning, so the audit log is
 * a complete, append-only record of moderation activity (R8.5/R8.7).
 */
export class ModerationToolkit {
  private readonly store: ModerationStore;
  private readonly clock: Clock;

  constructor(store: ModerationStore = new InMemoryModerationStore(), opts: ModerationToolkitOptions = {}) {
    this.store = store;
    this.clock = opts.clock ?? systemClock;
  }

  private async record(actor: string, target: string, action: ModerationAction): Promise<void> {
    await this.store.appendAudit({
      id: randomUUID(),
      actor,
      target,
      action,
      ts: this.clock(),
    });
  }

  /**
   * Submit a report against another user. The report is stored and placed in
   * the moderation queue, and a `report` audit event is recorded (R8.1/R8.5).
   */
  async report(reporter: string, target: string, reason: string): Promise<Report> {
    const report: Report = {
      id: randomUUID(),
      reporter,
      target,
      reason,
      createdAt: this.clock(),
    };
    await this.store.saveReport(report);
    await this.record(reporter, target, 'report');
    return { ...report };
  }

  /**
   * Record that user `a` has blocked user `b` (R8.2), appending a `block` audit
   * event (R8.5).
   */
  async block(a: string, b: string): Promise<void> {
    await this.store.setBlock(a, b);
    await this.record(a, b, 'block');
  }

  /**
   * Whether `from` may send a message to `to`.
   *
   * A block relationship from A to B prevents B from messaging A (R8.3); hence
   * `from` may message `to` if and only if `to` has not blocked `from`.
   */
  async canMessage(from: string, to: string): Promise<boolean> {
    return !(await this.store.isBlocked(to, from));
  }

  /**
   * Record that `muter` has muted `muted` (R8.4), appending a `mute` audit
   * event (R8.5).
   */
  async mute(muter: string, muted: string): Promise<void> {
    await this.store.setMute(muter, muted);
    await this.record(muter, muted, 'mute');
  }

  /**
   * Filter a recipient's feed, suppressing items whose sender the recipient has
   * muted while leaving every other item intact (R8.4). Muting is scoped to the
   * muting user only — the same items delivered to a different recipient are
   * unaffected.
   */
  async deliverable<T extends { sender: string }>(recipient: string, items: T[]): Promise<T[]> {
    const result: T[] = [];
    for (const item of items) {
      if (!(await this.store.isMuted(recipient, item.sender))) {
        result.push(item);
      }
    }
    return result;
  }

  /** List pending reports awaiting moderation (R8.6). */
  async queue(): Promise<Report[]> {
    return this.store.listQueue();
  }

  /**
   * Record a moderator's resolution for a queued report (R8.6), appending a
   * `resolve` audit event (R8.5). Throws {@link UnknownReportError} if the
   * report id is not known.
   */
  async resolve(moderator: string, reportId: string, outcome: string): Promise<void> {
    const report = await this.store.getReport(reportId);
    if (!report) throw new UnknownReportError(reportId);

    report.resolution = { moderator, outcome, resolvedAt: this.clock() };
    await this.store.saveReport(report);
    await this.record(moderator, report.target, 'resolve');
  }

  /**
   * The append-only audit log (R8.5). The returned events are immutable and the
   * toolkit exposes no method to update or delete them (R8.7).
   */
  async audit(): Promise<readonly AuditEvent[]> {
    return this.store.listAudit();
  }
}
