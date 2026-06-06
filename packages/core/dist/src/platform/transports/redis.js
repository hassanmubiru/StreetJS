// src/platform/transports/redis.ts
// Redis-backed CacheTransport for DistributedCache (GET/SET EX/DEL + Pub/Sub).
import { RedisClient } from '../../transports/resp.js';
export class RedisCacheTransport {
    client;
    opts;
    ready = null;
    constructor(opts = {}) {
        this.opts = opts;
        this.client = new RedisClient(opts);
    }
    _ensure() {
        if (!this.ready)
            this.ready = this.client.connect();
        return this.ready;
    }
    async get(key) {
        await this._ensure();
        return this.client.get(key);
    }
    async set(key, value, ttlMs) {
        await this._ensure();
        await this.client.set(key, value, ttlMs);
    }
    async delete(key) {
        await this._ensure();
        await this.client.del(key);
    }
    subscribe(channel, handler) {
        let dispose = null;
        let disposed = false;
        void new RedisClient(this.opts).subscribe(channel, handler).then((d) => {
            if (disposed)
                d();
            else
                dispose = d;
        });
        return () => { disposed = true; if (dispose)
            dispose(); };
    }
    async publish(channel, message) {
        await this._ensure();
        await this.client.publish(channel, message);
    }
    close() {
        this.client.close();
    }
}
//# sourceMappingURL=redis.js.map