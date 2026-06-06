// src/transports/kafka/index.ts
// Production Kafka transport: a batching producer, a consumer with static
// partition assignment + group offset commit, and a StreamTransport adapter.

import { KafkaClient, type KafkaClientOptions, type KafkaRecord } from './client.js';
import type { StreamTransport } from '../../platform/event-streaming.js';

export { KafkaClient, KafkaProtocolError } from './client.js';
export type { KafkaClientOptions, ClusterMeta, TopicMeta, PartitionMeta, KafkaRecord } from './client.js';
export { encodeRecordBatch, decodeRecordBatches } from './recordbatch.js';

export interface ProducerOptions { batchSize?: number; lingerMs?: number; acks?: number; }

interface PendingRecord { partition: number; record: KafkaRecord; resolve: () => void; reject: (e: unknown) => void; }

export class KafkaProducer {
  private readonly batches = new Map<string, PendingRecord[]>();   // topic → pending
  private readonly rr = new Map<string, number>();                 // topic → round-robin cursor
  private readonly batchSize: number;
  private readonly lingerMs: number;
  private readonly acks: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly client: KafkaClient, opts: ProducerOptions = {}) {
    this.batchSize = opts.batchSize ?? 100;
    this.lingerMs = opts.lingerMs ?? 5;
    this.acks = opts.acks ?? -1;
  }

  private async _partitionCount(topic: string): Promise<number> {
    const meta = await this.client.metadata([topic]);
    const tm = meta.topics.find((t) => t.name === topic);
    return Math.max(1, tm?.partitions.length ?? 1);
  }

  /** Queue a record; resolves once its batch is acknowledged by the broker. */
  async send(topic: string, record: KafkaRecord, partition?: number): Promise<void> {
    if (this.closed) throw new Error('KafkaProducer is closed');
    let p = partition;
    if (p === undefined) {
      const count = await this._partitionCount(topic);
      const cur = this.rr.get(topic) ?? 0;
      p = cur % count;
      this.rr.set(topic, cur + 1);
    }
    await new Promise<void>((resolve, reject) => {
      const list = this.batches.get(topic) ?? [];
      list.push({ partition: p!, record, resolve, reject });
      this.batches.set(topic, list);
      if (list.length >= this.batchSize) { void this._flushTopic(topic); }
      else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => { void this.flush(); }, this.lingerMs);
        this.flushTimer.unref();
      }
    });
  }

  private async _flushTopic(topic: string): Promise<void> {
    const list = this.batches.get(topic);
    if (!list || list.length === 0) return;
    this.batches.set(topic, []);
    // Group by partition so each Produce request targets one partition.
    const byPartition = new Map<number, PendingRecord[]>();
    for (const pr of list) {
      const arr = byPartition.get(pr.partition) ?? [];
      arr.push(pr);
      byPartition.set(pr.partition, arr);
    }
    for (const [partition, prs] of byPartition) {
      try {
        await this.client.produce(topic, partition, prs.map((x) => x.record), { acks: this.acks });
        for (const pr of prs) pr.resolve();
      } catch (err) {
        for (const pr of prs) pr.reject(err);
      }
    }
  }

  /** Flush all buffered records. */
  async flush(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    await Promise.all([...this.batches.keys()].map((t) => this._flushTopic(t)));
  }

  /** Flush remaining records and stop. */
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}
