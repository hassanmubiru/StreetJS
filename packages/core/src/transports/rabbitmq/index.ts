// src/transports/rabbitmq/index.ts
// Production RabbitMQ transport (AMQP 0-9-1) for the Street EventBus:
// connection management with reconnect, a confirming publisher, an
// acknowledging consumer with DLQ + retry support, and an EventBus adapter.

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

// ── Connection manager (reconnect) ────────────────────────────────────────────

export class RabbitMqConnectionManager {
  private conn: AmqpConnection | null = null;
  private connectPromise: Promise<AmqpConnection> | null = null;
  private closed = false;
  private attempts = 0;
  private readonly onReady: Array<(c: AmqpConnection) => void> = [];

  constructor(private readonly opts: RabbitMqOptions = {}) {}

  /** Get a live connection, (re)connecting with exponential backoff as needed. */
  async get(): Promise<AmqpConnection> {
    if (this.conn?.connected) return this.conn;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this._connectWithRetry();
    return this.connectPromise;
  }

  private async _connectWithRetry(): Promise<AmqpConnection> {
    const base = this.opts.reconnectBaseMs ?? 500;
    const max = this.opts.reconnectMaxMs ?? 30_000;
    for (;;) {
      if (this.closed) throw new Error('RabbitMqConnectionManager is closed');
      try {
        const conn = new AmqpConnection(this.opts);
        conn.on('disconnect', () => this._onDisconnect());
        conn.on('error', () => { /* surfaced via disconnect/close */ });
        await conn.connect();
        this.conn = conn;
        this.attempts = 0;
        this.connectPromise = null;
        for (const cb of this.onReady.splice(0)) cb(conn);
        return conn;
      } catch {
        const delay = Math.min(base * Math.pow(2, this.attempts++), max);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private _onDisconnect(): void {
    this.conn = null;
    this.connectPromise = null;
    if (!this.closed) {
      // Eagerly begin reconnecting so consumers resume.
      void this.get().catch(() => undefined);
    }
  }

  /** Register a callback invoked whenever a fresh connection becomes ready. */
  onReconnect(cb: (c: AmqpConnection) => void): void {
    this.onReady.push(cb);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.conn) await this.conn.close();
    this.conn = null;
  }
}
