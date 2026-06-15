import { ModerationToolkit, type ModerationStore, type ModerationAuditEvent, type Report, type Clock } from 'streetjs';
/** Options for {@link DatingModeration}. */
export interface DatingModerationOptions {
    /**
     * A pre-constructed toolkit to wrap. When provided, `store` and `clock` are
     * ignored — the supplied toolkit governs storage and timestamps.
     */
    toolkit?: ModerationToolkit;
    /**
     * Backing store for a toolkit constructed by this package. Defaults to a
     * fresh {@link InMemoryModerationStore}. Ignored when `toolkit` is provided.
     */
    store?: ModerationStore;
    /**
     * Injected now-provider for deterministic timestamps under test. Ignored when
     * `toolkit` is provided.
     */
    clock?: Clock;
}
/**
 * Dating-app blocking and reporting, built on the core {@link ModerationToolkit}
 * (R11.4).
 *
 * This is a thin, intention-revealing facade: each method delegates to the
 * toolkit so the framework's moderation guarantees (block prevents the blocked
 * user from messaging the blocker, reports are queued, the audit log is
 * append-only) apply without re-implementation.
 */
export declare class DatingModeration {
    private readonly toolkit;
    constructor(options?: DatingModerationOptions);
    /** The underlying core toolkit, exposed for advanced composition. */
    get moderation(): ModerationToolkit;
    /**
     * Report another user. The report is stored and placed in the moderation
     * queue, and a `report` audit event is recorded (composes R8.1/R8.5).
     */
    reportUser(reporter: string, target: string, reason: string): Promise<Report>;
    /** List reports awaiting moderator review (composes R8.6). */
    reviewQueue(): Promise<Report[]>;
    /**
     * Record a moderator's resolution for a queued report (composes R8.6). Throws
     * the core `UnknownReportError` if the report id is not known.
     */
    resolveReport(moderator: string, reportId: string, outcome: string): Promise<void>;
    /**
     * Record that `blocker` has blocked `blocked` (composes R8.2). While the
     * block exists, `blocked` may no longer message `blocker` (R8.3).
     */
    blockUser(blocker: string, blocked: string): Promise<void>;
    /**
     * Whether `from` may send a message to `to`. A block from `to` to `from`
     * prevents it (composes R8.3): `from` may message `to` iff `to` has not
     * blocked `from`.
     */
    canMessage(from: string, to: string): Promise<boolean>;
    /**
     * Whether a block exists in *either* direction between two users. Useful for
     * a dating app that should hide both users from each other once either one
     * blocks (composes R8.2/R8.3).
     */
    isBlockedBetween(a: string, b: string): Promise<boolean>;
    /** The append-only moderation audit log (composes R8.5/R8.7). */
    auditLog(): Promise<readonly ModerationAuditEvent[]>;
}
export type { ModerationAuditEvent, Report, ModerationStore, Clock } from 'streetjs';
export { ModerationToolkit, InMemoryModerationStore, UnknownReportError } from 'streetjs';
//# sourceMappingURL=index.d.ts.map