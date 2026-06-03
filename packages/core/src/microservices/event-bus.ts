// src/microservices/event-bus.ts
// In-process and pluggable event bus with envelope wrapping.

import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EventEnvelope {
  id: string;
  topic: string;
  timestamp: string;
  version: number;
  payload: unknown;
}

export interface EventBusTransport {
  publish(topic: string, envelope: EventEnvelope): Promise<void>;
  subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): () => void;
}

// ── InProcessTransport ─────────────────────────────────────────────────────────

export class InProcessTransport implements EventBusTransport {
  private readonly _emitter = new EventEmitter();

  constructor() {
    // Allow many topics without MaxListenersExceededWarning
    this._emitter.setMaxListeners(0);
  }

  async publish(topic: string, envelope: EventEnvelope): Promise<void> {
    this._emitter.emit(topic, envelope);
  }

  subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): () => void {
    const listener = async (env: EventEnvelope): Promise<void> => {
      try {
        await handler(env);
      } catch (err) {
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
  private readonly _transport: EventBusTransport;

  constructor(transport?: EventBusTransport) {
    this._transport = transport ?? new InProcessTransport();
  }

  /**
   * Wrap `payload` in an `EventEnvelope` and publish it to the given topic.
   */
  async publish(topic: string, payload: unknown): Promise<void> {
    const envelope: EventEnvelope = {
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
  subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): () => void {
    return this._transport.subscribe(topic, handler);
  }
}
