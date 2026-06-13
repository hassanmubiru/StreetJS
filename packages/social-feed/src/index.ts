// packages/social-feed/src/index.ts
// Official Street Framework social module: @streetjs/social-feed.
//
// Post publishing and timeline generation over the follow graph
// (@streetjs/social-users). Uses fan-out-on-read: posts are stored once per
// author and a home timeline is assembled by merging the posts of everyone a
// user follows, newest first.
//
//   * FeedService.publish       — append a post for an author.
//   * FeedService.userTimeline  — an author's own posts, newest first.
//   * FeedService.homeTimeline  — posts from everyone a user follows (+self,
//                                  optional), newest first, cursor-paginated.
//   * FeedService.delete        — remove a post (author-scoped).
//
// Ordering is by a store-assigned monotonic sequence number, so posts created
// within the same millisecond still have a total, stable order, and `seq`
// doubles as an opaque pagination cursor.
//
// Persistence is pluggable through {@link FeedStore}; an in-memory default and a
// Postgres-backed adapter ({@link PgFeedStore}) are provided. The follow set is
// supplied by any {@link FolloweeSource} — `@streetjs/social-users`'
// `FollowService` satisfies it structurally via its `following()` method.

import { randomUUID } from 'node:crypto';

// ── Migration SQL ─────────────────────────────────────────────────────────────

/** Schema for the Postgres-backed feed. Apply once at bootstrap. */
export const SOCIAL_POSTS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_social_posts (
  seq        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  author_id  TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_social_posts_author_seq_idx
  ON street_social_posts (author_id, seq DESC);
`.trim();

// ── Types ─────────────────────────────────────────────────────────────────────

/** A published post. `seq` is a store-assigned monotonic ordering key/cursor. */
export interface Post {
  id: string;
  authorId: string;
  text: string;
  /** Epoch milliseconds at publish time. */
  createdAt: number;
  /** Monotonic, store-assigned ordering key (also the pagination cursor). */
  seq: number;
}

/** Input accepted by {@link FeedService.publish}. */
export interface PublishInput {
  authorId: string;
  text: string;
}

/** Pagination options for timeline reads. */
export interface TimelineOptions {
  /** Max posts to return. Default 20, clamped to [1, 100]. */
  limit?: number;
  /** Return only posts with `seq` strictly less than this cursor (older). */
  before?: number;
}

/** Source of the set of users a given user follows. */
export interface FolloweeSource {
  following(userId: string): Promise<string[]>;
}

/** A post without its store-assigned `seq` (the store assigns it on insert). */
export type NewPost = Omit<Post, 'seq'>;

/**
 * Pluggable persistence for posts. {@link addPost} assigns and returns the
 * monotonic `seq`. Timeline reads return posts in descending `seq` (newest
 * first).
 */
export interface FeedStore {
  /** Persist a post, assigning a monotonic `seq`. Returns the stored post. */
  addPost(post: NewPost): Promise<Post>;
  /** Remove a post by id if it belongs to `authorId`. Returns true if removed. */
  removePost(id: string, authorId: string): Promise<boolean>;
  /** A single post by id. */
  getPost(id: string): Promise<Post | undefined>;
  /** An author's posts, newest first. */
  byAuthor(authorId: string, limit: number, before?: number): Promise<Post[]>;
  /** Posts by any of `authorIds`, merged newest first. */
  byAuthors(authorIds: string[], limit: number, before?: number): Promise<Post[]>;
}

// ── In-memory store (default) ──────────────────────────────────────────────────

/** Default in-process {@link FeedStore}. */
export class InMemoryFeedStore implements FeedStore {
  private seq = 0;
  /** seq-ordered list of posts (ascending seq). */
  private readonly posts: Post[] = [];
  private readonly byId = new Map<string, Post>();

  async addPost(post: NewPost): Promise<Post> {
    const stored: Post = { ...post, seq: ++this.seq };
    this.posts.push(stored);
    this.byId.set(stored.id, stored);
    return stored;
  }

  async removePost(id: string, authorId: string): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing || existing.authorId !== authorId) return false;
    this.byId.delete(id);
    const idx = this.posts.findIndex((p) => p.id === id);
    if (idx >= 0) this.posts.splice(idx, 1);
    return true;
  }

  async getPost(id: string): Promise<Post | undefined> {
    return this.byId.get(id);
  }

  async byAuthor(authorId: string, limit: number, before?: number): Promise<Post[]> {
    return this.collect((p) => p.authorId === authorId, limit, before);
  }

  async byAuthors(authorIds: string[], limit: number, before?: number): Promise<Post[]> {
    const set = new Set(authorIds);
    if (set.size === 0) return [];
    return this.collect((p) => set.has(p.authorId), limit, before);
  }

  private collect(match: (p: Post) => boolean, limit: number, before?: number): Post[] {
    const out: Post[] = [];
    // Iterate newest-first (descending seq).
    for (let i = this.posts.length - 1; i >= 0 && out.length < limit; i--) {
      const p = this.posts[i]!;
      if (before !== undefined && p.seq >= before) continue;
      if (match(p)) out.push(p);
    }
    return out;
  }
}

// ── Postgres-backed store ───────────────────────────────────────────────────────

/** Minimal structural pool interface satisfied by Street's `PgPool`. */
export interface SocialFeedPool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }>;
}

/** Postgres-backed {@link FeedStore} over {@link SOCIAL_POSTS_MIGRATION_SQL}. */
export class PgFeedStore implements FeedStore {
  constructor(private readonly pool: SocialFeedPool) {}

  async addPost(post: NewPost): Promise<Post> {
    const res = await this.pool.query(
      `INSERT INTO street_social_posts (id, author_id, text, created_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
       RETURNING seq`,
      [post.id, post.authorId, post.text, post.createdAt],
    );
    return { ...post, seq: Number(res.rows[0]!['seq']) };
  }

  async removePost(id: string, authorId: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM street_social_posts WHERE id = $1 AND author_id = $2`,
      [id, authorId],
    );
    return res.rowCount > 0;
  }

  async getPost(id: string): Promise<Post | undefined> {
    const res = await this.pool.query(
      `SELECT seq, id, author_id, text, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms
       FROM street_social_posts WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? rowToPost(row) : undefined;
  }

  async byAuthor(authorId: string, limit: number, before?: number): Promise<Post[]> {
    const res = await this.pool.query(
      `SELECT seq, id, author_id, text, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms
       FROM street_social_posts
       WHERE author_id = $1 AND ($2::bigint IS NULL OR seq < $2)
       ORDER BY seq DESC LIMIT $3`,
      [authorId, before ?? null, limit],
    );
    return res.rows.map(rowToPost);
  }

  async byAuthors(authorIds: string[], limit: number, before?: number): Promise<Post[]> {
    if (authorIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT seq, id, author_id, text, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms
       FROM street_social_posts
       WHERE author_id = ANY($1) AND ($2::bigint IS NULL OR seq < $2)
       ORDER BY seq DESC LIMIT $3`,
      [authorIds, before ?? null, limit],
    );
    return res.rows.map(rowToPost);
  }
}

