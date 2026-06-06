// src/transports/rabbitmq/index.ts
// Production RabbitMQ transport (AMQP 0-9-1) for the Street EventBus:
// connection management with reconnect, a confirming publisher, an
// acknowledging consumer with DLQ + retry support, and an EventBus adapter.
import { AmqpConnection } from './connection.js';
export { AmqpConnection } from './connection.js';
// ── Connection manager (reconnect) ────────────────────────────────────────────
export class RabbitMqConnectionManager {
    opts;
    conn = null;
    connectPromise = null;
    closed = false;
    attempts = 0;
    onReady = [];
    constructor(opts = {}) {
        this.opts = opts;
    }
    /** Get a live connection, (re)connecting with exponential backoff as needed. */
    async get() {
        if (this.conn?.connected)
            return this.conn;
        if (this.connectPromise)
            return this.connectPromise;
        this.connectPromise = this._connectWithRetry();
        return this.connectPromise;
    }
    async _connectWithRetry() {
        const base = this.opts.reconnectBaseMs ?? 500;
        const max = this.opts.reconnectMaxMs ?? 30_000;
        for (;;) {
            if (this.closed)
                throw new Error('RabbitMqConnectionManager is closed');
            try {
                const conn = new AmqpConnection(this.opts);
                conn.on('disconnect', () => this._onDisconnect());
                conn.on('error', () => { });
                await conn.connect();
                this.conn = conn;
                this.attempts = 0;
                this.connectPromise = null;
                for (const cb of this.onReady.splice(0))
                    cb(conn);
                return conn;
            }
            catch {
                const delay = Math.min(base * Math.pow(2, this.attempts++), max);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    _onDisconnect() {
        this.conn = null;
        this.connectPromise = null;
        if (!this.closed) {
            // Eagerly begin reconnecting so consumers resume.
            void this.get().catch(() => undefined);
        }
    }
    /** Register a callback invoked whenever a fresh connection becomes ready. */
    onReconnect(cb) {
        this.onReady.push(cb);
    }
    async close() {
        this.closed = true;
        if (this.conn)
            await this.conn.close();
        this.conn = null;
    }
}
// ── Publisher ─────────────────────────────────────────────────────────────────
export class RabbitMqPublisher {
    manager;
    exchange;
    exchangeReady = false;
    constructor(manager, exchange) {
        this.manager = manager;
        this.exchange = exchange;
    }
    /** Publish a message to `routingKey` on the topic exchange, awaiting confirm. */
    async publish(routingKey, body, opts = {}) {
        const conn = await this.manager.get();
        if (!this.exchangeReady) {
            await conn.declareExchange(this.exchange, 'topic', { durable: true });
            await conn.enableConfirms();
            this.exchangeReady = true;
        }
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
        await conn.publish(this.exchange, routingKey, buf, { persistent: opts.persistent ?? true, contentType: opts.contentType ?? 'application/json' });
    }
}
export class RabbitMqConsumer {
    manager;
    exchange;
    options;
    consuming = false;
    constructor(manager, exchange, options) {
        this.manager = manager;
        this.exchange = exchange;
        this.options = options;
    }
    /**
     * Begin consuming. The handler is awaited; success → ack, throw → nack.
     * When `deadLetterExchange` is set, a failed message is nacked without
     * requeue so the broker routes it to the DLX.
     */
    async consume(handler) {
        const start = async (conn) => {
            await conn.declareExchange(this.exchange, 'topic', { durable: true });
            if (this.options.deadLetterExchange) {
                await conn.declareExchange(this.options.deadLetterExchange, 'fanout', { durable: true });
            }
            await conn.declareQueue(this.options.queue, {
                durable: true,
                ...(this.options.deadLetterExchange ? { deadLetterExchange: this.options.deadLetterExchange } : {}),
            });
            for (const rk of this.options.routingKeys) {
                await conn.bindQueue(this.options.queue, this.exchange, rk);
            }
            await conn.setQos(this.options.prefetch ?? 50);
            await conn.consume(this.options.queue, (msg) => {
                void (async () => {
                    try {
                        await handler(msg);
                        conn.ack(msg.deliveryTag);
                    }
                    catch {
                        // No requeue → routed to DLX if configured, otherwise dropped.
                        conn.nack(msg.deliveryTag, false);
                    }
                })();
            });
        };
        const conn = await this.manager.get();
        await start(conn);
        this.consuming = true;
        // Re-establish the consumer after a reconnect.
        this.manager.onReconnect((c) => { if (this.consuming)
            void start(c).catch(() => undefined); });
    }
}
// ── EventBus adapter ──────────────────────────────────────────────────────────
/**
 * RabbitMQ-backed EventBusTransport. Topics map to routing keys on a shared
 * durable topic exchange; each subscription gets its own durable queue.
 */
export class RabbitMqTransport {
    manager;
    exchange;
    publisher;
    constructor(opts = {}) {
        this.manager = new RabbitMqConnectionManager(opts);
        this.exchange = opts.exchange ?? 'street.events';
        this.publisher = new RabbitMqPublisher(this.manager, this.exchange);
    }
    async publish(topic, envelope) {
        await this.publisher.publish(topic, JSON.stringify(envelope));
    }
    subscribe(topic, handler) {
        const queue = `street.${topic}.${process.pid}`;
        const consumer = new RabbitMqConsumer(this.manager, this.exchange, {
            queue,
            routingKeys: [topic],
            deadLetterExchange: `${this.exchange}.dlx`,
        });
        let stopped = false;
        void consumer.consume(async (msg) => {
            if (stopped)
                return;
            const env = JSON.parse(msg.body.toString('utf8'));
            await handler(env);
        }).catch(() => undefined);
        return () => { stopped = true; };
    }
    async close() {
        await this.manager.close();
    }
}
//# sourceMappingURL=index.js.map