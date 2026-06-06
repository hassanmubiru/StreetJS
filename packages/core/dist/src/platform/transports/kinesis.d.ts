import type { StreamTransport } from '../event-streaming.js';
export interface KinesisOptions {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    pollIntervalMs?: number;
}
export declare class KinesisStreamTransport implements StreamTransport {
    private readonly opts;
    private readonly host;
    constructor(opts: KinesisOptions);
    private _call;
    publish(topic: string, payload: unknown): Promise<void>;
    subscribe(topic: string, _groupId: string, handler: (msg: unknown) => Promise<void>): () => void;
}
//# sourceMappingURL=kinesis.d.ts.map