function rowToPost(row: Record<string, unknown>): Post {
  return {
    seq: Number(row['seq']),
    id: String(row['id']),
    authorId: String(row['author_id']),
    text: String(row['text']),
    createdAt: Number(row['created_ms']),
  };
}

// ── FeedService ─────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Options for {@link FeedService}. */
export interface FeedServiceOptions {
  /** The follow graph providing each user's following set (for home timelines). */
  followees: FolloweeSource;
  /** Persistence backend. Defaults to {@link InMemoryFeedStore}. */
  store?: FeedStore;
  /** Whether a user's own posts appear in their home timeline. Default true. */
  includeSelf?: boolean;
  /** Clock injection for deterministic timestamps in tests. */
  now?: () => number;
  /** Id generator injection (defaults to crypto.randomUUID). */
  idGen?: () => string;
}

/**
 * Post publishing and timeline generation (fan-out-on-read). A home timeline is
 * the merge of posts authored by everyone the reader follows (and, by default,
 * the reader), newest first.
 */
export class FeedService {
  private readonly store: FeedStore;
  private readonly followees: FolloweeSource;
  private readonly includeSelf: boolean;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(options: FeedServiceOptions) {
    if (!options || typeof options.followees?.following !== 'function') {
      throw new Error('FeedService: a FolloweeSource (e.g. a FollowService) is required');
    }
    this.followees = options.followees;
    this.store = options.store ?? new InMemoryFeedStore();
    this.includeSelf = options.includeSelf ?? true;
    this.now = options.now ?? (() => Date.now());
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  /** Publish a post for `authorId`. Rejects empty author or empty text. */
  async publish(input: PublishInput): Promise<Post> {
    const authorId = requireId(input?.authorId, 'authorId');
    if (typeof input?.text !== 'string' || input.text.trim().length === 0) {
      throw new Error('FeedService.publish: text must be a non-empty string');
    }
    return this.store.addPost({
      id: this.idGen(),
      authorId,
      text: input.text,
      createdAt: this.now(),
    });
  }

  /** Delete a post; only its author may delete it. Returns whether it was removed. */
  async delete(postId: string, authorId: string): Promise<boolean> {
    return this.store.removePost(requireId(postId, 'postId'), requireId(authorId, 'authorId'));
  }

  /** A single post by id. */
  async get(postId: string): Promise<Post | undefined> {
    return this.store.getPost(requireId(postId, 'postId'));
  }

  /** An author's own posts, newest first. */
  async userTimeline(authorId: string, options: TimelineOptions = {}): Promise<Post[]> {
    return this.store.byAuthor(requireId(authorId, 'authorId'), clampLimit(options.limit), options.before);
  }

  /**
   * The home timeline for `userId`: posts from everyone they follow (and, by
   * default, their own), newest first, cursor-paginated by `before` (seq).
   */
  async homeTimeline(userId: string, options: TimelineOptions = {}): Promise<Post[]> {
    const id = requireId(userId, 'userId');
    const following = await this.followees.following(id);
    const authors = new Set(following);
    if (this.includeSelf) authors.add(id);
    return this.store.byAuthors([...authors], clampLimit(options.limit), options.before);
  }
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`FeedService: ${field} must be a non-empty string`);
  }
  return value;
}
