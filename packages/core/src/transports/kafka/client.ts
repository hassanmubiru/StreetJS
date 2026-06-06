// src/transports/kafka/client.ts
// Kafka protocol client: metadata discovery, produce, fetch, list-offsets,
// group-coordinator lookup, and offset commit/fetch. Built on KafkaConnection.

import { KafkaWriter, KafkaReader } from './primitives.js';
import { KafkaConnection, API, type KafkaBroker, type KafkaConnectionOptions } from './connection.js';
import { encodeRecordBatch, decodeRecordBatches, type KafkaRecord } from './recordbatch.js';

export interface PartitionMeta { error: number; partition: number; leader: number; replicas: number[]; isr: number[]; }
export interface TopicMeta { error: number; name: string; partitions: PartitionMeta[]; }
export interface ClusterMeta { brokers: KafkaBroker[]; controllerId: number; topics: TopicMeta[]; }

export interface KafkaClientOptions extends KafkaConnectionOptions {
  /** Comma-separated or array of bootstrap brokers "host:port". */
  brokers?: string[];
}

export class KafkaProtocolError extends Error {
  constructor(public readonly code: number, op: string) {
    super(`Kafka ${op} failed with error code ${code}`);
    this.name = 'KafkaProtocolError';
  }
}

export class KafkaClient {
  private readonly bootstrap: Array<{ host: string; port: number }>;
  private readonly clientId: string;
  private readonly connTimeout: number;
  private readonly connections = new Map<string, KafkaConnection>();
  private meta: ClusterMeta | null = null;

  constructor(opts: KafkaClientOptions = {}) {
    const list = opts.brokers ?? [`${opts.host ?? '127.0.0.1'}:${opts.port ?? 9092}`];
    this.bootstrap = list.map((b) => {
      const [host, port] = b.split(':');
      return { host: host!, port: Number(port ?? 9092) };
    });
    this.clientId = opts.clientId ?? 'street-kafka';
    this.connTimeout = opts.connectTimeoutMs ?? 10_000;
  }

  private async _conn(host: string, port: number): Promise<KafkaConnection> {
    const key = `${host}:${port}`;
    let conn = this.connections.get(key);
    if (conn?.connected) return conn;
    conn = new KafkaConnection({ host, port, clientId: this.clientId, connectTimeoutMs: this.connTimeout });
    await conn.connect();
    this.connections.set(key, conn);
    return conn;
  }

  private async _anyConn(): Promise<KafkaConnection> {
    let lastErr: unknown;
    for (const b of this.bootstrap) {
      try { return await this._conn(b.host, b.port); } catch (e) { lastErr = e; }
    }
    throw lastErr instanceof Error ? lastErr : new Error('No Kafka brokers reachable');
  }

  /** Fetch (and cache) cluster metadata for the given topics. */
  async metadata(topics: string[]): Promise<ClusterMeta> {
    const conn = await this._anyConn();
    const r = await conn.request(API.METADATA, 1, (w) => {
      w.int32(topics.length);
      for (const t of topics) w.string(t);
    });
    const brokers = r.array((rd) => ({ nodeId: rd.int32(), host: rd.string()!, port: rd.int32(), }));
    // each broker also has rack (nullable string) in v1
    // NOTE: array() consumed nodeId/host/port; rack is read here per element is not possible.
    // Re-parse manually to include rack:
    return this._parseMetadata(brokers, r);
  }

  private _parseMetadata(brokers: KafkaBroker[], r: KafkaReader): ClusterMeta {
    // We must read rack for each broker; redo parsing cleanly below instead.
    void brokers;
    throw new Error('unused');
    void r;
  }
}
