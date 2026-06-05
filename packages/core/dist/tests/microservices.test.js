// src/tests/microservices.test.ts
// Microservices module tests — Task 7 (min 20 tests)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StaticRegistry, ServiceRegistry, } from '../microservices/service-registry.js';
import { CircuitBreaker, CircuitOpenError, } from '../microservices/circuit-breaker.js';
import { EventBus, InProcessTransport, } from '../microservices/event-bus.js';
import { SagaOrchestrator } from '../microservices/saga.js';
import { CommandBus, QueryBus } from '../microservices/cqrs.js';
import { EventStore, EVENTS_MIGRATION_SQL } from '../microservices/event-store.js';
function makeEventPool() {
    const events = [];
    return {
        _events: events,
        async query(sql, params) {
            const s = sql.trim().toUpperCase();
            if (s.startsWith('INSERT')) {
                const [aggId, version, type, payload] = params;
                events.push({ aggregateId: aggId, version, type, payload });
                return { rows: [], rowCount: 1, command: 'INSERT' };
            }
            if (s.startsWith('SELECT') || s.startsWith('CREATE')) {
                const agg = params?.[0];
                const from = params?.[1] ?? 0;
                const filtered = agg
                    ? events
                        .filter((e) => e.aggregateId === agg && e.version >= from)
                        .sort((a, b) => a.version - b.version)
                        .map((e) => ({
                        aggregate_id: e.aggregateId,
                        version: String(e.version),
                        type: e.type,
                        payload: e.payload,
                    }))
                    : [];
                return { rows: filtered, rowCount: filtered.length, command: 'SELECT' };
            }
            return { rows: [], rowCount: 0, command: sql.split(' ')[0]?.toUpperCase() ?? 'UNKNOWN' };
        },
    };
}
// ── StaticRegistry ────────────────────────────────────────────────────────────
describe('StaticRegistry', () => {
    const instances = [
        { id: 's1', name: 'users-service', host: '127.0.0.1', port: 8001, healthy: true },
        { id: 's2', name: 'users-service', host: '127.0.0.1', port: 8002, healthy: false },
        { id: 's3', name: 'orders-service', host: '127.0.0.1', port: 9001, healthy: true },
    ];
    const registry = new StaticRegistry({ 'users-service': instances.slice(0, 2), 'orders-service': [instances[2]] });
    it('getInstances() returns all instances for a registered service', async () => {
        const result = await registry.getInstances('users-service');
        assert.equal(result.length, 2);
    });
    it('getInstances() returns empty array for unknown service', async () => {
        const result = await registry.getInstances('nonexistent');
        assert.equal(result.length, 0);
    });
    it('ServiceRegistry.getHealthy() returns only healthy instances', async () => {
        const svcRegistry = new ServiceRegistry(registry);
        const healthy = await svcRegistry.getHealthy('users-service');
        assert.equal(healthy.length, 1);
        assert.ok(healthy[0].healthy);
        assert.equal(healthy[0].id, 's1');
    });
    it('ServiceRegistry.getHealthy() returns empty for all-unhealthy service', async () => {
        const unhealthy = [
            { id: 'u1', name: 'broken', host: 'h', port: 1, healthy: false },
        ];
        const reg2 = new StaticRegistry({ broken: unhealthy });
        const svcReg = new ServiceRegistry(reg2);
        assert.deepEqual(await svcReg.getHealthy('broken'), []);
    });
});
// ── CircuitBreaker ────────────────────────────────────────────────────────────
describe('CircuitBreaker', () => {
    it('starts in "closed" state', () => {
        const cb = new CircuitBreaker({ failureThreshold: 3 });
        assert.equal(cb.state, 'closed');
    });
    it('execute() returns result when closed', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 3 });
        const result = await cb.execute(async () => 42);
        assert.equal(result, 42);
    });
    it('transitions to "open" after reaching failure threshold', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 2, timeout: 60_000 });
        for (let i = 0; i < 2; i++) {
            await cb.execute(async () => { throw new Error('fail'); }).catch(() => undefined);
        }
        assert.equal(cb.state, 'open');
    });
    it('throws CircuitOpenError when in open state', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 60_000 });
        await cb.execute(async () => { throw new Error('fail'); }).catch(() => undefined);
        await assert.rejects(() => cb.execute(async () => 'should not reach'), (err) => {
            assert.ok(err instanceof CircuitOpenError);
            return true;
        });
    });
    it('emits "circuitbreaker:open" event on Closed→Open transition', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 60_000 });
        let eventFired = false;
        cb.on('circuitbreaker:open', () => { eventFired = true; });
        await cb.execute(async () => { throw new Error('fail'); }).catch(() => undefined);
        assert.ok(eventFired, 'circuitbreaker:open event should fire');
    });
    it('does not execute fn when open (fast fail, no network call)', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 60_000 });
        await cb.execute(async () => { throw new Error('fail'); }).catch(() => undefined);
        let fnCalled = false;
        await cb.execute(async () => { fnCalled = true; return 'x'; }).catch(() => undefined);
        assert.ok(!fnCalled, 'fn should NOT be called when circuit is open');
    });
});
// ── EventBus ─────────────────────────────────────────────────────────────────
describe('EventBus with InProcessTransport', () => {
    it('publish and subscribe delivers message to subscriber', async () => {
        const bus = new EventBus(new InProcessTransport());
        const received = [];
        bus.subscribe('user.created', async (env) => { received.push(env); });
        await bus.publish('user.created', { id: 'u1', name: 'Alice' });
        // Wait for setImmediate in InProcessTransport
        await new Promise((r) => setImmediate(r));
        assert.equal(received.length, 1);
    });
    it('envelope has correct structure (id, topic, timestamp, version, payload)', async () => {
        const bus = new EventBus(new InProcessTransport());
        let received = null;
        bus.subscribe('test.topic', async (env) => { received = env; });
        await bus.publish('test.topic', { data: 42 });
        await new Promise((r) => setImmediate(r));
        const env = received;
        assert.ok(typeof env['id'] === 'string', 'id should be a string');
        assert.equal(env['topic'], 'test.topic');
        assert.ok(typeof env['timestamp'] === 'string', 'timestamp should be a string');
        assert.equal(env['version'], 1);
        assert.deepEqual(env['payload']['data'], 42);
    });
    it('unsubscribe prevents further message delivery', async () => {
        const bus = new EventBus(new InProcessTransport());
        const received = [];
        const unsub = bus.subscribe('evt', async (env) => { received.push(env); });
        await bus.publish('evt', { x: 1 });
        await new Promise((r) => setImmediate(r));
        assert.equal(received.length, 1);
        unsub(); // unsubscribe
        await bus.publish('evt', { x: 2 });
        await new Promise((r) => setImmediate(r));
        assert.equal(received.length, 1, 'Should not receive after unsubscribe');
    });
    it('multiple subscribers on same topic all receive message', async () => {
        const bus = new EventBus(new InProcessTransport());
        const a = [];
        const b = [];
        bus.subscribe('shared', async (env) => { a.push(env); });
        bus.subscribe('shared', async (env) => { b.push(env); });
        await bus.publish('shared', { msg: 'hi' });
        await new Promise((r) => setImmediate(r));
        assert.equal(a.length, 1);
        assert.equal(b.length, 1);
    });
});
// ── SagaOrchestrator ──────────────────────────────────────────────────────────
describe('SagaOrchestrator', () => {
    it('runs all steps in sequence', async () => {
        const order = [];
        const saga = new SagaOrchestrator();
        await saga.execute([
            {
                action: async () => { order.push('step1'); },
                compensate: async () => { order.push('comp1'); },
            },
            {
                action: async () => { order.push('step2'); },
                compensate: async () => { order.push('comp2'); },
            },
        ]);
        assert.deepEqual(order, ['step1', 'step2']);
    });
    it('runs compensation in reverse order on failure', async () => {
        const order = [];
        const saga = new SagaOrchestrator();
        await assert.rejects(() => saga.execute([
            {
                action: async () => { order.push('step1'); },
                compensate: async () => { order.push('comp1'); },
            },
            {
                action: async () => { order.push('step2'); },
                compensate: async () => { order.push('comp2'); },
            },
            {
                action: async () => { throw new Error('step3 failed'); },
                compensate: async () => { order.push('comp3'); },
            },
        ]));
        assert.deepEqual(order, ['step1', 'step2', 'comp2', 'comp1']);
    });
    it('compensation errors are swallowed (do not re-throw)', async () => {
        const saga = new SagaOrchestrator();
        await assert.rejects(() => saga.execute([
            {
                action: async () => { },
                compensate: async () => { throw new Error('compensation failed'); },
            },
            {
                action: async () => { throw new Error('step failed'); },
                compensate: async () => { },
            },
        ]), /step failed/);
    });
});
// ── CommandBus / QueryBus ─────────────────────────────────────────────────────
class CreateUserCommand {
    name;
    constructor(name) {
        this.name = name;
    }
}
class GetUserQuery {
    id;
    constructor(id) {
        this.id = id;
    }
}
describe('CommandBus', () => {
    it('dispatches to registered handler', async () => {
        const bus = new CommandBus();
        let received = null;
        bus.register(CreateUserCommand, async (cmd) => { received = cmd.name; });
        await bus.dispatch(new CreateUserCommand('Alice'));
        assert.equal(received, 'Alice');
    });
    it('throws when no handler registered for command type', async () => {
        const bus = new CommandBus();
        await assert.rejects(() => bus.dispatch(new CreateUserCommand('Alice')));
    });
});
describe('QueryBus', () => {
    it('dispatches and returns result', async () => {
        const bus = new QueryBus();
        bus.register(GetUserQuery, async (q) => ({ id: q.id, name: 'Alice' }));
        const result = await bus.dispatch(new GetUserQuery('u1'));
        assert.deepEqual(result, { id: 'u1', name: 'Alice' });
    });
    it('throws when no handler registered for query type', async () => {
        const bus = new QueryBus();
        await assert.rejects(() => bus.dispatch(new GetUserQuery('u1')));
    });
});
// ── EventStore ────────────────────────────────────────────────────────────────
describe('EventStore', () => {
    it('EVENTS_MIGRATION_SQL contains required columns', () => {
        assert.ok(EVENTS_MIGRATION_SQL.includes('street_events'));
        assert.ok(EVENTS_MIGRATION_SQL.includes('aggregate_id'));
        assert.ok(EVENTS_MIGRATION_SQL.includes('version'));
        assert.ok(EVENTS_MIGRATION_SQL.includes('payload'));
    });
    it('append() and load() returns events in insertion order', async () => {
        const pool = makeEventPool();
        const store = new EventStore(pool);
        await store.append('user-1', [
            { version: 1, type: 'UserCreated', payload: { name: 'Alice' } },
            { version: 2, type: 'UserUpdated', payload: { name: 'Alicia' } },
        ]);
        const events = await store.load('user-1');
        assert.equal(events.length, 2);
        assert.equal(events[0]?.type, 'UserCreated');
        assert.equal(events[1]?.type, 'UserUpdated');
        assert.equal(events[0]?.version, 1);
        assert.equal(events[1]?.version, 2);
    });
    it('load() with fromVersion filters events', async () => {
        const pool = makeEventPool();
        const store = new EventStore(pool);
        await store.append('user-2', [
            { version: 1, type: 'Created', payload: {} },
            { version: 2, type: 'Updated', payload: {} },
            { version: 3, type: 'Deleted', payload: {} },
        ]);
        const events = await store.load('user-2', 2);
        const versionOneAbsent = events.every((e) => e.version >= 2);
        assert.ok(versionOneAbsent);
    });
    it('load() returns empty array for unknown aggregateId', async () => {
        const pool = makeEventPool();
        const store = new EventStore(pool);
        const events = await store.load('nonexistent-aggregate');
        assert.deepEqual(events, []);
    });
});
//# sourceMappingURL=microservices.test.js.map