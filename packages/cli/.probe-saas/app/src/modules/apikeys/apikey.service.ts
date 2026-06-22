// src/modules/apikeys/apikey.service.ts
// API key module for the SaaS starter (overlay code — NOT framework code).
//
// Keys are HASHED AT REST: only a display `prefix` and the SHA-256 hash of the
// secret are persisted. The full plaintext key is returned EXACTLY ONCE from
// create() and is unrecoverable thereafter — it never touches the database.
//
//   plaintext = prefix + "." + secret      (shown once, e.g. "sk_live_AB12.<secret>")
//   stored    = { prefix, key_hash: SHA256(secret) }   (never the plaintext)

import { createHash, randomBytes } from 'node:crypto';

export type Scope = string;

/** A persisted API key row. `key_hash` is the SHA-256 of the secret. */
export interface ApiKeyRow {
  id: string;
  org_id: string;
  created_by: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: Scope[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Public metadata view of an API key. By construction this NEVER includes
 * `key_hash` or the plaintext secret — only safe-to-display fields.
 */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Persistence contract the service relies on (satisfied by @streetjs/orm repos). */
export interface ApiKeyRepository {
  insert(values: {
    org_id: string;
    created_by: string;
    name: string;
    prefix: string;
    key_hash: string;
    scopes: Scope[];
    expires_at: Date | null;
  }): Promise<ApiKeyRow>;
  /** Look up a single key by the SHA-256 hash of its secret (UNIQUE). */
  findByHash(keyHash: string): Promise<ApiKeyRow | null>;
  /** All keys for an org (including revoked), newest first. */
  listByOrg(orgId: string): Promise<ApiKeyRow[]>;
  /** Stamp last_used_at = now() for a verified key. */
  touchLastUsed(id: string, when: Date): Promise<void>;
  /** Set revoked_at = now() for a key scoped to org_id; no-op if absent. */
  setRevoked(orgId: string, keyId: string, when: Date): Promise<void>;
}

/** Optional audit hook — appends a privileged-action entry on create/revoke. */
export interface AuditAppender {
  append(actorId: string, action: string, target: string, meta?: Record<string, unknown>): Promise<void>;
}

/** SHA-256 hex digest of an input string. */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Strip the display prefix, returning the secret portion after the first dot. */
function extractSecret(rawKey: string): string {
  const dot = rawKey.indexOf('.');
  return dot >= 0 ? rawKey.slice(dot + 1) : rawKey;
}

export class ApiKeyService {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly audit?: AuditAppender,
    /** Environment label embedded in the prefix (e.g. "live", "test"). */
    private readonly environment: string = process.env['NODE_ENV'] === 'production' ? 'live' : 'test',
  ) {}

  /**
   * create — mint a new API key.
   *
   * A 256-bit random secret is generated; only the display `prefix` and the
   * SHA-256 hash of the secret are stored. The full plaintext (prefix + "." +
   * secret) is returned ONCE and never persisted, so it is unrecoverable from
   * stored data.
   */
  async create(
    orgId: string,
    actorId: string,
    input: { name: string; scopes: Scope[]; expiresAt?: Date },
  ): Promise<{ id: string; plaintext: string }> {
    const secret = randomBytes(32).toString('base64url');
    const prefix = 'sk_' + this.environment + '_' + secret.slice(0, 4);
    const keyHash = sha256(secret);

    const row = await this.repo.insert({
      org_id: orgId,
      created_by: actorId,
      name: input.name,
      prefix,
      key_hash: keyHash,
      scopes: input.scopes,
      expires_at: input.expiresAt ?? null,
    });

    await this.audit?.append(actorId, 'apikey.create', row.id, { name: input.name });

    // Plaintext is returned exactly once; only prefix + key_hash live in the DB.
    return { id: row.id, plaintext: prefix + '.' + secret };
  }

  /**
   * verify — authenticate a raw key presented on a request.
   *
   * The secret is recovered from the raw key, hashed, and looked up. Returns
   * null for unknown, revoked, or expired keys. On success, last_used_at is
   * stamped and the owning org + granted scopes are returned.
   */
  async verify(rawKey: string): Promise<{ orgId: string; scopes: Scope[] } | null> {
    if (!rawKey) return null;

    const secret = extractSecret(rawKey);
    if (!secret) return null;

    const row = await this.repo.findByHash(sha256(secret));
    if (!row || row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

    await this.repo.touchLastUsed(row.id, new Date());

    return { orgId: row.org_id, scopes: row.scopes };
  }

  /**
   * list — metadata for every key in an org. The returned views NEVER include
   * `key_hash` or the plaintext secret.
   */
  async list(orgId: string): Promise<ApiKeyView[]> {
    const rows = await this.repo.listByOrg(orgId);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes,
      last_used_at: r.last_used_at,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
      created_at: r.created_at,
    }));
  }

  /**
   * revoke — mark a key revoked. The key is scoped to org_id so one tenant
   * cannot revoke another's keys. Sets revoked_at = now(); subsequent verify
   * calls for the key return null.
   */
  async revoke(orgId: string, actorId: string, keyId: string): Promise<void> {
    await this.repo.setRevoked(orgId, keyId, new Date());
    await this.audit?.append(actorId, 'apikey.revoke', keyId);
  }
}
