// packages/social-users/src/index.ts
// Official Street Framework social module: @streetjs/social-users.
//
// Provides the social follow graph that the other social modules
// (@streetjs/social-feed, -comments, -notifications) build on:
//
//   * FollowService.follow / unfollow — directional follow edges (idempotent).
//   * FollowService.isFollowing       — edge existence query.
//   * FollowService.followers / following — neighbour listing.
//   * FollowService.isMutual          — both directions present.
//   * FollowService.counts            — follower/following counts.
//
// Persistence is pluggable through {@link FollowStore}. An in-memory default
// ({@link InMemoryFollowStore}) is shipped for tests, examples, and
// single-instance use, and a Postgres-backed adapter ({@link PgFollowStore})
// composes Street's native PG pool. The schema is exported as
// {@link SOCIAL_FOLLOWS_MIGRATION_SQL}.

// ── Migration SQL ─────────────────────────────────────────────────────────────

/**
 * Schema for the Postgres-backed follow graph. Apply once at bootstrap (e.g.
 * `await pool.query(SOCIAL_FOLLOWS_MIGRATION_SQL)`). A composite primary key on
 * (follower_id, followee_id) makes follow edges idempotent at the storage layer.
 */
export const SOCIAL_FOLLOWS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_social_follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS street_social_follows_followee_idx
  ON street_social_follows (followee_id);
CREATE INDEX IF NOT EXISTS street_social_follows_follower_idx
  ON street_social_follows (follower_id);
`.trim();

// ── Types ─────────────────────────────────────────────────────────────────────

/** A directional follow edge: `followerId` follows `followeeId`. */
export interface FollowEdge {
  followerId: string;
  followeeId: string;
  /** Epoch milliseconds at which the edge was first created. */
  createdAt: number;
}

/** Result of {@link FollowService.follow} / {@link FollowService.unfollow}. */
export interface FollowMutationResult {
  /** True iff this call changed the graph (new edge / removed edge). */
  changed: boolean;
  /** True iff, after this call, the two users follow each other. */
  mutual: boolean;
}

/** Follower / following counts for a user. */
export interface FollowCounts {
  followers: number;
  following: number;
}

/**
 * Pluggable persistence for the follow graph. Implementations MUST treat edges
 * as a set: {@link addEdge} is idempotent and {@link removeEdge} on a missing
 * edge is a no-op. All listing methods return ids in insertion order.
 */
export interface FollowStore {
  /** Add a directional edge. Returns true iff a new edge was created. */
  addEdge(followerId: string, followeeId: string, createdAt: number): Promise<boolean>;
  /** Remove a directional edge. Returns true iff an edge was removed. */
  removeEdge(followerId: string, followeeId: string): Promise<boolean>;
  /** Whether `followerId` currently follows `followeeId`. */
  hasEdge(followerId: string, followeeId: string): Promise<boolean>;
  /** Ids that follow `userId` (its followers). */
  followersOf(userId: string): Promise<string[]>;
  /** Ids that `userId` follows (its following set). */
  followingOf(userId: string): Promise<string[]>;
  /** Number of followers of `userId`. */
  countFollowers(userId: string): Promise<number>;
  /** Number of users `userId` follows. */
  countFollowing(userId: string): Promise<number>;
}

// ── In-memory store (default) ──────────────────────────────────────────────────

/** Default in-process {@link FollowStore} backed by Maps. */
export class InMemoryFollowStore implements FollowStore {
  /** followerId -> ordered map of followeeId -> createdAt */
  private readonly following = new Map<string, Map<string, number>>();
  /** followeeId -> ordered set of followerId */
  private readonly followers = new Map<string, Set<string>>();

  async addEdge(followerId: string, followeeId: string, createdAt: number): Promise<boolean> {
    let out = this.following.get(followerId);
    if (!out) {
      out = new Map<string, number>();
      this.following.set(followerId, out);
    }
    if (out.has(followeeId)) return false;
    out.set(followeeId, createdAt);

    let inc = this.followers.get(followeeId);
    if (!inc) {
      inc = new Set<string>();
      this.followers.set(followeeId, inc);
    }
    inc.add(followerId);
    return true;
  }

  async removeEdge(followerId: string, followeeId: string): Promise<boolean> {
    const out = this.following.get(followerId);
    if (!out || !out.has(followeeId)) return false;
    out.delete(followeeId);
    this.followers.get(followeeId)?.delete(followerId);
    return true;
  }

  async hasEdge(followerId: string, followeeId: string): Promise<boolean> {
    return this.following.get(followerId)?.has(followeeId) ?? false;
  }

  async followersOf(userId: string): Promise<string[]> {
    return [...(this.followers.get(userId) ?? [])];
  }

  async followingOf(userId: string): Promise<string[]> {
    return [...(this.following.get(userId)?.keys() ?? [])];
  }

  async countFollowers(userId: string): Promise<number> {
    return this.followers.get(userId)?.size ?? 0;
  }

  async countFollowing(userId: string): Promise<number> {
    return this.following.get(userId)?.size ?? 0;
  }
}

// ── Postgres-backed store ───────────────────────────────────────────────────────

/**
 * Minimal structural pool interface satisfied by Street's `PgPool` (and any
 * compatible pool). Kept narrow so the package does not couple to the full core
 * pool surface.
 */
export interface SocialUsersPool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }>;
}

/**
 * Postgres-backed {@link FollowStore} over {@link SOCIAL_FOLLOWS_MIGRATION_SQL}.
 * Pass a Street `PgPool` (or any {@link SocialUsersPool}). Run the migration
 * once before use.
 */
export class PgFollowStore implements FollowStore {
  constructor(private readonly pool: SocialUsersPool) {}

  async addEdge(followerId: string, followeeId: string, createdAt: number): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO street_social_follows (follower_id, followee_id, created_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))
       ON CONFLICT (follower_id, followee_id) DO NOTHING`,
      [followerId, followeeId, createdAt],
    );
    return res.rowCount > 0;
  }

  async removeEdge(followerId: string, followeeId: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM street_social_follows WHERE follower_id = $1 AND followee_id = $2`,
      [followerId, followeeId],
    );
    return res.rowCount > 0;
  }

  async hasEdge(followerId: string, followeeId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM street_social_follows WHERE follower_id = $1 AND followee_id = $2`,
      [followerId, followeeId],
    );
    return res.rowCount > 0;
  }

  async followersOf(userId: string): Promise<string[]> {
    const res = await this.pool.query(
      `SELECT follower_id FROM street_social_follows WHERE followee_id = $1 ORDER BY created_at, follower_id`,
      [userId],
    );
    return res.rows.map((r) => String(r['follower_id']));
  }

  async followingOf(userId: string): Promise<string[]> {
    const res = await this.pool.query(
      `SELECT followee_id FROM street_social_follows WHERE follower_id = $1 ORDER BY created_at, followee_id`,
      [userId],
    );
    return res.rows.map((r) => String(r['followee_id']));
  }

  async countFollowers(userId: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM street_social_follows WHERE followee_id = $1`,
      [userId],
    );
    return Number(res.rows[0]?.['n'] ?? 0);
  }

  async countFollowing(userId: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM street_social_follows WHERE follower_id = $1`,
      [userId],
    );
    return Number(res.rows[0]?.['n'] ?? 0);
  }
}

