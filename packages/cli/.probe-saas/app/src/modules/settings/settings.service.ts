// src/modules/settings/settings.service.ts
// Settings module for the SaaS starter (overlay code — NOT framework code).
//
// Stores at most ONE value per (scope, key), where scope is either an
// organization or a user. Reads of a missing (scope, key) return a no-value
// indication (null) WITHOUT creating a row. Writes upsert the single row for
// that (scope, key), replacing the prior value in place and leaving every other
// scope/key untouched. The uniqueness is enforced in the schema by
// UNIQUE(org_id, key) / UNIQUE(user_id, key) (see migrations/003_settings.sql).
//
// Validation: a key longer than 255 characters, or a value that is not valid
// JSON, is rejected and leaves any existing stored value unchanged.

/** Maximum allowed length, in characters, of a settings key. */
export const MAX_SETTINGS_KEY_LENGTH = 255;

/** Thrown when a write is rejected for an invalid key or non-JSON value. */
export class InvalidSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSettingError';
  }
}

/** A persisted settings row for either scope. */
export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * Persistence contract the service relies on (satisfied by @streetjs/orm repos).
 * Implementations MUST enforce one row per (scope, key) — upsert replaces the
 * existing row's value in place rather than inserting a duplicate.
 */
export interface SettingsRepository {
  /** Read the org-scoped value for a key, or null if no row exists. */
  getOrg(orgId: string, key: string): Promise<SettingRow | null>;
  /** Upsert the single org-scoped row for (orgId, key), replacing value in place. */
  upsertOrg(orgId: string, key: string, value: unknown): Promise<void>;
  /** Read the user-scoped value for a key, or null if no row exists. */
  getUser(userId: string, key: string): Promise<SettingRow | null>;
  /** Upsert the single user-scoped row for (userId, key), replacing value in place. */
  upsertUser(userId: string, key: string, value: unknown): Promise<void>;
}

/** Optional audit hook — appends a privileged-action entry on org-scoped writes. */
export interface AuditAppender {
  append(actorId: string, action: string, target: string, meta?: Record<string, unknown>): Promise<void>;
}

/**
 * Validate a settings key. Rejects keys longer than 255 characters.
 * Throws before any persistence runs, so an existing value is left unchanged.
 */
function assertValidKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new InvalidSettingError('settings key must be a non-empty string');
  }
  if (key.length > MAX_SETTINGS_KEY_LENGTH) {
    throw new InvalidSettingError(
      'settings key exceeds ' + MAX_SETTINGS_KEY_LENGTH + ' characters',
    );
  }
}

/**
 * Validate that a value is representable as JSON (it is stored in a JSONB
 * column). Rejects values that JSON cannot encode — undefined, functions,
 * symbols, BigInt, and circular structures. Throws before persistence, so an
 * existing value is left unchanged.
 */
function assertJsonValue(value: unknown): void {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new InvalidSettingError('settings value is not valid JSON');
  }
  // JSON.stringify returns undefined for undefined / functions / symbols.
  if (encoded === undefined) {
    throw new InvalidSettingError('settings value is not valid JSON');
  }
}

export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly audit?: AuditAppender,
  ) {}

  /**
   * getOrg — read an org-scoped setting. Returns null (no-value indication)
   * when no row exists for (orgId, key); never creates a row.
   */
  async getOrg(orgId: string, key: string): Promise<unknown | null> {
    const row = await this.repo.getOrg(orgId, key);
    return row ? row.value : null;
  }

  /**
   * setOrg — write an org-scoped setting. Validates the key and value first
   * (rejecting without touching storage), then upserts the single (orgId, key)
   * row, replacing the prior value in place and leaving all other rows intact.
   */
  async setOrg(orgId: string, actorId: string, key: string, value: unknown): Promise<void> {
    assertValidKey(key);
    assertJsonValue(value);
    await this.repo.upsertOrg(orgId, key, value);
    await this.audit?.append(actorId, 'settings.set', 'org:' + orgId + ':' + key, { key });
  }

  /**
   * getUser — read a user-scoped setting. Returns null (no-value indication)
   * when no row exists for (userId, key); never creates a row.
   */
  async getUser(userId: string, key: string): Promise<unknown | null> {
    const row = await this.repo.getUser(userId, key);
    return row ? row.value : null;
  }

  /**
   * setUser — write a user-scoped setting. Validates the key and value first
   * (rejecting without touching storage), then upserts the single (userId, key)
   * row, replacing the prior value in place and leaving all other rows intact.
   */
  async setUser(userId: string, key: string, value: unknown): Promise<void> {
    assertValidKey(key);
    assertJsonValue(value);
    await this.repo.upsertUser(userId, key, value);
  }
}
