// packages/social-comments/src/index.ts
// Official Street Framework social module: @streetjs/social-comments.
//
// Threaded comments on any subject (a post id, photo id, etc.), with reactions
// and @mention extraction.
//
//   * CommentService.comment      — add a comment or threaded reply (parentId).
//   * CommentService.thread       — a subject's comments, chronological.
//   * CommentService.replies      — direct replies to a comment.
//   * CommentService.react/unreact— toggle a per-user reaction (idempotent).
//   * CommentService.reactions    — reaction → count for a comment.
//   * CommentService.mentionsOf   — comments that @mention a given handle.
//   * CommentService.delete       — author-scoped removal (also clears its
//                                    reactions and mentions).
//
// Mentions are parsed from the comment text (`@handle`) and stored normalized
// (lowercased), so notifications/feeds can resolve who was mentioned.
//
// Persistence is pluggable through {@link CommentStore}; an in-memory default
// and a Postgres-backed adapter ({@link PgCommentStore}) are provided.

import { randomUUID } from 'node:crypto';

// ── Migration SQL ─────────────────────────────────────────────────────────────

/** Schema for the Postgres-backed comments, mentions, and reactions. */
export const SOCIAL_COMMENTS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_social_comments (
  seq        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  subject_id TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  parent_id  TEXT,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_social_comments_subject_idx
  ON street_social_comments (subject_id, seq);
CREATE INDEX IF NOT EXISTS street_social_comments_parent_idx
  ON street_social_comments (parent_id, seq);

CREATE TABLE IF NOT EXISTS street_social_comment_mentions (
  comment_id TEXT NOT NULL,
  handle     TEXT NOT NULL,
  PRIMARY KEY (comment_id, handle)
);
CREATE INDEX IF NOT EXISTS street_social_comment_mentions_handle_idx
  ON street_social_comment_mentions (handle);

CREATE TABLE IF NOT EXISTS street_social_comment_reactions (
  comment_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  reaction   TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id, reaction)
);
`.trim();

// ── Mention parsing ─────────────────────────────────────────────────────────────

const MENTION_RE = /(?:^|[^\w@])@([a-zA-Z0-9_]{1,30})/g;

/**
 * Extract unique, normalized (lowercased) @mention handles from text, in order
 * of first appearance. A handle is 1–30 chars of `[A-Za-z0-9_]`. An `@` that is
 * part of an email-like token (preceded by a word char) is not a mention.
 */
export function extractMentions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const handle = m[1]!.toLowerCase();
    if (!seen.has(handle)) {
      seen.add(handle);
      out.push(handle);
    }
  }
  return out;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** A comment (or threaded reply when `parentId` is set). */
export interface Comment {
  id: string;
  subjectId: string;
  authorId: string;
  parentId: string | null;
  text: string;
  /** Normalized @mention handles parsed from `text`. */
  mentions: string[];
  createdAt: number;
  /** Monotonic, store-assigned ordering key. */
  seq: number;
}

/** Input accepted by {@link CommentService.comment}. */
export interface CommentInput {
  subjectId: string;
  authorId: string;
  text: string;
  /** When set, this comment is a reply to the given comment id. */
  parentId?: string;
}

/** A comment without its store-assigned `seq`. */
export type NewComment = Omit<Comment, 'seq'>;

/** Pagination for thread reads. */
export interface ThreadOptions {
  /** Max comments to return. Default 50, clamped to [1, 200]. */
  limit?: number;
  /** Return only comments with `seq` strictly greater than this cursor. */
  after?: number;
}

/** Pluggable persistence for comments, mentions, and reactions. */
export interface CommentStore {
  addComment(comment: NewComment): Promise<Comment>;
  getComment(id: string): Promise<Comment | undefined>;
  /** Remove a comment if owned by `authorId`; also clears its mentions/reactions. */
  removeComment(id: string, authorId: string): Promise<boolean>;
  /** A subject's comments in ascending seq (chronological). */
  bySubject(subjectId: string, limit: number, after?: number): Promise<Comment[]>;
  /** Direct replies to `parentId`, ascending seq. */
  repliesOf(parentId: string): Promise<Comment[]>;
  /** Comments that mention `handle`, ascending seq. */
  byMention(handle: string): Promise<Comment[]>;
  /** Add a reaction; returns true iff newly added. */
  addReaction(commentId: string, userId: string, reaction: string): Promise<boolean>;
  /** Remove a reaction; returns true iff one was removed. */
  removeReaction(commentId: string, userId: string, reaction: string): Promise<boolean>;
  /** reaction → count for a comment. */
  reactionCounts(commentId: string): Promise<Record<string, number>>;
  /** The reactions a given user has applied to a comment. */
  userReactions(commentId: string, userId: string): Promise<string[]>;
}

// ── In-memory store (default) ──────────────────────────────────────────────────

/** Default in-process {@link CommentStore}. */
export class InMemoryCommentStore implements CommentStore {
  private seq = 0;
  private readonly comments: Comment[] = [];
  private readonly byId = new Map<string, Comment>();
  /** commentId -> set of "userId\u0000reaction" */
  private readonly reactions = new Map<string, Set<string>>();

  async addComment(comment: NewComment): Promise<Comment> {
    const stored: Comment = { ...comment, seq: ++this.seq };
    this.comments.push(stored);
    this.byId.set(stored.id, stored);
    return stored;
  }

  async getComment(id: string): Promise<Comment | undefined> {
    return this.byId.get(id);
  }

  async removeComment(id: string, authorId: string): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing || existing.authorId !== authorId) return false;
    this.byId.delete(id);
    const idx = this.comments.findIndex((c) => c.id === id);
    if (idx >= 0) this.comments.splice(idx, 1);
    this.reactions.delete(id);
    return true;
  }

  async bySubject(subjectId: string, limit: number, after?: number): Promise<Comment[]> {
    return this.comments
      .filter((c) => c.subjectId === subjectId && (after === undefined || c.seq > after))
      .slice(0, limit)
      .map(clone);
  }

  async repliesOf(parentId: string): Promise<Comment[]> {
    return this.comments.filter((c) => c.parentId === parentId).map(clone);
  }

  async byMention(handle: string): Promise<Comment[]> {
    const h = handle.toLowerCase();
    return this.comments.filter((c) => c.mentions.includes(h)).map(clone);
  }

  async addReaction(commentId: string, userId: string, reaction: string): Promise<boolean> {
    let set = this.reactions.get(commentId);
    if (!set) {
      set = new Set<string>();
      this.reactions.set(commentId, set);
    }
    const key = `${userId}\u0000${reaction}`;
    if (set.has(key)) return false;
    set.add(key);
    return true;
  }

  async removeReaction(commentId: string, userId: string, reaction: string): Promise<boolean> {
    const set = this.reactions.get(commentId);
    if (!set) return false;
    return set.delete(`${userId}\u0000${reaction}`);
  }

  async reactionCounts(commentId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const key of this.reactions.get(commentId) ?? []) {
      const reaction = key.slice(key.indexOf('\u0000') + 1);
      out[reaction] = (out[reaction] ?? 0) + 1;
    }
    return out;
  }

  async userReactions(commentId: string, userId: string): Promise<string[]> {
    const out: string[] = [];
    const prefix = `${userId}\u0000`;
    for (const key of this.reactions.get(commentId) ?? []) {
      if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
    }
    return out;
  }
}

function clone(c: Comment): Comment {
  return { ...c, mentions: [...c.mentions] };
}

// ── Postgres-backed store ───────────────────────────────────────────────────────

/** Minimal structural pool interface satisfied by Street's `PgPool`. */
export interface SocialCommentsPool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }>;
}

/** Postgres-backed {@link CommentStore} over {@link SOCIAL_COMMENTS_MIGRATION_SQL}. */
export class PgCommentStore implements CommentStore {
  constructor(private readonly pool: SocialCommentsPool) {}

  async addComment(comment: NewComment): Promise<Comment> {
    const res = await this.pool.query(
      `INSERT INTO street_social_comments (id, subject_id, author_id, parent_id, text, created_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
       RETURNING seq`,
      [comment.id, comment.subjectId, comment.authorId, comment.parentId, comment.text, comment.createdAt],
    );
    for (const handle of comment.mentions) {
      await this.pool.query(
        `INSERT INTO street_social_comment_mentions (comment_id, handle)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [comment.id, handle],
      );
    }
    return { ...comment, seq: Number(res.rows[0]!['seq']) };
  }

  async getComment(id: string): Promise<Comment | undefined> {
    const res = await this.pool.query(`${SELECT_COMMENT} WHERE c.id = $1`, [id]);
    const row = res.rows[0];
    return row ? await this.hydrate(row) : undefined;
  }

  async removeComment(id: string, authorId: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM street_social_comments WHERE id = $1 AND author_id = $2`,
      [id, authorId],
    );
    if (res.rowCount === 0) return false;
    await this.pool.query(`DELETE FROM street_social_comment_mentions WHERE comment_id = $1`, [id]);
    await this.pool.query(`DELETE FROM street_social_comment_reactions WHERE comment_id = $1`, [id]);
    return true;
  }

  async bySubject(subjectId: string, limit: number, after?: number): Promise<Comment[]> {
    const res = await this.pool.query(
      `${SELECT_COMMENT} WHERE c.subject_id = $1 AND ($2::bigint IS NULL OR c.seq > $2)
       ORDER BY c.seq ASC LIMIT $3`,
      [subjectId, after ?? null, limit],
    );
    return this.hydrateAll(res.rows);
  }

  async repliesOf(parentId: string): Promise<Comment[]> {
    const res = await this.pool.query(
      `${SELECT_COMMENT} WHERE c.parent_id = $1 ORDER BY c.seq ASC`,
      [parentId],
    );
    return this.hydrateAll(res.rows);
  }

  async byMention(handle: string): Promise<Comment[]> {
    const res = await this.pool.query(
      `${SELECT_COMMENT}
       JOIN street_social_comment_mentions m ON m.comment_id = c.id
       WHERE m.handle = $1 ORDER BY c.seq ASC`,
      [handle.toLowerCase()],
    );
    return this.hydrateAll(res.rows);
  }

  async addReaction(commentId: string, userId: string, reaction: string): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO street_social_comment_reactions (comment_id, user_id, reaction)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [commentId, userId, reaction],
    );
    return res.rowCount > 0;
  }

  async removeReaction(commentId: string, userId: string, reaction: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM street_social_comment_reactions
       WHERE comment_id = $1 AND user_id = $2 AND reaction = $3`,
      [commentId, userId, reaction],
    );
    return res.rowCount > 0;
  }

  async reactionCounts(commentId: string): Promise<Record<string, number>> {
    const res = await this.pool.query(
      `SELECT reaction, COUNT(*)::int AS n FROM street_social_comment_reactions
       WHERE comment_id = $1 GROUP BY reaction`,
      [commentId],
    );
    const out: Record<string, number> = {};
    for (const row of res.rows) out[String(row['reaction'])] = Number(row['n']);
    return out;
  }

  async userReactions(commentId: string, userId: string): Promise<string[]> {
    const res = await this.pool.query(
      `SELECT reaction FROM street_social_comment_reactions
       WHERE comment_id = $1 AND user_id = $2 ORDER BY reaction`,
      [commentId, userId],
    );
    return res.rows.map((r) => String(r['reaction']));
  }

  private async hydrateAll(rows: Record<string, unknown>[]): Promise<Comment[]> {
    const out: Comment[] = [];
    for (const row of rows) out.push(await this.hydrate(row));
    return out;
  }

  private async hydrate(row: Record<string, unknown>): Promise<Comment> {
    const id = String(row['id']);
    const mres = await this.pool.query(
      `SELECT handle FROM street_social_comment_mentions WHERE comment_id = $1`,
      [id],
    );
    return {
      seq: Number(row['seq']),
      id,
      subjectId: String(row['subject_id']),
      authorId: String(row['author_id']),
      parentId: row['parent_id'] == null ? null : String(row['parent_id']),
      text: String(row['text']),
      createdAt: Number(row['created_ms']),
      mentions: mres.rows.map((r) => String(r['handle'])),
    };
  }
}

