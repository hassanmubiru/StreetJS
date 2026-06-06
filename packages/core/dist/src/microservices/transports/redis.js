// src/microservices/transports/redis.ts
// Redis Pub/Sub transport for the EventBus, built on the zero-dep RESP client.
import { RedisClient } from '../../transports/resp.js';
export class RedisEventBusTransport {
    pub;
    opts;
    connected = false;
    constructor(opts = {}) {
        this.opts = opts;
        this.pub = new RedisClient(opts);
    }
    async _ensure() {
        if (!this.connected) {
            await this.pub.connect();
            this.connected = true;
        }
    }
    async publish(topic, envelope) {
        await this._ensure();
        await this.pub.publish(topic, JSON.stringify(envelope));
    }
    subscribe(topic, handler) {
        let dispose = null;
        let disposed = false;
        // A dedicated subscription connection is opened asynchronously.
        void new RedisClient(this.opts)
            .subscribe(topic, (message) => {
            try {
                const env = JSON.parse(message);
                void handler(env);
            }
            catch {
                // Ignore malformed messages — at-least-once delivery semantics.
            }
        })
            .then((d) => {
            if (disposed)
                d();
            else
                dispose = d;
        });
        return () => {
            disposed = true;
            if (dispose)
                dispose();
        };
    }
    close() {
        this.pub.close();
    }
}
//# sourceMappingURL=redis.js.map