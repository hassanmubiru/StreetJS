// src/enterprise/data-policy.ts
// Data retention, field-level encryption decorators, and compliance reporting.

export type DataClassificationLevel = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * Marks a property with a retention duration (e.g. '90d', '1y').
 * Metadata key: 'street:retention'
 */
export function RetainFor(duration: string): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const key = String(propertyKey);
    const existing: Record<string, string> =
      (Reflect.getMetadata('street:retention', target.constructor) as Record<string, string> | undefined) ?? {};
    existing[key] = duration;
    Reflect.defineMetadata('street:retention', existing, target.constructor);
  };
}

/**
 * Marks a property for transparent AES-256-GCM field-level encryption.
 * Metadata key: 'street:encrypt'
 */
export function Encrypt(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const key = String(propertyKey);
    const existing: string[] =
      (Reflect.getMetadata('street:encrypt', target.constructor) as string[] | undefined) ?? [];
    if (!existing.includes(key)) existing.push(key);
    Reflect.defineMetadata('street:encrypt', existing, target.constructor);
  };
}

/**
 * Marks a property with a data classification level.
 * Metadata key: 'street:classify'
 */
export function Classify(level: DataClassificationLevel): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const key = String(propertyKey);
    const existing: Record<string, DataClassificationLevel> =
      (Reflect.getMetadata('street:classify', target.constructor) as Record<string, DataClassificationLevel> | undefined) ?? {};
    existing[key] = level;
    Reflect.defineMetadata('street:classify', existing, target.constructor);
  };
}

// ---------------------------------------------------------------------------
// Retention Job
// ---------------------------------------------------------------------------

export interface GenericPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface RetentionEntityMeta {
  table: string;
  retentionDays: number;
}

/**
 * Deletes rows older than the specified retention period in batches.
 */
export class RetentionJob {
  private readonly pool: GenericPool;
  private readonly batchSize: number;

  constructor(pool: GenericPool, batchSize = 1_000) {
    this.pool = pool;
    this.batchSize = batchSize;
  }

  async run(entityMeta: RetentionEntityMeta[]): Promise<void> {
    for (const { table, retentionDays } of entityMeta) {
      await this._deleteForTable(table, retentionDays);
    }
  }

  private async _deleteForTable(table: string, retentionDays: number): Promise<void> {
    // Sanitize table name (alphanumeric + underscore only)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }

    let deleted = 0;
    do {
      const result = await this.pool.query(
        `DELETE FROM ${table}
         WHERE id IN (
           SELECT id FROM ${table}
           WHERE created_at < NOW() - INTERVAL '${retentionDays} days'
           LIMIT ${this.batchSize}
         )`
      );
      deleted = result.rows.length;
    } while (deleted >= this.batchSize);
  }
}

// ---------------------------------------------------------------------------
// Field-level transparent encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Transparent field-level encryption for entity objects. Fields marked with
 * `@Encrypt()` are encrypted with AES-256-GCM before persistence and decrypted
 * on retrieval. The repository layer calls `encryptEntity()` in `create()` /
 * `update()` and `decryptEntity()` in `findById()` / `findAll()`.
 *
 * The ciphertext envelope is `enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>` so it
 * is self-describing and idempotent (already-encrypted values are passed
 * through unchanged, and decryption of a non-envelope value is a no-op).
 */
export class FieldEncryptor {
  private readonly key: Buffer;
  private static readonly PREFIX = 'enc:v1:';

  /** @param key 32-byte key, or any string/Buffer (hashed to 32 bytes via SHA-256). */
  constructor(key: string | Buffer) {
    this.key = key instanceof Buffer && key.length === 32 ? key : createHash('sha256').update(key).digest();
  }

