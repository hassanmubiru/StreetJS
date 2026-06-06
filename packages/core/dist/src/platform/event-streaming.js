// src/platform/event-streaming.ts
// Event streaming primitives: transport abstraction, consumer, and realtime aggregator.
import { EventEmitter } from 'node:events';
// ---------------------------------------------------------------------------
// InProcessStreamTransport  (default for testing / single-node usage)
// ---------------------------------------------------------------------------
export class InProcessStreamTransport {
    subs = new Map();
    async publish(topic, payload) {
        const groups = this.subs.get(topic);
        if (!groups)
            return;
        for (const handler of groups.values()) {
            setImmediate(() => void handler(payload));
        }
    }
    subscribe(topic, groupId, handler) {
        if (!this.subs.has(topic))
            this.subs.set(topic, new Map());
        this.subs.get(topic).set(groupId, handler);
        return () => {
            this.subs.get(topic)?.delete(groupId);
        };
    }
}
// ---------------------------------------------------------------------------
// EventStreamPublisher
// ---------------------------------------------------------------------------
export class EventStreamPublisher {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async publish(topic, payload) {
        await this.transport.publish(topic, payload);
    }
}
export class EventStreamConsumer extends EventEmitter {
    transport;
    lagTimer = null;
    constructor(transport) {
        super();
        this.transport = transport;
    }
    async subscribe(topic, groupId, handler) {
        return this.transport.subscribe(topic, groupId, handler);
    }
    /**
     * Monitor consumer lag by periodically comparing the committed offset to the
     * latest partition offset. Emits a `stream:lag` event ({@link LagEvent}) for
     * every partition whose lag exceeds `maxLagThreshold`. The offset sources are
     * supplied by the caller so this works with any transport (e.g. the Kafka
     * client's `fetchOffset` / `listOffset`).
     *
     * Returns a stop function; the timer is `unref()`-ed so it never blocks exit.
     */
    monitorLag(partitions, getCommittedOffset, getLatestOffset, opts) {
        const threshold = BigInt(opts.maxLagThreshold);
        const check = async () => {
            for (const partition of partitions) {
                try {
                    const [committed, latest] = await Promise.all([
                        getCommittedOffset(partition),
                        getLatestOffset(partition),
                    ]);
                    const lag = latest - committed;
                    if (lag > threshold) {
                        const evt = { partition, committedOffset: committed, latestOffset: latest, lag };
                        this.emit('stream:lag', evt);
                    }
                }
                catch (err) {
                    this.emit('error', err instanceof Error ? err : new Error(String(err)));
                }
            }
        };
        this.lagTimer = setInterval(() => { void check(); }, opts.intervalMs ?? 5000);
        this.lagTimer.unref();
        // Kick off an immediate check so callers (and tests) don't wait a full interval.
        void check();
        return () => { if (this.lagTimer) {
            clearInterval(this.lagTimer);
            this.lagTimer = null;
        } };
    }
    /** Run a single lag check immediately (used for on-demand checks and tests). */
    async checkLagOnce(partitions, getCommittedOffset, getLatestOffset, maxLagThreshold) {
        const threshold = BigInt(maxLagThreshold);
        for (const partition of partitions) {
            const [committed, latest] = await Promise.all([
                getCommittedOffset(partition),
                getLatestOffset(partition),
            ]);
            const lag = latest - committed;
            if (lag > threshold) {
                this.emit('stream:lag', { partition, committedOffset: committed, latestOffset: latest, lag });
            }
        }
    }
}
export class RealtimeAggregator {
    regs = new Map();
    register(name, fn, windowMs) {
        if (this.regs.has(name)) {
            // Replace existing registration
            const old = this.regs.get(name);
            clearInterval(old.timer);
        }
        const reg = {
            fn,
            windowMs,
            values: [],
            lastResult: undefined,
            timer: setInterval(() => {
                // Compute result from within-window values
                const now = Date.now();
                reg.values = reg.values.filter((v) => now - v.ts < reg.windowMs);
                if (reg.values.length > 0) {
                    reg.lastResult = reg.fn(reg.values.map((v) => v.value));
                }
            }, Math.min(windowMs, 1_000)),
        };
        reg.timer.unref();
        this.regs.set(name, reg);
    }
    push(name, value) {
        const reg = this.regs.get(name);
        if (!reg)
            return;
        reg.values.push({ value, ts: Date.now() });
    }
    getResult(name) {
        return this.regs.get(name)?.lastResult;
    }
    destroy() {
        for (const reg of this.regs.values()) {
            clearInterval(reg.timer);
        }
        this.regs.clear();
    }
}
//# sourceMappingURL=event-streaming.js.map