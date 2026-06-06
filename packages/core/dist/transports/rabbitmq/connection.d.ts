import { EventEmitter } from 'node:events';
export interface AmqpConnectionOptions {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    vhost?: string;
    heartbeatSeconds?: number;
    connectTimeoutMs?: number;
}
export interface DeliveredMessage {
    deliveryTag: bigint;
    redelivered: boolean;
    exchange: string;
    routingKey: string;
    body: Buffer;
}
export declare class AmqpConnection extends EventEmitter {
    private socket;
    private readonly decoder;
    private readonly opts;
    private heartbeatTimer;
    private closing;
    private readonly waiters;
    private nextPublishTag;
    private readonly confirmWaiters;
    private confirmEnabled;
    private pendingDelivery;
    private readonly consumers;
    constructor(opts?: AmqpConnectionOptions);
    private _key;
    private _send;
    private _rpc;
    /** Open the TCP socket, perform the AMQP handshake, and open a channel. */
    connect(): Promise<void>;
    private _onData;
    private _handleFrame;
    private _sendStartOk;
    private _sendTuneOkAndOpen;
    private _afterConnectionOpen;
    private _startHeartbeat;
    private _handleServerClose;
    private _onClose;
    /** Declare an exchange. Types: 'direct' | 'fanout' | 'topic'. */
    declareExchange(name: string, type: 'direct' | 'fanout' | 'topic', opts?: {
        durable?: boolean;
    }): Promise<void>;
    /** Declare a queue. Returns the queue name (server-generated if empty). */
    declareQueue(name: string, opts?: {
        durable?: boolean;
        deadLetterExchange?: string;
        messageTtlMs?: number;
    }): Promise<string>;
    /** Bind a queue to an exchange with a routing key. */
    bindQueue(queue: string, exchange: string, routingKey: string): Promise<void>;
    /** Enable publisher confirms on the channel. */
    enableConfirms(): Promise<void>;
    /** Set prefetch (QoS) so consumers don't get flooded. */
    setQos(prefetchCount: number): Promise<void>;
    /**
     * Publish a message. When confirms are enabled, the returned promise resolves
     * once the broker acks the publish (or rejects on nack).
     */
    publish(exchange: string, routingKey: string, body: Buffer, opts?: {
        persistent?: boolean;
        contentType?: string;
    }): Promise<void>;
    private _handleConfirm;
    /** Start consuming from a queue. Deliveries are passed to `handler`. */
    consume(queue: string, handler: (msg: DeliveredMessage) => void, opts?: {
        noAck?: boolean;
    }): Promise<string>;
    private _beginDelivery;
    private _handleHeader;
    private _handleBody;
    private _finishDelivery;
    /** Abruptly drop the socket to simulate a network failure (used in tests). */
    simulateDrop(): void;
    /** Acknowledge a delivery. */
    ack(deliveryTag: bigint): void;
    /** Negatively acknowledge a delivery; `requeue` controls redelivery. */
    nack(deliveryTag: bigint, requeue: boolean): void;
    /** Gracefully close the connection. */
    close(): Promise<void>;
    get connected(): boolean;
}
//# sourceMappingURL=connection.d.ts.map