// ── FollowService ───────────────────────────────────────────────────────────────

/** Options for {@link FollowService}. */
export interface FollowServiceOptions {
  /** Persistence backend. Defaults to {@link InMemoryFollowStore}. */
  store?: FollowStore;
  /** Clock injection for deterministic timestamps in tests. */
  now?: () => number;
}

/**
 * The social follow graph. Edges are directional and idempotent: following the
 * same user twice is a no-op, and unfollowing someone you do not follow is a
 * no-op. Self-follows are rejected.
 */
export class FollowService {
  private readonly store: FollowStore;
  private readonly now: () => number;

  constructor(options: FollowServiceOptions = {}) {
    this.store = options.store ?? new InMemoryFollowStore();
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * `followerId` follows `followeeId`. Idempotent. Rejects self-follows.
   * Returns whether the graph changed and whether the pair is now mutual.
   */
  async follow(followerId: string, followeeId: string): Promise<FollowMutationResult> {
    const a = requireId(followerId, 'followerId');
    const b = requireId(followeeId, 'followeeId');
    if (a === b) {
      throw new Error('FollowService.follow: a user cannot follow themselves');
    }
    const changed = await this.store.addEdge(a, b, this.now());
    const mutual = await this.store.hasEdge(b, a);
    return { changed, mutual };
  }

  /**
   * `followerId` stops following `followeeId`. Idempotent (no-op if not
   * following). Returns whether the graph changed; `mutual` is always false
   * after an unfollow in this direction.
   */
  async unfollow(followerId: string, followeeId: string): Promise<FollowMutationResult> {
    const a = requireId(followerId, 'followerId');
    const b = requireId(followeeId, 'followeeId');
    if (a === b) {
      throw new Error('FollowService.unfollow: a user cannot unfollow themselves');
    }
    const changed = await this.store.removeEdge(a, b);
    return { changed, mutual: false };
  }

  /** Whether `followerId` currently follows `followeeId`. */
  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const a = requireId(followerId, 'followerId');
    const b = requireId(followeeId, 'followeeId');
    if (a === b) return false;
    return this.store.hasEdge(a, b);
  }

  /** Whether `a` and `b` follow each other. Order-independent. */
  async isMutual(a: string, b: string): Promise<boolean> {
    const x = requireId(a, 'a');
    const y = requireId(b, 'b');
    if (x === y) return false;
    return (await this.store.hasEdge(x, y)) && (await this.store.hasEdge(y, x));
  }

  /** Ids that follow `userId`. */
  async followers(userId: string): Promise<string[]> {
    return this.store.followersOf(requireId(userId, 'userId'));
  }

  /** Ids that `userId` follows. */
  async following(userId: string): Promise<string[]> {
    return this.store.followingOf(requireId(userId, 'userId'));
  }

  /** Follower / following counts for `userId`. */
  async counts(userId: string): Promise<FollowCounts> {
    const id = requireId(userId, 'userId');
    const [followers, following] = await Promise.all([
      this.store.countFollowers(id),
      this.store.countFollowing(id),
    ]);
    return { followers, following };
  }
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`FollowService: ${field} must be a non-empty string`);
  }
  return value;
}
