// src/platform/transports/redis.ts
// Redis-backed CacheTransport for DistributedCache (GET/SET EX/DEL + Pub/Sub).

import { RedisClient, type RedisClientOptions } from '../../transports/resp.js';
import type { CacheTransport } from '../distributed-cache.js';

export class RedisCacheTransport implements CacheTransport {
  private readonly client: RedisClient;
  private readonly opts: RedisClientOptions;
  private ready: Promise<void> | null = null;

  constructor(opts: RedisClientOptions = {}) {
    this.opts = opts;
    this.client = new RedisClient(opts);
  }

  private _ensure(): Promise<void> {
    if (!this.ready) this.ready = this.client.connect();
    return this.ready;
  }

  async get(key: string): Promise<string | null> {
    await this._ensure();
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    await this._ensure();
    await this.client.set(key, value, ttlMs);
  }

  async delete(key: string): Promise<void> {
    await this._ensure();
    await this.client.del(key);
  }

  subscribe(channel: string, handler: (msg: string) => void): () => void {
    let dispose: (() => void) | null = null;
    let disposed = false;
    void new RedisClient(this.opts).subscribe(channel, handler).then((d) => {
      if (disposed) d(); else dispose = d;
    });
    return () => { disposed = true; if (dispose) dispose(); };
  }

  async publish(channel: string, message: string): Promise<void> {
    await this._ensure();
    await this.client.publish(channel, message);
  }

  close(): void {
    this.client.close();
  }
}
