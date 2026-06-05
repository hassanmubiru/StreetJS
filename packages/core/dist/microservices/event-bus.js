// src/microservices/event-bus.ts
// In-process and pluggable event bus with envelope wrapping.
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
// ── InProcessTransport ─────────────────────────────────────────────────────────
export class InProcessTransport {
    _emitter = new EventEmitter();
    constructor() {
        // Allow many topics without MaxListenersExceededWarning
        this._emitter.setMaxListeners(0);
    }
    async publish(topic, envelope) {
        this._emitter.emit(topic, envelope);
    }
    subscribe(topic, handler) {
        const listener = async (env) => {
            try {
                await handler(env);
            }
            catch (err) {
                // Propagate to EventEmitter 'error' channel so the bus doesn't silently swallow it
                this._emitter.emit('error', err);
            }
        };
        this._emitter.on(topic, listener);
        return () => {
            this._emitter.off(topic, listener);
        };
    }
}
// ── EventBus ──────────────────────────────────────────────────────────────────
export class EventBus {
    _transport;
    constructor(transport) {
        this._transport = transport ?? new InProcessTransport();
    }
    /**
     * Wrap `payload` in an `EventEnvelope` and publish it to the given topic.
     */
    async publish(topic, payload) {
        const envelope = {
            id: randomBytes(16).toString('hex'),
            topic,
            timestamp: new Date().toISOString(),
            version: 1,
            payload,
        };
        await this._transport.publish(topic, envelope);
    }
    /**
     * Subscribe to a topic. Returns an unsubscribe function.
     */
    subscribe(topic, handler) {
        return this._transport.subscribe(topic, handler);
    }
}
//# sourceMappingURL=event-bus.js.map