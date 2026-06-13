// packages/social-notifications/src/index.ts
// Official Street Framework social module: @streetjs/social-notifications.
//
// A per-user notification inbox that the other social modules feed into.
//
//   * NotificationService.notify        — create a notification for a recipient.
//   * NotificationService.list          — a recipient's notifications, newest
//                                          first, optionally unread-only, paged.
//   * NotificationService.unreadCount    — number of unread notifications.
//   * NotificationService.markRead       — mark one read (recipient-scoped).
//   * NotificationService.markAllRead     — mark all read; returns the count.
//   * NotificationService.delete          — remove one (recipient-scoped).
//
// Convenience builders (onFollow / onMention / onComment / onReaction) produce
// typed notifications from the events emitted by @streetjs/social-users,
// -feed, and -comments. A notification is never delivered to its own actor
// (e.g. reacting to your own comment notifies no one).
//
// Persistence is pluggable through {@link NotificationStore}; an in-memory
// default and a Postgres-backed adapter ({@link PgNotificationStore}) ship.

import { randomUUID } from 'node:crypto';

// ── Migration SQL ─────────────────────────────────────────────────────────────

/** Schema for the Postgres-backed notification inbox. */
export const SOCIAL_NOTIFICATIONS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_social_notifications (
  seq          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  recipient_id TEXT NOT NULL,
  type         TEXT NOT NULL,
  actor_id     TEXT,
  subject_id   TEXT,
  data_json    TEXT,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_social_notifications_recipient_idx
  ON street_social_notifications (recipient_id, seq DESC);
CREATE INDEX IF NOT EXISTS street_social_notifications_unread_idx
  ON street_social_notifications (recipient_id, read);
`.trim();

// ── Types ─────────────────────────────────────────────────────────────────────

/** Built-in notification types produced by the convenience builders. */
export type NotificationType = 'follow' | 'mention' | 'comment' | 'reaction' | (string & {});

/** A single notification in a recipient's inbox. */
export interface Notification {
  id: string;
  recipientId: string;
  type: NotificationType;
  /** The user who caused the notification, if any. */
  actorId: string | null;
  /** The entity the notification concerns (post id, comment id, …), if any. */
  subjectId: string | null;
  /** Arbitrary, JSON-serializable payload. */
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: number;
  /** Monotonic, store-assigned ordering key (also the pagination cursor). */
  seq: number;
}

/** Input accepted by {@link NotificationService.notify}. */
export interface NotifyInput {
  recipientId: string;
  type: NotificationType;
  actorId?: string;
  subjectId?: string;
  data?: Record<string, unknown>;
}

/** A notification without its store-assigned `seq`. */
export type NewNotification = Omit<Notification, 'seq'>;

/** Options for {@link NotificationService.list}. */
export interface ListOptions {
  /** Max to return. Default 20, clamped to [1, 100]. */
  limit?: number;
  /** Return only notifications with `seq` strictly less than this cursor. */
  before?: number;
  /** When true, only unread notifications are returned. */
  unreadOnly?: boolean;
}

/** Pluggable persistence for the notification inbox. */
export interface NotificationStore {
  add(notification: NewNotification): Promise<Notification>;
  get(id: string): Promise<Notification | undefined>;
  remove(id: string, recipientId: string): Promise<boolean>;
  list(recipientId: string, limit: number, before?: number, unreadOnly?: boolean): Promise<Notification[]>;
  /** Mark one read; returns true iff it was unread and is now read. */
  markRead(id: string, recipientId: string): Promise<boolean>;
  /** Mark all of a recipient's notifications read; returns how many changed. */
  markAllRead(recipientId: string): Promise<number>;
  countUnread(recipientId: string): Promise<number>;
}

// ── In-memory store (default) ──────────────────────────────────────────────────

/** Default in-process {@link NotificationStore}. */
export class InMemoryNotificationStore implements NotificationStore {
  private seq = 0;
  private readonly items: Notification[] = [];
  private readonly byId = new Map<string, Notification>();

  async add(notification: NewNotification): Promise<Notification> {
    const stored: Notification = { ...notification, seq: ++this.seq };
    this.items.push(stored);
    this.byId.set(stored.id, stored);
    return clone(stored);
  }

  async get(id: string): Promise<Notification | undefined> {
    const n = this.byId.get(id);
    return n ? clone(n) : undefined;
  }

  async remove(id: string, recipientId: string): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing || existing.recipientId !== recipientId) return false;
    this.byId.delete(id);
    const idx = this.items.findIndex((n) => n.id === id);
    if (idx >= 0) this.items.splice(idx, 1);
    return true;
  }

  async list(recipientId: string, limit: number, before?: number, unreadOnly?: boolean): Promise<Notification[]> {
    const out: Notification[] = [];
    for (let i = this.items.length - 1; i >= 0 && out.length < limit; i--) {
      const n = this.items[i]!;
      if (n.recipientId !== recipientId) continue;
      if (before !== undefined && n.seq >= before) continue;
      if (unreadOnly && n.read) continue;
      out.push(clone(n));
    }
    return out;
  }

  async markRead(id: string, recipientId: string): Promise<boolean> {
    const n = this.byId.get(id);
    if (!n || n.recipientId !== recipientId || n.read) return false;
    n.read = true;
    return true;
  }

  async markAllRead(recipientId: string): Promise<number> {
    let count = 0;
    for (const n of this.items) {
      if (n.recipientId === recipientId && !n.read) {
        n.read = true;
        count++;
      }
    }
    return count;
  }

  async countUnread(recipientId: string): Promise<number> {
    let count = 0;
    for (const n of this.items) if (n.recipientId === recipientId && !n.read) count++;
    return count;
  }
}

function clone(n: Notification): Notification {
  return { ...n, data: n.data ? { ...n.data } : null };
}

// ── Postgres-backed store ───────────────────────────────────────────────────────

/** Minimal structural pool interface satisfied by Street's `PgPool`. */
export interface SocialNotificationsPool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }>;
}

/** Postgres-backed {@link NotificationStore} over {@link SOCIAL_NOTIFICATIONS_MIGRATION_SQL}. */
export class PgNotificationStore implements NotificationStore {
  constructor(private readonly pool: SocialNotificationsPool) {}

  async add(notification: NewNotification): Promise<Notification> {
    const res = await this.pool.query(
      `INSERT INTO street_social_notifications
         (id, recipient_id, type, actor_id, subject_id, data_json, read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
       RETURNING seq`,
      [
        notification.id,
        notification.recipientId,
        notification.type,
        notification.actorId,
        notification.subjectId,
        notification.data ? JSON.stringify(notification.data) : null,
        notification.read,
        notification.createdAt,
      ],
    );
    return { ...notification, seq: Number(res.rows[0]!['seq']) };
  }

  async get(id: string): Promise<Notification | undefined> {
    const res = await this.pool.query(`${SELECT_N} WHERE id = $1`, [id]);
    const row = res.rows[0];
    return row ? rowToNotification(row) : undefined;
  }

  async remove(id: string, recipientId: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM street_social_notifications WHERE id = $1 AND recipient_id = $2`,
      [id, recipientId],
    );
    return res.rowCount > 0;
  }

  async list(recipientId: string, limit: number, before?: number, unreadOnly?: boolean): Promise<Notification[]> {
    const res = await this.pool.query(
      `${SELECT_N}
       WHERE recipient_id = $1
         AND ($2::bigint IS NULL OR seq < $2)
         AND ($3 = FALSE OR read = FALSE)
       ORDER BY seq DESC LIMIT $4`,
      [recipientId, before ?? null, unreadOnly === true, limit],
    );
    return res.rows.map(rowToNotification);
  }

  async markRead(id: string, recipientId: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE street_social_notifications SET read = TRUE
       WHERE id = $1 AND recipient_id = $2 AND read = FALSE`,
      [id, recipientId],
    );
    return res.rowCount > 0;
  }

  async markAllRead(recipientId: string): Promise<number> {
    const res = await this.pool.query(
      `UPDATE street_social_notifications SET read = TRUE
       WHERE recipient_id = $1 AND read = FALSE`,
      [recipientId],
    );
    return res.rowCount;
  }

  async countUnread(recipientId: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM street_social_notifications
       WHERE recipient_id = $1 AND read = FALSE`,
      [recipientId],
    );
    return Number(res.rows[0]?.['n'] ?? 0);
  }
}