const SELECT_COMMENT = `
  SELECT c.seq, c.id, c.subject_id, c.author_id, c.parent_id, c.text,
         (EXTRACT(EPOCH FROM c.created_at) * 1000)::bigint AS created_ms
  FROM street_social_comments c`;

// ── CommentService ────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TEXT = 10_000;

/** Options for {@link CommentService}. */
export interface CommentServiceOptions {
  store?: CommentStore;
  now?: () => number;
  idGen?: () => string;
}

/**
 * Threaded comments with reactions and @mentions. Replies are linked by
 * `parentId`; mentions are parsed from text at creation time.
 */
export class CommentService {
  private readonly store: CommentStore;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(options: CommentServiceOptions = {}) {
    this.store = options.store ?? new InMemoryCommentStore();
    this.now = options.now ?? (() => Date.now());
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  /**
   * Add a comment, or a reply when `parentId` is given. Mentions are parsed from
   * the text. Rejects empty fields, oversized text, and replies whose parent is
   * missing or belongs to a different subject.
   */
  async comment(input: CommentInput): Promise<Comment> {
    const subjectId = requireId(input?.subjectId, 'subjectId');
    const authorId = requireId(input?.authorId, 'authorId');
    if (typeof input?.text !== 'string' || input.text.trim().length === 0) {
      throw new Error('CommentService.comment: text must be a non-empty string');
    }
    if (input.text.length > MAX_TEXT) {
      throw new Error(`CommentService.comment: text exceeds ${MAX_TEXT} characters`);
    }

    let parentId: string | null = null;
    if (input.parentId !== undefined) {
      parentId = requireId(input.parentId, 'parentId');
      const parent = await this.store.getComment(parentId);
      if (!parent) {
        throw new Error(`CommentService.comment: parent "${parentId}" does not exist`);
      }
      if (parent.subjectId !== subjectId) {
        throw new Error('CommentService.comment: a reply must share its parent\'s subject');
      }
    }

    return this.store.addComment({
      id: this.idGen(),
      subjectId,
      authorId,
      parentId,
      text: input.text,
      mentions: extractMentions(input.text),
      createdAt: this.now(),
    });
  }

  /** A subject's comments, chronological (ascending seq), paginated by `after`. */
  async thread(subjectId: string, options: ThreadOptions = {}): Promise<Comment[]> {
    return this.store.bySubject(requireId(subjectId, 'subjectId'), clampLimit(options.limit), options.after);
  }

  /** Direct replies to a comment, chronological. */
  async replies(parentId: string): Promise<Comment[]> {
    return this.store.repliesOf(requireId(parentId, 'parentId'));
  }

  /** A single comment by id. */
  async get(commentId: string): Promise<Comment | undefined> {
    return this.store.getComment(requireId(commentId, 'commentId'));
  }

  /** Delete a comment; only its author may delete it. */
  async delete(commentId: string, authorId: string): Promise<boolean> {
    return this.store.removeComment(requireId(commentId, 'commentId'), requireId(authorId, 'authorId'));
  }

  /** Comments that @mention `handle` (case-insensitive), chronological. */
  async mentionsOf(handle: string): Promise<Comment[]> {
    return this.store.byMention(requireNonEmpty(handle, 'handle'));
  }

  /** Toggle on a user's `reaction` to a comment. Idempotent; returns if changed. */
  async react(commentId: string, userId: string, reaction: string): Promise<boolean> {
    return this.store.addReaction(
      requireId(commentId, 'commentId'),
      requireId(userId, 'userId'),
      requireNonEmpty(reaction, 'reaction'),
    );
  }

  /** Remove a user's `reaction` from a comment. Idempotent; returns if changed. */
  async unreact(commentId: string, userId: string, reaction: string): Promise<boolean> {
    return this.store.removeReaction(
      requireId(commentId, 'commentId'),
      requireId(userId, 'userId'),
      requireNonEmpty(reaction, 'reaction'),
    );
  }

  /** reaction → count for a comment. */
  async reactions(commentId: string): Promise<Record<string, number>> {
    return this.store.reactionCounts(requireId(commentId, 'commentId'));
  }

  /** The reactions a given user has applied to a comment. */
  async reactionsByUser(commentId: string, userId: string): Promise<string[]> {
    return this.store.userReactions(requireId(commentId, 'commentId'), requireId(userId, 'userId'));
  }
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`CommentService: ${field} must be a non-empty string`);
  }
  return value;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`CommentService: ${field} must be a non-empty string`);
  }
  return value;
}
