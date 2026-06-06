// tests/data-policy-encryption.test.ts
// Tests for transparent field-level encryption (44.2), classification-aware
// log redaction (44.3), and event-stream consumer lag monitoring (47.4).

import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Encrypt, Classify, FieldEncryptor, redactByClassification } from '../enterprise/data-policy.js';
import { EventStreamConsumer, InProcessStreamTransport, type LagEvent } from '../platform/event-streaming.js';

describe('FieldEncryptor — transparent AES-256-GCM (44.2)', () => {
  class PaymentEntity {
    id!: string;
    @Encrypt() cardNumber!: string;
    @Encrypt() cvv!: string;
    amount!: number;
  }

  const enc = new FieldEncryptor('a-master-key-from-the-vault');

  it('encrypts annotated fields and round-trips on decrypt', () => {
    const row = { id: 'p1', cardNumber: '4111111111111111', cvv: '123', amount: 4200 };
    const encrypted = enc.encryptEntity(PaymentEntity, row);
    // Annotated fields are now ciphertext envelopes; others untouched.
    assert.notEqual(encrypted.cardNumber, row.cardNumber);
    assert.match(encrypted.cardNumber, /^enc:v1:/);
    assert.match(encrypted.cvv, /^enc:v1:/);
    assert.equal(encrypted.amount, 4200);

    const decrypted = enc.decryptEntity(PaymentEntity, encrypted);
    assert.equal(decrypted.cardNumber, '4111111111111111');
    assert.equal(decrypted.cvv, '123');
    assert.equal(decrypted.amount, 4200);
  });

  it('produces a unique IV per encryption (different ciphertext for same input)', () => {
    const a = enc.encryptValue('same-value');
    const b = enc.encryptValue('same-value');
    assert.notEqual(a, b);
    assert.equal(enc.decryptValue(a), 'same-value');
    assert.equal(enc.decryptValue(b), 'same-value');
  });

  it('decrypt is a no-op for non-envelope (plaintext) values', () => {
    assert.equal(enc.decryptValue('not-encrypted'), 'not-encrypted');
  });

  it('a tampered ciphertext fails the GCM auth tag', () => {
    const envelope = enc.encryptValue('secret');
    const tampered = envelope.slice(0, -4) + 'AAAA';
    assert.throws(() => enc.decryptValue(tampered));
  });

  it('a different key cannot decrypt', () => {
    const envelope = enc.encryptValue('secret');
    const other = new FieldEncryptor('a-different-master-key');
    assert.throws(() => other.decryptValue(envelope));
  });

  it('entities with no @Encrypt fields pass through untouched', () => {
    class Plain { id!: string; name!: string; }
    const obj = { id: '1', name: 'x' };
    assert.equal(enc.encryptEntity(Plain, obj), obj);
  });
});

describe('redactByClassification — classified log redaction (44.3)', () => {
  class Document {
    title!: string;            // unannotated
    @Classify('public') summary!: string;
    @Classify('confidential') notes!: string;
    @Classify('restricted') secretKey!: string;
  }

  it('redacts fields at or above the threshold, keeps lower ones', () => {
    const obj = { title: 'T', summary: 'S', notes: 'N', secretKey: 'K' };
    const out = redactByClassification(Document, obj, 'confidential');
    assert.equal(out.title, 'T');
    assert.equal(out.summary, 'S');           // public < confidential → kept
    assert.equal(out.notes, '[REDACTED]');    // confidential >= threshold → redacted
    assert.equal(out.secretKey, '[REDACTED]'); // restricted >= threshold → redacted
  });

  it('a restricted threshold keeps confidential fields', () => {
    const obj = { title: 'T', summary: 'S', notes: 'N', secretKey: 'K' };
    const out = redactByClassification(Document, obj, 'restricted');
    assert.equal(out.notes, 'N');
    assert.equal(out.secretKey, '[REDACTED]');
  });

  it('honours LOG_CLASSIFICATION_THRESHOLD env var when no explicit threshold', () => {
    const prev = process.env['LOG_CLASSIFICATION_THRESHOLD'];
    process.env['LOG_CLASSIFICATION_THRESHOLD'] = 'restricted';
    try {
      const out = redactByClassification(Document, { title: 'T', summary: 'S', notes: 'N', secretKey: 'K' });
      assert.equal(out.notes, 'N');
      assert.equal(out.secretKey, '[REDACTED]');
    } finally {
      if (prev === undefined) delete process.env['LOG_CLASSIFICATION_THRESHOLD'];
      else process.env['LOG_CLASSIFICATION_THRESHOLD'] = prev;
    }
  });
});

