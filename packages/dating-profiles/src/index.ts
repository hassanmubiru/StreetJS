// packages/dating-profiles/src/index.ts
// Official Street Framework reference package: @streetjs/dating-profiles.
//
// Phase 10 of the consumer-platform-security roadmap (R11). This package
// composes hardened `@streetjs/core` primitives rather than reinventing them:
// profile `bio` values are stored as field-level ciphertext via the core
// `FieldCipher`/`EncryptedField` (Phase 5, R6), so sensitive profile metadata
// is encrypted at rest.
//
// It provides:
//   * `ProfileService.create` — create a profile, storing `bio` encrypted.
//   * `ProfileService.like`   — record a directional like; a `Match` is
//                                recorded the moment two users have liked each
//                                other (reciprocal likes, R11.2).
//   * `ProfileService.isMatch`— query whether two users are mutually matched.
//
// Storage is pluggable through `ProfileStore`; an in-memory implementation is
// shipped for tests, examples, and single-instance deployments.

import { FieldCipher, type EncryptedField } from 'streetjs';

/**
 * A user profile. The `bio` is held as an {@link EncryptedField} so the
 * plaintext is never stored in the clear (R6.1/6.2 via the core FieldCipher).
 */
export interface Profile {
  userId: string;
  displayName: string;
  bio: EncryptedField<string>;
}

/** Input accepted by {@link ProfileService.create}. */
export interface CreateProfileInput {
  userId: string;
  displayName: string;
  bio: string;
}

/** A mutual match between two users, recorded on reciprocal likes (R11.2). */
export interface Match {
  /** The lexicographically smaller user id of the pair. */
  userA: string;
  /** The lexicographically larger user id of the pair. */
  userB: string;
  /** Epoch milliseconds at which the match was recorded. */
  createdAt: number;
}

/** Result of {@link ProfileService.like}. */
export interface LikeResult {
  /** True iff this like completed a reciprocal pair and produced a match. */
  matched: boolean;
}

/**
 * Pluggable persistence for profiles, directional likes, and matches. The
 * default {@link InMemoryProfileStore} is suitable for tests and single-instance
 * use; a shared store can be supplied for multi-instance deployments.
 */
export interface ProfileStore {
  saveProfile(profile: Profile): Promise<void>;
  getProfile(userId: string): Promise<Profile | undefined>;
  hasProfile(userId: string): Promise<boolean>;
  /** Record that `from` likes `to`. Idempotent. */
  addLike(from: string, to: string): Promise<void>;
  /** Whether `from` has liked `to`. */
  hasLike(from: string, to: string): Promise<boolean>;
  /** Persist a match for the (already normalized) pair. Idempotent. */
  addMatch(match: Match): Promise<void>;
  /** Whether a match exists for the normalized pair (userA, userB). */
  hasMatch(userA: string, userB: string): Promise<boolean>;
  /** All matches involving `userId`. */
  matchesFor(userId: string): Promise<Match[]>;
}

/** Default in-process {@link ProfileStore}. */
export class InMemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, Profile>();
  /** `from` -> set of liked `to` user ids. */
  private readonly likes = new Map<string, Set<string>>();
  /** normalized "a\u0000b" pair key -> Match. */
  private readonly matches = new Map<string, Match>();

  async saveProfile(profile: Profile): Promise<void> {
    this.profiles.set(profile.userId, profile);
  }

  async getProfile(userId: string): Promise<Profile | undefined> {
    return this.profiles.get(userId);
  }

  async hasProfile(userId: string): Promise<boolean> {
    return this.profiles.has(userId);
  }

  async addLike(from: string, to: string): Promise<void> {
    let set = this.likes.get(from);
    if (!set) {
      set = new Set<string>();
      this.likes.set(from, set);
    }
    set.add(to);
  }

  async hasLike(from: string, to: string): Promise<boolean> {
    return this.likes.get(from)?.has(to) ?? false;
  }

  async addMatch(match: Match): Promise<void> {
    this.matches.set(pairKey(match.userA, match.userB), match);
  }

  async hasMatch(userA: string, userB: string): Promise<boolean> {
    return this.matches.has(pairKey(userA, userB));
  }

  async matchesFor(userId: string): Promise<Match[]> {
    const out: Match[] = [];
    for (const m of this.matches.values()) {
      if (m.userA === userId || m.userB === userId) out.push(m);
    }
    return out;
  }
}

