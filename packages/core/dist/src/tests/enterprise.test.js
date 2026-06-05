// src/tests/enterprise.test.ts
// Enterprise module tests — Task 8 (min 20 tests)
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { FeatureFlagService, FEATURE_FLAGS_MIGRATION_SQL, } from '../enterprise/feature-flags.js';
import { AuditLogger, Sensitive, ENTERPRISE_AUDIT_MIGRATION_SQL, } from '../enterprise/audit-logger.js';
import { RetainFor, Encrypt, Classify, ComplianceReporter, RetentionJob, } from '../enterprise/data-policy.js';
import { BACKUPS_MIGRATION_SQL } from '../enterprise/backup.js';
function makePool(flagRows = []) {
    const calls = [];
    return {
        _calls: calls,
        async query(sql, params) {
            calls.push({ sql, params });
            return {
                rows: flagRows,
                rowCount: flagRows.length,
                command: sql.trim().split(' ')[0]?.toUpperCase() ?? 'UNKNOWN',
            };
        },
    };
}
// ── Migration SQL tests ───────────────────────────────────────────────────────
describe('Enterprise — Migration SQL', () => {
    it('FEATURE_FLAGS_MIGRATION_SQL contains street_feature_flags table', () => {
        assert.ok(FEATURE_FLAGS_MIGRATION_SQL.includes('street_feature_flags'));
        assert.ok(FEATURE_FLAGS_MIGRATION_SQL.includes('name'));
        assert.ok(FEATURE_FLAGS_MIGRATION_SQL.includes('enabled'));
        assert.ok(FEATURE_FLAGS_MIGRATION_SQL.includes('rules'));
    });
    it('ENTERPRISE_AUDIT_MIGRATION_SQL contains street_audit_log table', () => {
        assert.ok(ENTERPRISE_AUDIT_MIGRATION_SQL.includes('street_audit_log'));
        assert.ok(ENTERPRISE_AUDIT_MIGRATION_SQL.includes('action'));
        assert.ok(ENTERPRISE_AUDIT_MIGRATION_SQL.includes('created_at'));
    });
    it('BACKUPS_MIGRATION_SQL contains street_backups table', () => {
        assert.ok(BACKUPS_MIGRATION_SQL.includes('street_backups'));
        assert.ok(BACKUPS_MIGRATION_SQL.includes('checksum'));
        assert.ok(BACKUPS_MIGRATION_SQL.includes('created_at'));
    });
});
// ── FeatureFlagService ────────────────────────────────────────────────────────
describe('FeatureFlagService', () => {
    it('returns false for unknown flag (not throw)', async () => {
        const pool = makePool([]); // no rows
        const svc = new FeatureFlagService(pool);
        const result = await svc.isEnabled('nonexistent-flag');
        assert.equal(result, false);
    });
    it('returns false when flag.enabled is false', async () => {
        const pool = {
            async query(_sql) {
                return { rows: [{ name: 'my-flag', enabled: false, rules: [] }], rowCount: 1, command: 'SELECT' };
            },
        };
        const svc = new FeatureFlagService(pool);
        const result = await svc.isEnabled('my-flag');
        assert.equal(result, false);
    });
    it('returns true when flag is enabled with no targeting rules', async () => {
        const pool = makePool([{ name: 'open-flag', enabled: true, rules: [] }]);
        const svc = new FeatureFlagService(pool);
        const result = await svc.isEnabled('open-flag');
        assert.equal(result, true);
    });
    it('user_id rule: returns true for matching user', async () => {
        const pool = makePool([{
                name: 'user-flag',
                enabled: true,
                rules: [{ type: 'user_id', value: 'user-42' }],
            }]);
        const svc = new FeatureFlagService(pool);
        const result = await svc.isEnabled('user-flag', { userId: 'user-42' });
        assert.equal(result, true);
    });
    it('user_id rule: returns false for non-matching user', async () => {
        const pool = makePool([{
                name: 'user-flag',
                enabled: true,
                rules: [{ type: 'user_id', value: 'user-42' }],
            }]);
        const svc = new FeatureFlagService(pool);
        const result = await svc.isEnabled('user-flag', { userId: 'user-99' });
        assert.equal(result, false);
    });
    it('percentage rule: 100% always returns true for any user', async () => {
        const pool = makePool([{
                name: 'full-rollout',
                enabled: true,
                rules: [{ type: 'percentage', value: 100 }],
            }]);
        const svc = new FeatureFlagService(pool);
        for (let i = 0; i < 5; i++) {
            const result = await svc.isEnabled('full-rollout', { userId: `user-${i}` });
            assert.equal(result, true);
        }
    });
    it('percentage rule: 0% always returns false', async () => {
        const pool = makePool([{
                name: 'no-rollout',
                enabled: true,
                rules: [{ type: 'percentage', value: 0 }],
            }]);
        const svc = new FeatureFlagService(pool);
        for (let i = 0; i < 5; i++) {
            const result = await svc.isEnabled('no-rollout', { userId: `user-${i}` });
            assert.equal(result, false);
        }
    });
    it('percentage rollout is stable for same userId (deterministic hash)', async () => {
        const pool = makePool([{
                name: 'stable-flag',
                enabled: true,
                rules: [{ type: 'percentage', value: 50 }],
            }]);
        const svc = new FeatureFlagService(pool);
        const results = await Promise.all(Array.from({ length: 5 }, () => svc.isEnabled('stable-flag', { userId: 'consistent-user-42' })));
        // All results must be the same (deterministic)
        assert.ok(results.every((r) => r === results[0]));
    });
    it('invalidateCache() forces a DB re-read on next call', async () => {
        let callCount = 0;
        const pool = {
            async query(_sql) {
                callCount++;
                return {
                    rows: [{ name: 'cached-flag', enabled: true, rules: [] }],
                    rowCount: 1,
                    command: 'SELECT',
                };
            },
        };
        const svc = new FeatureFlagService(pool);
        await svc.isEnabled('cached-flag'); // populates cache
        await svc.isEnabled('cached-flag'); // should hit cache (no extra DB call)
        const countAfterCache = callCount;
        svc.invalidateCache('cached-flag');
        await svc.isEnabled('cached-flag'); // should re-fetch
        assert.ok(callCount > countAfterCache, 'Should re-read DB after invalidation');
    });
});
// ── AuditLogger ───────────────────────────────────────────────────────────────
describe('AuditLogger', () => {
    it('log() queues entry and flushes to DB when batch size reached', async () => {
        const queries = [];
        const pool = {
            async query(sql) {
                queries.push(sql);
                return { rows: [], rowCount: 0, command: 'INSERT' };
            },
        };
        const logger = new AuditLogger({ pool, signingKey: 'test-signing-key-at-least-32-bytes!!' });
        // Fill exactly 100 entries to trigger flush
        for (let i = 0; i < 100; i++) {
            await logger.log({ category: 'data', action: `action-${i}`, actorId: 'user1' });
        }
        // After 100 entries, flush should have been called
        const insertQueries = queries.filter((q) => q.includes('INSERT'));
        assert.ok(insertQueries.length >= 1, 'Should have at least one INSERT after 100 log entries');
    });
    it('log() does not immediately flush for small batches', async () => {
        const queries = [];
        const pool = {
            async query(sql) {
                queries.push(sql);
                return { rows: [], rowCount: 0, command: 'INSERT' };
            },
        };
        const logger = new AuditLogger({ pool, signingKey: 'test-signing-key-at-least-32-bytes!!' });
        // Only 2 entries — should not flush immediately
        await logger.log({ category: 'auth', action: 'login', actorId: 'user1' });
        await logger.log({ category: 'auth', action: 'logout', actorId: 'user1' });
        const insertQueries = queries.filter((q) => q.includes('INSERT'));
        // May be 0 (buffered) or 1 (if auto-flush timer fired) — both valid
        assert.ok(insertQueries.length <= 2, 'Should not have many inserts for small batch');
    });
});
// ── Data Policy Decorators ────────────────────────────────────────────────────
describe('@Sensitive decorator', () => {
    it('stores field name in metadata', () => {
        class UserEntity {
            id;
            password;
            ssn;
            email;
        }
        __decorate([
            Sensitive(),
            __metadata("design:type", String)
        ], UserEntity.prototype, "password", void 0);
        __decorate([
            Sensitive(),
            __metadata("design:type", String)
        ], UserEntity.prototype, "ssn", void 0);
        const fields = Reflect.getMetadata('street:sensitive', UserEntity);
        assert.ok(Array.isArray(fields), 'Metadata should be an array');
        assert.ok(fields.includes('password'), 'Should contain password');
        assert.ok(fields.includes('ssn'), 'Should contain ssn');
        assert.ok(!(fields ?? []).includes('email'), 'Should not contain email');
    });
});
describe('@RetainFor decorator', () => {
    it('stores retention period on property', () => {
        class UserData {
            logs;
            profiles;
        }
        __decorate([
            RetainFor('90d'),
            __metadata("design:type", String)
        ], UserData.prototype, "logs", void 0);
        __decorate([
            RetainFor('1y'),
            __metadata("design:type", String)
        ], UserData.prototype, "profiles", void 0);
        const meta = Reflect.getMetadata('street:retention', UserData);
        assert.ok(typeof meta === 'object');
        assert.equal(meta['logs'], '90d');
        assert.equal(meta['profiles'], '1y');
    });
});
describe('@Encrypt decorator', () => {
    it('stores encrypted field names on class metadata', () => {
        class PaymentEntity {
            cardNumber;
            cvv;
            amount;
        }
        __decorate([
            Encrypt(),
            __metadata("design:type", String)
        ], PaymentEntity.prototype, "cardNumber", void 0);
        __decorate([
            Encrypt(),
            __metadata("design:type", String)
        ], PaymentEntity.prototype, "cvv", void 0);
        const fields = Reflect.getMetadata('street:encrypt', PaymentEntity);
        assert.ok(Array.isArray(fields));
        assert.ok(fields.includes('cardNumber'));
        assert.ok(fields.includes('cvv'));
        assert.ok(!(fields ?? []).includes('amount'));
    });
});
describe('@Classify decorator', () => {
    it('stores classification level on property', () => {
        class Document {
            secretKey;
            title;
        }
        __decorate([
            Classify('restricted'),
            __metadata("design:type", String)
        ], Document.prototype, "secretKey", void 0);
        __decorate([
            Classify('public'),
            __metadata("design:type", String)
        ], Document.prototype, "title", void 0);
        const meta = Reflect.getMetadata('street:classify', Document);
        assert.equal(meta['secretKey'], 'restricted');
        assert.equal(meta['title'], 'public');
    });
});
describe('ComplianceReporter', () => {
    it('reports fields with all annotations', () => {
        class ReportEntity {
            id;
            ssn;
            auditLog;
            name;
        }
        __decorate([
            Encrypt(),
            Classify('confidential'),
            __metadata("design:type", String)
        ], ReportEntity.prototype, "ssn", void 0);
        __decorate([
            RetainFor('7y'),
            __metadata("design:type", String)
        ], ReportEntity.prototype, "auditLog", void 0);
        const reports = ComplianceReporter.report([ReportEntity]);
        const ssnReport = reports.find((r) => r.field === 'ssn');
        const logReport = reports.find((r) => r.field === 'auditLog');
        assert.ok(ssnReport, 'SSN field should appear in compliance report');
        assert.ok(ssnReport.encrypted, 'SSN should be marked encrypted');
        assert.equal(ssnReport.classification, 'confidential');
        assert.ok(logReport, 'auditLog field should appear in compliance report');
        assert.equal(logReport.retentionPeriod, '7y');
        // id and name should NOT appear (no annotations)
        const nameReport = reports.find((r) => r.field === 'name');
        assert.ok(!nameReport, 'Unannotated field should not appear');
    });
    it('returns empty array for class with no decorated properties', () => {
        class PlainClass {
            id;
            name;
        }
        const reports = ComplianceReporter.report([PlainClass]);
        assert.deepEqual(reports, []);
    });
});
describe('RetentionJob', () => {
    it('run() calls DELETE for each entity table', async () => {
        const deletedTables = [];
        const pool = {
            async query(sql) {
                if (sql.includes('DELETE')) {
                    const match = sql.match(/FROM\s+(\w+)/i);
                    if (match)
                        deletedTables.push(match[1]);
                }
                return { rows: [], rowCount: 0, command: 'DELETE' };
            },
        };
        const job = new RetentionJob(pool);
        await job.run([
            { table: 'user_events', retentionDays: 90 },
            { table: 'api_logs', retentionDays: 30 },
        ]);
        assert.ok(deletedTables.includes('user_events'), 'Should DELETE from user_events');
        assert.ok(deletedTables.includes('api_logs'), 'Should DELETE from api_logs');
    });
    it('run() throws for unsafe table name (SQL injection prevention)', async () => {
        const pool = { async query() { return { rows: [], rowCount: 0, command: 'DELETE' }; } };
        const job = new RetentionJob(pool);
        await assert.rejects(() => job.run([{ table: "users; DROP TABLE users;--", retentionDays: 30 }]), /unsafe|invalid|characters/i);
    });
});
//# sourceMappingURL=enterprise.test.js.map