describe('EventStreamConsumer — lag monitoring (47.4)', () => {
  it('emits stream:lag when committed offset falls behind the latest', async () => {
    const consumer = new EventStreamConsumer(new InProcessStreamTransport());
    const events: LagEvent[] = [];
    consumer.on('stream:lag', (e) => events.push(e as LagEvent));

    const committed = new Map<number, bigint>([[0, 100n], [1, 500n]]);
    const latest = new Map<number, bigint>([[0, 110n], [1, 1500n]]);

    await consumer.checkLagOnce(
      [0, 1],
      async (p) => committed.get(p)!,
      async (p) => latest.get(p)!,
      50, // threshold
    );

    // Partition 0 lag = 10 (<= 50, no event); partition 1 lag = 1000 (> 50, event).
    assert.equal(events.length, 1);
    assert.equal(events[0]!.partition, 1);
    assert.equal(events[0]!.lag, 1000n);
  });

  it('does not emit when lag is within the threshold', async () => {
    const consumer = new EventStreamConsumer(new InProcessStreamTransport());
    let fired = false;
    consumer.on('stream:lag', () => { fired = true; });
    await consumer.checkLagOnce([0], async () => 90n, async () => 100n, 50);
    assert.equal(fired, false);
  });

  it('monitorLag runs an immediate check and returns a stop function', async () => {
    const consumer = new EventStreamConsumer(new InProcessStreamTransport());
    const events: LagEvent[] = [];
    consumer.on('stream:lag', (e) => events.push(e as LagEvent));
    const stop = consumer.monitorLag(
      [0],
      async () => 0n,
      async () => 9999n,
      { maxLagThreshold: 10, intervalMs: 60_000 },
    );
    // Immediate check fires synchronously-ish; await a microtask turn.
    await new Promise((r) => setTimeout(r, 20));
    stop();
    assert.ok(events.length >= 1);
    assert.equal(events[0]!.lag, 9999n);
  });
});

import { StreetPostgresRepository } from '../database/repository.js';
import type { PgPool } from '../database/pool.js';

describe('Repository transparent encryption integration (44.2)', () => {
  class Account {
    id!: string;
    @Encrypt() ssn!: string;
    name!: string;
  }

  // A fake pool that stores the last INSERT params and echoes a row back.
  class FakePool {
    lastInsertParams: unknown[] = [];
    store = new Map<string, Record<string, string>>();
    async query(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, string>[]; rowCount: number; command: string }> {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('INSERT')) {
        this.lastInsertParams = params;
        const row = { id: 'acct-1', ssn: String(params[0]), name: String(params[1]) };
        this.store.set('acct-1', row);
        return { rows: [row], rowCount: 1, command: 'INSERT' };
      }
      if (s.startsWith('SELECT')) {
        const row = this.store.get(String(params[0]));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0, command: 'SELECT' };
      }
      return { rows: [], rowCount: 0, command: 'SELECT' };
    }
  }

  class AccountRepo extends StreetPostgresRepository<Account> {
    protected readonly tableName = 'accounts';
    protected readonly encryptor = new FieldEncryptor('repo-master-key');
    protected readonly encryptedEntity = Account;
    protected mapRow(row: Record<string, string | null>): Account {
      return { id: row['id']!, ssn: row['ssn']!, name: row['name']! };
    }
  }

  it('stores ciphertext in the DB and returns plaintext to the caller', async () => {
    const pool = new FakePool();
    const repo = new AccountRepo(pool as unknown as PgPool);

    const created = await repo.create({ ssn: '123-45-6789', name: 'Ada' });
    // The value persisted (INSERT param) is encrypted...
    assert.match(String(pool.lastInsertParams[0]), /^enc:v1:/);
    // ...but the object returned to the caller is decrypted.
    assert.equal(created.ssn, '123-45-6789');
    assert.equal(created.name, 'Ada');

    // And a subsequent read decrypts transparently.
    const found = await repo.findById('acct-1');
    assert.equal(found?.ssn, '123-45-6789');
  });
});
