import { KafkaWriter, KafkaReader } from './primitives.js';
export interface KafkaBroker {
    nodeId: number;
    host: string;
    port: number;
}
export interface KafkaConnectionOptions {
    host?: string;
    port?: number;
    clientId?: string;
    connectTimeoutMs?: number;
}
export declare const API: {
    readonly PRODUCE: 0;
    readonly FETCH: 1;
    readonly LIST_OFFSETS: 2;
    readonly METADATA: 3;
    readonly OFFSET_COMMIT: 8;
    readonly OFFSET_FETCH: 9;
    readonly FIND_COORDINATOR: 10;
    readonly API_VERSIONS: 18;
};
export declare class KafkaConnection {
    private socket;
    private readonly opts;
    private corr;
    private buf;
    private readonly pending;
    constructor(opts?: KafkaConnectionOptions);
    connect(): Promise<void>;
    private _onData;
    /**
     * Send a request and resolve with the response body (after the correlation
     * id). `buildBody(w)` writes the request-specific fields.
     */
    request(apiKey: number, apiVersion: number, buildBody: (w: KafkaWriter) => void): Promise<KafkaReader>;
    close(): void;
    get connected(): boolean;
}
//# sourceMappingURL=connection.d.ts.map