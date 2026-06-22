// src/modules/notifications/notification.service.ts
// Notifications module for the SaaS starter (overlay code — NOT framework code).
//
// IN-APP FIRST: notify() persists a single `notifications` row (user_id, type,
// payload JSONB, created_at, with read_at null) BEFORE attempting any email. If
// that persist fails, no email is sent and an error is thrown indicating the
// notification could not be created — there is no partial row to clean up
// because nothing was written (Requirements 8.1, 8.2).
//
// EMAIL (optional): email delivery composes @streetjs/plugin-sendgrid and is
// gated behind `--with-email` (install-on-demand, documented convention — see
// SAAS.md, mirroring how billing gates @streetjs/plugin-stripe behind
// `--with-billing`). When no Mailer is wired the in-app notification still
// persists and email is simply skipped. When email IS enabled for a
// notification, each attempt is bounded by a 30s timeout; on failure delivery
// is retried up to EMAIL_MAX_RETRIES times. The persisted row is always
// retained, and after the final failed attempt a delivery-failure indication is
// recorded (Requirements 8.3, 8.4).
//
// READ SEMANTICS: listUnread() returns only the requesting user's rows whose
// read_at is null, newest first, capped at MAX_UNREAD_NOTIFICATIONS (100).
// markRead() stamps read_at once and is idempotent if already read; marking a
// notification that does not exist or is not owned by the user changes nothing
// and raises NotFoundException (Requirements 8.5, 8.6, 8.7).

import { InternalException, NotFoundException } from 'streetjs';

/** Maximum number of unread notifications returned by a single request. */
export const MAX_UNREAD_NOTIFICATIONS = 100;

/** Per-attempt email delivery timeout, in milliseconds (Requirement 8.4). */
export const EMAIL_TIMEOUT_MS = 30_000;

/** Number of additional delivery attempts after the first one (Requirement 8.4). */
export const EMAIL_MAX_RETRIES = 3;

/** A persisted notifications row. */
export interface Notification {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

/** Options accepted by notify(). */
export interface NotifyOptions {
  /** When true (and a Mailer is wired), also deliver the notification by email. */
  email?: boolean;
}

/**
 * Persistence contract (satisfied by @streetjs/orm repos). The in-app row is
 * the source of truth; email is best-effort on top of it.
 */
export interface NotificationsRepository {
  /**
   * Insert exactly one notifications row with read_at null and a created_at
   * timestamp, returning the persisted row. A failure here means NO row was
   * written (Requirements 8.1, 8.2).
   */
  insert(values: { user_id: string; type: string; payload: Record<string, unknown> | null }): Promise<Notification>;
  /**
   * Return the user's unread rows (read_at null), ordered created_at DESC, with
   * at most `limit` rows. MUST filter by user_id and honor the limit
   * (Requirement 8.5).
   */
  listUnread(userId: string, limit: number): Promise<Notification[]>;
  /** Look up a notification by id scoped to its owner; null if absent/not owned. */
  findOwned(userId: string, id: string): Promise<Notification | null>;
  /** Stamp read_at for the user's notification. Only called when not already read. */
  markRead(userId: string, id: string, readAt: string): Promise<void>;
  /** Record that email delivery failed for a persisted row (Requirement 8.4). */
  recordDeliveryFailure(id: string): Promise<void>;
}

/** Resolves a user's registered email address for delivery (Requirement 8.3). */
export interface UserEmailLookup {
  emailForUser(userId: string): Promise<string | null>;
}

/**
 * Email transport contract, satisfied by @streetjs/plugin-sendgrid when the
 * project is scaffolded with `--with-email`. Left undefined otherwise, in which
 * case email is skipped and the in-app notification still persists.
 */
export interface Mailer {
  send(message: { to: string; type: string; payload: Record<string, unknown> | null }): Promise<void>;
}

export class NotificationService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly mailer?: Mailer,
    private readonly users?: UserEmailLookup,
  ) {}

  /**
   * notify — persist an in-app notification, then optionally email it.
   *
   * The row is written FIRST (Requirement 8.1). If persistence fails, no email
   * is attempted and an error indicating notification creation failed is thrown;
   * because nothing was written there is no partial row (Requirement 8.2). When
   * email is enabled for this notification and a Mailer is wired, delivery is
   * attempted with a 30s timeout and bounded retries; the persisted row is
   * retained regardless of email outcome (Requirements 8.3, 8.4).
   */
  async notify(
    userId: string,
    type: string,
    payload: Record<string, unknown>,
    opts?: NotifyOptions,
  ): Promise<void> {
    let row: Notification;
    try {
      row = await this.repo.insert({ user_id: userId, type, payload: payload ?? null });
    } catch {
      // 8.2 — no email, no partial row, surface a creation-failed error.
      throw new InternalException('notification creation failed');
    }

    // 8.3 — email only when explicitly enabled AND the transport is wired
    // (`--with-email` composes @streetjs/plugin-sendgrid). Otherwise skip.
    if (opts?.email === true && this.mailer && this.users) {
      await this.deliverEmail(userId, row);
    }
  }

  /**
   * listUnread — the user's unread notifications, newest first, capped at 100.
   * Scoping/ordering/limit are enforced by the repository (Requirement 8.5).
   */
  async listUnread(userId: string): Promise<Notification[]> {
    return this.repo.listUnread(userId, MAX_UNREAD_NOTIFICATIONS);
  }

  /**
   * markRead — stamp read_at for the user's notification.
   *
   * If the notification does not exist or is not owned by the user, nothing
   * changes and NotFoundException is thrown (Requirement 8.7). If it is already
   * read, the call is a no-op so read_at is left unchanged (idempotent,
   * Requirement 8.6).
   */
  async markRead(userId: string, id: string): Promise<void> {
    const existing = await this.repo.findOwned(userId, id);
    if (!existing) {
      throw new NotFoundException('notification not found');
    }
    if (existing.read_at !== null) {
      return; // 8.6 — already read; leave read_at unchanged.
    }
    await this.repo.markRead(userId, id, new Date().toISOString());
  }

  /**
   * deliverEmail — best-effort email delivery for an already-persisted row.
   *
   * Each attempt is bounded by EMAIL_TIMEOUT_MS (30s); on failure or timeout the
   * send is retried up to EMAIL_MAX_RETRIES additional times. The persisted row
   * is never removed. After the final failed attempt a delivery-failure
   * indication is recorded (Requirement 8.4). Never throws — the in-app
   * notification has already succeeded.
   */
  private async deliverEmail(userId: string, row: Notification): Promise<void> {
    const to = await this.users!.emailForUser(userId);
    if (!to) {
      await this.recordFailureSafely(row.id);
      return;
    }

    const maxAttempts = EMAIL_MAX_RETRIES + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await withTimeout(
          this.mailer!.send({ to, type: row.type, payload: row.payload }),
          EMAIL_TIMEOUT_MS,
        );
        return; // delivered
      } catch {
        if (attempt >= maxAttempts) {
          await this.recordFailureSafely(row.id);
          return;
        }
        // otherwise retry
      }
    }
  }

  /** Record a delivery failure without masking the (already successful) notify. */
  private async recordFailureSafely(id: string): Promise<void> {
    try {
      await this.repo.recordDeliveryFailure(id);
    } catch {
      // Recording the failure indicator must not throw out of notify().
    }
  }
}

/**
 * Resolve `p`, or reject if it does not settle within `ms` milliseconds. Used to
 * bound each email delivery attempt at 30s (Requirement 8.4).
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('email delivery timed out')), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
