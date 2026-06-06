import { AmqpConnection, type AmqpConnectionOptions, type DeliveredMessage } from './connection.js';
import type { EventBusTransport, EventEnvelope } from '../../microservices/event-bus.js';
export { AmqpConnection } from './connection.js';
export type { AmqpConnectionOptions, DeliveredMessage } from './connection.js';
export interface RabbitMqOptions extends AmqpConnectionOptions {
    /** Topic exchange used for event routing. Default 'street.events'. */
    exchange?: string;
    /** Reconnect backoff base in ms. Default 500. */
    reconnectBaseMs?: number;
    /** Max reconnect backoff in ms. Default 30_000. */
    reconnectMaxMs?: number;
    /** Consumer prefetch. Default 50. */
    prefetch?: number;
}
export declare class RabbitMqConnectionManager {
    private readonly opts;
    private conn;
    private connectPromise;
    private closed;
    private attempts;
    private readonly onReady;
    constructor(opts?: RabbitMqOptions);
    /** Get a live connection, (re)connecting with exponential backoff as needed. */
    get(): Promise<AmqpConnection>;
    private _connectWithRetry;
    private _onDisconnect;
    /** Register a callback invoked whenever a fresh connection becomes ready. */
    onReconnect(cb: (c: AmqpConnection) => void): void;
    close(): Promise<void>;
}
export declare class RabbitMqPublisher {
    private readonly manager;
    private readonly exchange;
    private exchangeReady;
    constructor(manager: RabbitMqConnectionManager, exchange: string);
    /** Publish a message to `routingKey` on the topic exchange, awaiting confirm. */
    publish(routingKey: string, body: Buffer | string, opts?: {
        persistent?: boolean;
        contentType?: string;
    }): Promise<void>;
}
export interface ConsumerOptions {
    queue: string;
    routingKeys: string[];
    /** Dead-letter exchange for messages that exhaust retries. */
    deadLetterExchange?: string;
    prefetch?: number;
}
export declare class RabbitMqConsumer {
    private readonly manager;
    private readonly exchange;
    private readonly options;
    private consuming;
    constructor(manager: RabbitMqConnectionManager, exchange: string, options: ConsumerOptions);
    /**
     * Begin consuming. The handler is awaited; success → ack, throw → nack.
     * When `deadLetterExchange` is set, a failed message is nacked without
     * requeue so the broker routes it to the DLX.
     */
    consume(handler: (msg: DeliveredMessage) => Promise<void>): Promise<void>;
}
/**
 * RabbitMQ-backed EventBusTransport. Topics map to routing keys on a shared
 * durable topic exchange; each subscription gets its own durable queue.
 */
export declare class RabbitMqTransport implements EventBusTransport {
    private readonly manager;
    private readonly exchange;
    private readonly publisher;
    constructor(opts?: RabbitMqOptions);
    publish(topic: string, envelope: EventEnvelope): Promise<void>;
    subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): () => void;
    close(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map