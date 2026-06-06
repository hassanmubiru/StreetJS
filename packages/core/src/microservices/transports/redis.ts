// src/microservices/transports/redis.ts
// Redis Pub/Sub transport for the EventBus, built on the zero-dep RESP client.

import { RedisClient, type RedisClientOptions } from '../../transports/resp.js';
import type { EventBusTransport, EventEnvelope } from '../event-bus.js';

export class RedisEventBusTransport implements EventBusTransport {
  private readonly pub: RedisClient;
  private readonly opts: RedisClientOptions;
  private connected = false;

  constructor(opts: RedisClientOptions = {}) {
    this.opts = opts;
    this.pub = new RedisClient(opts);
  }

  private async _ensure(): Promise<void> {
    if (!this.connected) {
      await this.pub.connect();
      this.connected = true;
    }
  }

  async publish(topic: string, envelope: EventEnvelope): Promise<void> {
    await this._ensure();
    await this.pub.publish(topic, JSON.stringify(envelope));
  }

  subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): () => void {
    let dispose: (() => void) | null = null;
    let disposed = false;

    // A dedicated subscription connection is opened asynchronously.
    void new RedisClient(this.opts)
      .subscribe(topic, (message) => {
        try {
          const env = JSON.parse(message) as EventEnvelope;
          void handler(env);
        } catch {
          // Ignore malformed messages — at-least-once delivery semantics.
        }
      })
      .then((d) => {
        if (disposed) d();
        else dispose = d;
      });

    return () => {
      disposed = true;
      if (dispose) dispose();
    };
  }

  close(): void {
    this.pub.close();
  }
}