  /** Encrypt a single string value into the self-describing envelope. */
  encryptValue(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${FieldEncryptor.PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
  }

  /** Decrypt an envelope value; non-envelope values are returned unchanged. */
  decryptValue(value: string): string {
    if (!value.startsWith(FieldEncryptor.PREFIX)) return value;
    const [ivB64, tagB64, ctB64] = value.slice(FieldEncryptor.PREFIX.length).split(':');
    if (!ivB64 || !tagB64 || !ctB64) return value;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }

  private static encryptedFields(entityClass: new (...a: never[]) => unknown): string[] {
    return (Reflect.getMetadata('street:encrypt', entityClass) as string[] | undefined) ?? [];
  }

  /** Return a copy of `obj` with all `@Encrypt()` string fields encrypted. */
  encryptEntity<T extends Record<string, unknown>>(entityClass: new (...a: never[]) => unknown, obj: T): T {
    const fields = FieldEncryptor.encryptedFields(entityClass);
    if (fields.length === 0) return obj;
    const out: Record<string, unknown> = { ...obj };
    for (const f of fields) {
      const v = out[f];
      if (typeof v === 'string') out[f] = this.encryptValue(v);
    }
    return out as T;
  }

  /** Return a copy of `obj` with all `@Encrypt()` fields decrypted. */
  decryptEntity<T extends Record<string, unknown>>(entityClass: new (...a: never[]) => unknown, obj: T): T {
    const fields = FieldEncryptor.encryptedFields(entityClass);
    if (fields.length === 0) return obj;
    const out: Record<string, unknown> = { ...obj };
    for (const f of fields) {
      const v = out[f];
      if (typeof v === 'string') out[f] = this.decryptValue(v);
    }
    return out as T;
  }
}

// ---------------------------------------------------------------------------
// Classification-aware log redaction
// ---------------------------------------------------------------------------

const CLASSIFICATION_ORDER: Record<DataClassificationLevel, number> = {
  public: 0, internal: 1, confidential: 2, restricted: 3,
};

/**
 * Redact entity fields whose `@Classify()` level is at or above the configured
 * threshold (default from `LOG_CLASSIFICATION_THRESHOLD`, falling back to
 * `confidential`). Used by the logger to keep classified data out of log sinks.
 * Returns a shallow copy with offending fields replaced by `"[REDACTED]"`.
 */
export function redactByClassification<T extends Record<string, unknown>>(
  entityClass: new (...a: never[]) => unknown,
  obj: T,
  threshold?: DataClassificationLevel,
): T {
  const classify =
    (Reflect.getMetadata('street:classify', entityClass) as Record<string, DataClassificationLevel> | undefined) ?? {};
  const level =
    threshold ?? ((process.env['LOG_CLASSIFICATION_THRESHOLD'] as DataClassificationLevel | undefined) ?? 'confidential');
  const min = CLASSIFICATION_ORDER[level] ?? CLASSIFICATION_ORDER.confidential;
  const out: Record<string, unknown> = { ...obj };
  for (const [field, fieldLevel] of Object.entries(classify)) {
    if ((CLASSIFICATION_ORDER[fieldLevel] ?? 0) >= min && field in out) {
      out[field] = '[REDACTED]';
    }
  }
  return out as T;
}

export interface ComplianceReport {
  field: string;
  entity: string;
  classification?: DataClassificationLevel;
  encrypted: boolean;
  retentionPeriod?: string;
}

export class ComplianceReporter {
  static report(entities: (new () => unknown)[]): ComplianceReport[] {
    const reports: ComplianceReport[] = [];

    for (const EntityClass of entities) {
      const entityName = EntityClass.name;

      const retentionMeta: Record<string, string> =
        (Reflect.getMetadata('street:retention', EntityClass) as Record<string, string> | undefined) ?? {};
      const encryptMeta: string[] =
        (Reflect.getMetadata('street:encrypt', EntityClass) as string[] | undefined) ?? [];
      const classifyMeta: Record<string, DataClassificationLevel> =
        (Reflect.getMetadata('street:classify', EntityClass) as Record<string, DataClassificationLevel> | undefined) ?? {};

      // Collect all annotated fields
      const allFields = new Set<string>([
        ...Object.keys(retentionMeta),
        ...encryptMeta,
        ...Object.keys(classifyMeta),
      ]);

      for (const field of allFields) {
        reports.push({
          field,
          entity: entityName,
          classification: classifyMeta[field],
          encrypted: encryptMeta.includes(field),
          retentionPeriod: retentionMeta[field],
        });
      }
    }

    return reports;
  }
}
