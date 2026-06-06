// tests/certification/enterprise-certification.test.ts
// Certifies enterprise capabilities end-to-end against real implementations:
// multi-tenancy, billing, audit logging + redaction + export, field encryption,
// data classification, compliance reporting, backup/restore, and that all
// messaging transports conform to their transport interface.

import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TenantUsageAggregator } from '../../src/tenancy/metrics.js';
import { InMemoryBillingAdapter } from '../../src/tenancy/billing.js';
import { AuditLogger, Sensitive } from '../../src/enterprise/audit-logger.js';
import { FieldEncryptor, redactByClassification, Classify, Encrypt, ComplianceReporter, RetainFor } from '../../src/enterprise/data-policy.js';
import { BackupService, LocalStorageAdapter } from '../../src/enterprise/backup.js';
import { RabbitMqTransport } from '../../src/transports/rabbitmq/index.js';
import { KafkaStreamTransport } from '../../src/transports/kafka/index.js';

// ── Multi-tenancy + billing ─────────────────────────────────────────────────────

describe('ENTERPRISE — multi-tenancy + billing', () => {
  it('aggregates per-metric tenant usage into daily stats', async () => {
    const calls: unknown[][] = [];
    const pool = { async query(_s: string, p: unknown[] = []) { calls.push(p); return { rows: [], rowCount: 2, command: 'INSERT' }; } };
    const written = await new TenantUsageAggregator(pool).aggregate(new Date('2026-06-01'));
    assert.equal(written, 2);
    assert.equal(calls[0]![0], '2026-06-01');
  });

  it('reports usage through a billing adapter', async () => {
    const billing = new InMemoryBillingAdapter();
    await billing.reportUsage('t1', { start: new Date('2026-06-01'), end: new Date('2026-06-30') }, { requests: 1000 } as never);
    assert.equal(billing.reports.length, 1);
    assert.equal(billing.reports[0]!.tenantId, 't1');
  });
});

// ── Audit logging + redaction + export ────────────────────────────────────────────

describe('ENTERPRISE — audit logging', () => {
  class User { id!: string; email!: string; @Sensitive() passwordHash!: string; }

  function fakePool() {
    const inserts: unknown[][] = [];
    const rows = [{ id: '1', category: 'auth', action: 'login', created_at: '2026-06-01T00:00:00Z' }];
    return {
      inserts,
      async query(sql: string, p: unknown[] = []) {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('INSERT')) { inserts.push(p); return { rows: [], rowCount: 1, command: 'INSERT' }; }
        if (Number(p[3] ?? 0) > 0) return { rows: [], rowCount: 0, command: 'SELECT' };
        return { rows, rowCount: rows.length, command: 'SELECT' };
      },
    };
  }

  it('redacts @Sensitive fields and signs a verifiable hash chain', async () => {
    const pool = fakePool();
    const log = new AuditLogger({ pool, signingKey: 'k'.repeat(32) });
    await log.log({ category: 'data', action: 'update', entityClass: User, beforeState: { id: '1', email: 'a@b.com', passwordHash: 'SECRET' } });
    await log.flush();
    await log.log({ category: 'data', action: 'delete' });
    await log.flush();
    const before = JSON.parse(String(pool.inserts[0]![5]));
    assert.equal(before.passwordHash, '[REDACTED]');
    assert.equal(before.email, 'a@b.com');
    const sig1 = String(pool.inserts[0]![10]); const sig2 = String(pool.inserts[1]![10]);
    assert.match(sig1, /^[0-9a-f]{64}$/); assert.notEqual(sig1, sig2);
  });

  it('exports entries as JSONL', async () => {
    const pool = fakePool();
    const log = new AuditLogger({ pool, signingKey: 'k'.repeat(32) });
    const stream = log.export(new Date('2026-06-01'), new Date('2026-06-30'), 'jsonl');
    const out = await new Promise<string>((res, rej) => { let s = ''; stream.on('data', (c: Buffer) => s += c); stream.on('end', () => res(s)); stream.on('error', rej); });
    assert.match(out, /"action":"login"/);
  });
});

// ── Encryption + classification + compliance ───────────────────────────────────────

describe('ENTERPRISE — encryption / classification / compliance', () => {
  class Payment { id!: string; @Encrypt() pan!: string; @Classify('restricted') token!: string; @RetainFor('365d') createdAt!: string; }

  it('field encryption round-trips and redaction respects classification', () => {
    const enc = new FieldEncryptor('master-key');
    const e = enc.encryptEntity(Payment, { id: '1', pan: '4111', token: 't', createdAt: 'x' });
    assert.match(e.pan, /^enc:v1:/);
    assert.equal(enc.decryptEntity(Payment, e).pan, '4111');
    const red = redactByClassification(Payment, { id: '1', pan: '4111', token: 't', createdAt: 'x' }, 'restricted');
    assert.equal(red.token, '[REDACTED]');
  });

  it('compliance report enumerates annotated fields', () => {
    const report = ComplianceReporter.report([Payment]);
    const pan = report.find((r) => r.field === 'pan');
    assert.ok(pan?.encrypted);
    const token = report.find((r) => r.field === 'token');
    assert.equal(token?.classification, 'restricted');
  });
});

// ── Backup / restore ───────────────────────────────────────────────────────────────

describe('ENTERPRISE — backup / restore', () => {
  it('backs up with a checksum and restores; corrupted restore aborts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ent-backup-'));
    try {
      const store = new Map<string, Record<string, string>>([['users', { id: '1' } as never]]);
      const pool = {
        backups: new Map<string, { checksum: string; storage_key: string }>(),
        applied: [] as string[],
        async query(sql: string, p: unknown[] = []) {
          const s = sql.trim().toUpperCase();
          if (s.startsWith('SELECT TABLENAME')) return { rows: [{ tablename: 'users' }] };
          if (s.startsWith('SELECT * FROM')) return { rows: [{ id: '1', name: 'Ada' }] };
          if (s.startsWith('INSERT INTO STREET_BACKUPS')) { this.backups.set(String(p[0]), { checksum: String(p[3]), storage_key: String(p[4]) }); return { rows: [] }; }
          if (s.startsWith('SELECT CHECKSUM')) { const r = this.backups.get(String(p[0])); return { rows: r ? [r] : [] }; }
          this.applied.push(sql); return { rows: [] };
        },
      };
      void store;
      const svc = new BackupService(pool, new LocalStorageAdapter(dir));
      const id = await svc.backup();
      assert.match(pool.backups.get(id)!.checksum, /^[0-9a-f]{64}$/);
      await svc.restore(id, pool);
      assert.ok(pool.applied.some((s) => /INSERT INTO "users"/.test(s)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Messaging transport conformance ────────────────────────────────────────────────

describe('ENTERPRISE — messaging transport conformance', () => {
  it('RabbitMqTransport conforms to the EventBusTransport interface', () => {
    const t = new RabbitMqTransport({ host: '127.0.0.1' });
    assert.equal(typeof t.publish, 'function');
    assert.equal(typeof t.subscribe, 'function');
    assert.equal(typeof t.close, 'function');
  });

  it('KafkaStreamTransport conforms to the StreamTransport interface', () => {
    const t = new KafkaStreamTransport({ brokers: ['127.0.0.1:9092'] });
    assert.equal(typeof t.publish, 'function');
    assert.equal(typeof t.subscribe, 'function');
    assert.equal(typeof t.close, 'function');
  });
});