const SELECT_N = `
  SELECT seq, id, recipient_id, type, actor_id, subject_id, data_json, read,
         (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms
  FROM street_social_notifications`;

function rowToNotification(row: Record<string, unknown>): Notification {
  const raw = row['data_json'];
  let data: Record<string, unknown> | null = null;
  if (typeof raw === 'string' && raw.length > 0) {
    data = JSON.parse(raw) as Record<string, unknown>;
  } else if (raw && typeof raw === 'object') {
    data = raw as Record<string, unknown>;
  }
  return {
    seq: Number(row['seq']),
    id: String(row['id']),
    recipientId: String(row['recipient_id']),
    type: String(row['type']),
    actorId: row['actor_id'] == null ? null : String(row['actor_id']),
    subjectId: row['subject_id'] == null ? null : String(row['subject_id']),
    data,
    read: row['read'] === true || row['read'] === 't',
    createdAt: Number(row['created_ms']),
  };
}

// ── NotificationService ──────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Options for {@link NotificationService}. */
export interface NotificationServiceOptions {
  store?: NotificationStore;
  now?: () => number;
  idGen?: () => string;
}

/** Per-user notification inbox with create/list/read/count operations. */
export class NotificationService {
  private readonly store: NotificationStore;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(options: NotificationServiceOptions = {}) {
    this.store = options.store ?? new InMemoryNotificationStore();
    this.now = options.now ?? (() => Date.now());
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  /**
   * Create a notification. Returns the stored notification, or `null` when it
   * would notify the actor about their own action (self-notifications are
   * suppressed).
   */
  async notify(input: NotifyInput): Promise<Notification | null> {
    const recipientId = requireId(input?.recipientId, 'recipientId');
    const type = requireNonEmpty(input?.type, 'type');
    const actorId = input?.actorId !== undefined ? requireId(input.actorId, 'actorId') : null;
    const subjectId = input?.subjectId !== undefined ? requireId(input.subjectId, 'subjectId') : null;

    // Suppress self-notifications.
    if (actorId !== null && actorId === recipientId) return null;

    return this.store.add({
      id: this.idGen(),
      recipientId,
      type,
      actorId,
      subjectId,
      data: input?.data ?? null,
      read: false,
      createdAt: this.now(),
    });
  }

  /** A recipient's notifications, newest first, paginated and optionally unread-only. */
  async list(recipientId: string, options: ListOptions = {}): Promise<Notification[]> {
    return this.store.list(
      requireId(recipientId, 'recipientId'),
      clampLimit(options.limit),
      options.before,
      options.unreadOnly,
    );
  }

  /** A single notification by id. */
  async get(notificationId: string): Promise<Notification | undefined> {
    return this.store.get(requireId(notificationId, 'notificationId'));
  }

  /** Number of unread notifications for a recipient. */
  async unreadCount(recipientId: string): Promise<number> {
    return this.store.countUnread(requireId(recipientId, 'recipientId'));
  }

  /** Mark one notification read (recipient-scoped). Idempotent. */
  async markRead(notificationId: string, recipientId: string): Promise<boolean> {
    return this.store.markRead(requireId(notificationId, 'notificationId'), requireId(recipientId, 'recipientId'));
  }

  /** Mark all of a recipient's notifications read; returns how many changed. */
  async markAllRead(recipientId: string): Promise<number> {
    return this.store.markAllRead(requireId(recipientId, 'recipientId'));
  }

  /** Delete a notification (recipient-scoped). */
  async delete(notificationId: string, recipientId: string): Promise<boolean> {
    return this.store.remove(requireId(notificationId, 'notificationId'), requireId(recipientId, 'recipientId'));
  }

  // ── Convenience builders for social events ───────────────────────────────────

  /** `actorId` started following `recipientId`. */
  async onFollow(recipientId: string, actorId: string): Promise<Notification | null> {
    return this.notify({ recipientId, actorId, type: 'follow' });
  }

  /** `actorId` mentioned `recipientId` in `subjectId` (a post/comment id). */
  async onMention(recipientId: string, actorId: string, subjectId: string): Promise<Notification | null> {
    return this.notify({ recipientId, actorId, subjectId, type: 'mention' });
  }

  /** `actorId` commented on `recipientId`'s `subjectId`. */
  async onComment(recipientId: string, actorId: string, subjectId: string): Promise<Notification | null> {
    return this.notify({ recipientId, actorId, subjectId, type: 'comment' });
  }

  /** `actorId` reacted (`reaction`) to `recipientId`'s `subjectId`. */
  async onReaction(
    recipientId: string,
    actorId: string,
    subjectId: string,
    reaction: string,
  ): Promise<Notification | null> {
    return this.notify({ recipientId, actorId, subjectId, type: 'reaction', data: { reaction } });
  }
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`NotificationService: ${field} must be a non-empty string`);
  }
  return value;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`NotificationService: ${field} must be a non-empty string`);
  }
  return value;
}
