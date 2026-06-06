import { type RedisClientOptions } from '../../transports/resp.js';
import type { EventBusTransport, EventEnvelope } from '../event-bus.js';
export declare class RedisEventBusTransport implements EventBusTransport {
    private readonly pub;
    private readonly opts;
    private connected;
    constructor(opts?: RedisClientOptions);
    private _ensure;
    publish(topic: string, envelope: EventEnvelope): Promise<void>;
    subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): () => void;
    close(): void;
}
//# sourceMappingURL=redis.d.ts.map