// src/platform/event-streaming.ts
// Event streaming primitives: transport abstraction, consumer, and realtime aggregator.
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
// ---------------------------------------------------------------------------
// EventStreamConsumer
// ---------------------------------------------------------------------------
export class EventStreamConsumer {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async subscribe(topic, groupId, handler) {
        return this.transport.subscribe(topic, groupId, handler);
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