/** Normalize an unordered pair to a stable, order-independent tuple. */
function normalizePair(a: string, b: string): { userA: string; userB: string } {
  return a <= b ? { userA: a, userB: b } : { userA: b, userB: a };
}

/** Stable key for an unordered pair (NUL separator avoids id-boundary clashes). */
function pairKey(a: string, b: string): string {
  const { userA, userB } = normalizePair(a, b);
  return `${userA}\u0000${userB}`;
}

/** Options for {@link ProfileService}. */
export interface ProfileServiceOptions {
  /** Field cipher used to encrypt `bio` at rest. */
  cipher: FieldCipher;
  /** Persistence backend. Defaults to {@link InMemoryProfileStore}. */
  store?: ProfileStore;
  /** Clock injection for deterministic match timestamps in tests. */
  now?: () => number;
}

/**
 * Profile creation, likes, and reciprocal-match recording (R11.2).
 *
 * `bio` is encrypted with the core {@link FieldCipher} before storage, and a
 * {@link Match} is recorded exactly when two users have liked each other.
 */
export class ProfileService {
  private readonly cipher: FieldCipher;
  private readonly store: ProfileStore;
  private readonly now: () => number;

  constructor(options: ProfileServiceOptions) {
    if (!options || !(options.cipher instanceof FieldCipher)) {
      throw new Error('ProfileService: a FieldCipher is required to encrypt profile bios');
    }
    this.cipher = options.cipher;
    this.store = options.store ?? new InMemoryProfileStore();
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Create a profile, storing `bio` as an {@link EncryptedField} (R11.2, R6).
   * Throws if a profile already exists for `userId`.
   */
  async create(input: CreateProfileInput): Promise<Profile> {
    const userId = requireId(input?.userId, 'userId');
    const displayName = requireString(input?.displayName, 'displayName');
    if (typeof input?.bio !== 'string') {
      throw new Error('ProfileService.create: bio must be a string');
    }
    if (await this.store.hasProfile(userId)) {
      throw new Error(`ProfileService.create: a profile already exists for "${userId}"`);
    }

    const profile: Profile = {
      userId,
      displayName,
      bio: this.cipher.encrypt(input.bio),
    };
    await this.store.saveProfile(profile);
    return profile;
  }

  /** Read the stored profile for `userId`, or `undefined` if none exists. */
  async getProfile(userId: string): Promise<Profile | undefined> {
    return this.store.getProfile(requireId(userId, 'userId'));
  }

  /** Decrypt and return the plaintext bio for `userId` (authorized read, R6.3). */
  async readBio(userId: string): Promise<string | undefined> {
    const profile = await this.store.getProfile(requireId(userId, 'userId'));
    if (!profile) return undefined;
    return this.cipher.decrypt(profile.bio);
  }

  /**
   * Record that `from` likes `to`. If `to` has already liked `from`, a
   * {@link Match} is recorded for the pair and `{ matched: true }` is returned
   * (reciprocal likes produce a match, R11.2). A self-like is rejected.
   */
  async like(from: string, to: string): Promise<LikeResult> {
    const fromId = requireId(from, 'from');
    const toId = requireId(to, 'to');
    if (fromId === toId) {
      throw new Error('ProfileService.like: a user cannot like themselves');
    }

    await this.store.addLike(fromId, toId);

    // A match is recorded the moment the like is reciprocal.
    const reciprocal = await this.store.hasLike(toId, fromId);
    if (reciprocal) {
      const { userA, userB } = normalizePair(fromId, toId);
      if (!(await this.store.hasMatch(userA, userB))) {
        await this.store.addMatch({ userA, userB, createdAt: this.now() });
      }
      return { matched: true };
    }
    return { matched: false };
  }

  /** Whether `a` and `b` are mutually matched. Order-independent (R11.2). */
  async isMatch(a: string, b: string): Promise<boolean> {
    const aId = requireId(a, 'a');
    const bId = requireId(b, 'b');
    if (aId === bId) return false;
    const { userA, userB } = normalizePair(aId, bId);
    return this.store.hasMatch(userA, userB);
  }

  /** All matches involving `userId`. */
  async matches(userId: string): Promise<Match[]> {
    return this.store.matchesFor(requireId(userId, 'userId'));
  }
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ProfileService: ${field} must be a non-empty string`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`ProfileService: ${field} must be a string`);
  }
  return value;
}
