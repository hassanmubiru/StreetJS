// tests/roadmap-partials-2.test.ts
// Completes partial roadmap items:
//  - 27.2  URL versioning (enableVersioning strips the version prefix)
//  - 45.9  Backup checksum integrity + corrupted-restore abort + adapter round-trip
//  - 48.6  Replication failover, preferred-region routing, lag metric labels
//  - 49.8  Agent history summarization + SSE step ordering
import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enableVersioning } from '../versioning/strategy.js';
import { BackupService, LocalStorageAdapter } from '../enterprise/backup.js';
import { ReplicationCoordinator } from '../platform/replication.js';
import { AgentExecutor } from '../platform/ai/agent-executor.js';
import { ToolRegistry } from '../platform/ai/tool-registry.js';
// ── 27.2 URL versioning ─────────────────────────────────────────────────────────
describe('enableVersioning URL strategy (27.2)', () => {
    it('strips a leading /vN prefix and records the version on the context', async () => {
        const middlewares = [];
        const app = { use(mw) { middlewares.push(mw); } };
        enableVersioning(app, { strategy: 'url' });
        assert.equal(middlewares.length, 1);
        const ctx = { path: '/v2/users', headers: {} };
        await middlewares[0](ctx, async () => { });
        assert.equal(ctx['path'], '/users');
        assert.equal(ctx['apiVersion'], 'v2');
        assert.equal(ctx['originalPath'], '/v2/users');
    });
    it('leaves an unversioned path unchanged', async () => {
        const middlewares = [];
        const app = { use(mw) { middlewares.push(mw); } };
        enableVersioning(app, { strategy: 'url' });
        const ctx = { path: '/health', headers: {} };
        await middlewares[0](ctx, async () => { });
        assert.equal(ctx['path'], '/health');
        assert.equal(ctx['apiVersion'], undefined);
    });
});
// ── 45.9 Backup integrity ─────────────────────────────────────────────────────
class FakeBackupPool {
    backups = new Map();
    applied = [];
    tables;
    data;
    constructor(tables, data) {
        this.tables = tables;
        this.data = data;
    }
    async query(sql, params = []) {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('SELECT TABLENAME'))
            return { rows: this.tables.map((t) => ({ tablename: t })) };
        if (s.startsWith('SELECT * FROM')) {
            const m = /FROM "([^"]+)"/.exec(sql);
            return { rows: m ? (this.data[m[1]] ?? []) : [] };
        }
        if (s.startsWith('INSERT INTO STREET_BACKUPS')) {
            this.backups.set(String(params[0]), { checksum: String(params[3]), storage_key: String(params[4]) });
            return { rows: [] };
        }
        if (s.startsWith('SELECT CHECKSUM')) {
            const rec = this.backups.get(String(params[0]));
            return { rows: rec ? [rec] : [] };
        }
        // restore applying statements
        this.applied.push(sql);
        return { rows: [] };
    }
}
describe('BackupService integrity (45.9)', () => {
    it('records a checksum that matches the stored backup and restores successfully', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'street-backup-'));
        try {
            const pool = new FakeBackupPool(['users'], { users: [{ id: '1', name: 'Ada' }] });
            const storage = new LocalStorageAdapter(dir);
            const svc = new BackupService(pool, storage);
            const id = await svc.backup();
            const rec = pool.backups.get(id);
            assert.match(rec.checksum, /^[0-9a-f]{64}$/);
            // Restore verifies the checksum and applies the INSERT statements.
            await svc.restore(id, pool);
            assert.ok(pool.applied.some((s) => /INSERT INTO "users"/.test(s)));
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it('aborts restore on a corrupted backup without applying any statements', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'street-backup-'));
        try {
            const pool = new FakeBackupPool(['users'], { users: [{ id: '1', name: 'Ada' }] });
            const storage = new LocalStorageAdapter(dir);
            const svc = new BackupService(pool, storage);
            const id = await svc.backup();
            const rec = pool.backups.get(id);
            // Corrupt the stored file on disk so its checksum no longer matches.
            const files = readdirSync(dir);
            writeFileSync(join(dir, files[0]), 'CORRUPTED CONTENT');
            const appliedBefore = pool.applied.length;
            await assert.rejects(svc.restore(id, pool), /checksum mismatch/i);
            assert.equal(pool.applied.length, appliedBefore, 'no statements applied on mismatch');
            assert.ok(rec.checksum);
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it('LocalStorageAdapter round-trips content identically (upload then download)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'street-store-'));
        try {
            const storage = new LocalStorageAdapter(dir);
            const { Readable } = await import('node:stream');
            const payload = 'hello-backup-payload-\u00e9\u00e8';
            await storage.write('blob.sql', Readable.from([Buffer.from(payload, 'utf8')]));
            const rs = await storage.read('blob.sql');
            const chunks = [];
            await new Promise((resolve, reject) => {
                rs.on('data', (c) => chunks.push(c));
                rs.on('end', resolve);
                rs.on('error', reject);
            });
            assert.equal(Buffer.concat(chunks).toString('utf8'), payload);
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
// ── 48.6 Replication ───────────────────────────────────────────────────────────
function poolThatWorks() {
    return { async query() { return { rows: [] }; } };
}
describe('ReplicationCoordinator (48.6)', () => {
    it('routes writes to primary and honours X-Preferred-Region for reads', () => {
        const a = poolThatWorks();
        const b = poolThatWorks();
        const coord = new ReplicationCoordinator([{ name: 'us-east', pool: a, primary: true }, { name: 'eu-west', pool: b }], { healthCheckIntervalMs: 0 });
        assert.equal(coord.getWritePool(), a);
        assert.equal(coord.getReadPool('eu-west'), b);
        coord.stop();
    });
    it('promotes the next healthy replica when the primary fails health checks', async () => {
        let primaryHealthy = true;
        const failing = { async query() { if (!primaryHealthy)
                throw new Error('down'); return { rows: [] }; } };
        const replica = poolThatWorks();
        const coord = new ReplicationCoordinator([{ name: 'primary', pool: failing, primary: true }, { name: 'replica', pool: replica }], { healthCheckIntervalMs: 15 });
        const promoted = [];
        coord.on('region:promoted', (e) => promoted.push(e));
        primaryHealthy = false;
        await new Promise((r) => setTimeout(r, 60)); // allow >=1 health tick
        assert.ok(promoted.length >= 1, 'a promotion occurred');
        // Writes now route to the promoted replica.
        assert.equal(coord.getWritePool(), replica);
        coord.stop();
    });
    it('reports replication lag with region and replica_id labels', async () => {
        const primary = {
            async query(sql) {
                if (/pg_stat_replication/i.test(sql)) {
                    return { rows: [{ replica_id: 'replica-1', lag_seconds: 3 }, { replica_id: 'replica-2', lag_seconds: 0 }] };
                }
                return { rows: [] };
            },
        };
        const coord = new ReplicationCoordinator([{ name: 'us-east', pool: primary, primary: true }], { healthCheckIntervalMs: 0 });
        const samples = [];
        await coord.reportReplicationLag({ set: (value, labels) => samples.push({ value, labels }) });
        assert.equal(samples.length, 2);
        assert.deepEqual(samples[0].labels, { region: 'us-east', replica_id: 'replica-1' });
        assert.equal(samples[0].value, 3);
        coord.stop();
    });
});
// ── 49.8 Agent summarization + SSE ordering ─────────────────────────────────────
class ScriptedClient {
    replies;
    onComplete;
    calls = [];
    constructor(replies, onComplete) {
        this.replies = replies;
        this.onComplete = onComplete;
    }
    i = 0;
    async complete(opts) {
        this.calls.push(opts);
        this.onComplete?.(opts);
        const content = this.replies[Math.min(this.i++, this.replies.length - 1)] ?? 'FINAL ANSWER: done';
        return { content, tokens: 0 };
    }
    async *stream() { yield 'x'; }
}
describe('AgentExecutor (49.8)', () => {
    it('emits SSE steps in the correct order (thought → action → observation → final)', async () => {
        const tools = new ToolRegistry();
        tools.register('getTime', async () => '12:00', { type: 'object', properties: {} });
        const client = new ScriptedClient([
            '```json\n{ "tool": "getTime", "args": {} }\n```',
            'FINAL ANSWER: It is 12:00',
        ]);
        const agent = new AgentExecutor(client, tools, { maxSteps: 5 });
        const events = [];
        const ctx = { res: { write: (data) => { events.push(JSON.parse(data.replace(/^data: /, '').trim())); } } };
        const answer = await agent.run('what time is it?', ctx);
        assert.match(answer, /12:00/);
        const types = events.map((e) => e.type);
        // First thought, then the action, its observation, then a thought + final.
        assert.deepEqual(types.slice(0, 3), ['thought', 'action', 'observation']);
        assert.equal(types[types.length - 1], 'final');
        const obs = events.find((e) => e.type === 'observation');
        assert.match(obs.content, /12:00/);
    });
    it('summarizes history when the token budget threshold is exceeded', async () => {
        const tools = new ToolRegistry();
        let summarizeCalled = false;
        const toolCall = '```json\n{ "tool": "noop", "args": {} }\n```';
        // Several tool-call rounds grow the history beyond the 4-message window so
        // _summarizeHistory has middle messages to compress, while the big tool
        // outputs push estimated tokens past the 0.8 * maxTokens threshold.
        const client = new ScriptedClient([toolCall, toolCall, toolCall, toolCall, 'summary text', 'FINAL ANSWER: ok'], (o) => { if (typeof o.messages[0]?.content === 'string' && /Summarize the following/i.test(o.messages[0].content))
            summarizeCalled = true; });
        tools.register('noop', async () => 'y'.repeat(2000), { type: 'object', properties: {} });
        const agent = new AgentExecutor(client, tools, { maxSteps: 8, maxTokens: 200 });
        const answer = await agent.run('go');
        assert.match(answer, /ok/);
        assert.equal(summarizeCalled, true, 'summarization prompt was sent to the LLM');
    });
});
//# sourceMappingURL=roadmap-partials-2.test.js.map