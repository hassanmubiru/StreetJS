// src/transports/kafka/index.ts
// Production Kafka transport: a batching producer, a consumer with static
// partition assignment + group offset commit, and a StreamTransport adapter.

import { KafkaClient, type KafkaClientOptions, type KafkaRecord } from './client.js';
import type { StreamTransport } from '../../platform/event-streaming.js';

export { KafkaClient, KafkaProtocolError, CoordinatorReadinessGate } from './client.js';
export type {
  KafkaClientOptions, ClusterMeta, TopicMeta, PartitionMeta, KafkaRecord,
  CoordinatorGateResult, CoordinatorReadinessGateOptions,
} from './client.js';
export { encodeRecordBatch, decodeRecordBatches } from './recordbatch.js';
export {
  accountLostMessages, CHAOS_SCENARIOS, SLOW_BROKER_MIN_DELAY_MS,
  FULL_SCALE_COLD_STARTS, FULL_SCALE_RESTART_CYCLES,
} from './chaos-accounting.js';
export type { LostMessageAccount, ChaosScenario } from './chaos-accounting.js';

export interface ProducerOptions { batchSize?: number; lingerMs?: number; acks?: number; idempotent?: boolean; maxRetries?: number; retryBackoffMs?: number; }

interface PendingRecord { partition: number; record: KafkaRecord; resolve: () => void; reject: (e: unknown) => void; }

export class KafkaProducer {
  private readonly batches = new Map<string, PendingRecord[]>();   // topic → pending
  private readonly rr = new Map<string, number>();                 // topic → round-robin cursor
  private readonly batchSize: number;
  private readonly lingerMs: number;
  private readonly acks: number;
  private readonly idempotent: boolean;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;
  // Idempotent producer state.
  private producerId = -1n;
  private producerEpoch = -1;
  private initPromise: Promise<void> | null = null;
  private readonly sequences = new Map<string, number>();          // `${topic}/${partition}` → next baseSequence

  constructor(private readonly client: KafkaClient, opts: ProducerOptions = {}) {
    this.batchSize = opts.batchSize ?? 100;
    this.lingerMs = opts.lingerMs ?? 5;
    this.idempotent = opts.idempotent ?? false;
    // Idempotent production requires acks=all.
    this.acks = this.idempotent ? -1 : (opts.acks ?? -1);
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBackoffMs = opts.retryBackoffMs ?? 200;
  }

  private async _ensureProducerId(): Promise<void> {
    if (!this.idempotent || this.producerId >= 0n) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const { producerId, producerEpoch } = await this.client.initProducerId();
        this.producerId = producerId;
        this.producerEpoch = producerEpoch;
      })();
    }
    await this.initPromise;
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
    await this._ensureProducerId();
    // Group by partition so each Produce request targets one partition.
    const byPartition = new Map<number, PendingRecord[]>();
    for (const pr of list) {
      const arr = byPartition.get(pr.partition) ?? [];
      arr.push(pr);
      byPartition.set(pr.partition, arr);
    }
    for (const [partition, prs] of byPartition) {
      const key = `${topic}/${partition}`;
      const baseSequence = this.idempotent ? (this.sequences.get(key) ?? 0) : -1;
      try {
        await this._produceWithRetry(topic, partition, prs.map((x) => x.record), baseSequence);
        if (this.idempotent) this.sequences.set(key, baseSequence + prs.length);
        for (const pr of prs) pr.resolve();
      } catch (err) {
        for (const pr of prs) pr.reject(err);
      }
    }
  }

  private async _produceWithRetry(topic: string, partition: number, records: KafkaRecord[], baseSequence: number): Promise<void> {
    let attempt = 0;
    for (;;) {
      try {
        await this.client.produce(topic, partition, records, {
          acks: this.acks,
          ...(this.idempotent ? { producerId: this.producerId, producerEpoch: this.producerEpoch, baseSequence } : {}),
        });
        return;
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        attempt++;
        await new Promise((r) => setTimeout(r, this.retryBackoffMs * attempt));
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

// ── Consumer ──────────────────────────────────────────────────────────────────

export interface ConsumerOptions {
  groupId: string;
  topic: string;
  /** Explicit partition assignment. When omitted, all partitions are assigned. */
  partitions?: number[];
  /** Start at the earliest offset when no committed offset exists. Default true. */
  fromBeginning?: boolean;
  /** Poll wait time per fetch. Default 1000ms. */
  pollWaitMs?: number;
  /** Commit committed offset after each processed batch. Default true. */
  autoCommit?: boolean;
}

export interface ConsumedMessage {
  topic: string;
  partition: number;
  offset: bigint;
  key: Buffer | null;
  value: Buffer | null;
}

export class KafkaConsumer {
  private running = false;
  private readonly offsets = new Map<number, bigint>(); // partition → next offset

  constructor(private readonly client: KafkaClient, private readonly opts: ConsumerOptions) {}

  private async _assignedPartitions(): Promise<number[]> {
    if (this.opts.partitions && this.opts.partitions.length > 0) return this.opts.partitions;
    const meta = await this.client.metadata([this.opts.topic]);
    const tm = meta.topics.find((t) => t.name === this.opts.topic);
    return (tm?.partitions ?? []).map((p) => p.partition);
  }

  private async _startOffset(partition: number): Promise<bigint> {
    const committed = await this.client.fetchOffset(this.opts.groupId, this.opts.topic, partition);
    if (committed >= 0n) return committed;
    const ts = (this.opts.fromBeginning ?? true) ? -2n : -1n; // earliest / latest
    return this.client.listOffset(this.opts.topic, partition, ts);
  }

  /** Begin the poll loop. Returns once the consumer is initialised. */
  async run(handler: (msg: ConsumedMessage) => Promise<void>): Promise<void> {
    this.running = true;
    const partitions = await this._assignedPartitions();
    for (const p of partitions) this.offsets.set(p, await this._startOffset(p));

    const autoCommit = this.opts.autoCommit ?? true;
    const loop = async (): Promise<void> => {
      while (this.running) {
        let anyData = false;
        for (const partition of partitions) {
          if (!this.running) break;
          const from = this.offsets.get(partition)!;
          try {
            const { records } = await this.client.fetch(this.opts.topic, partition, from, { maxWaitMs: this.opts.pollWaitMs ?? 1000 });
            for (const rec of records) {
              if (!this.running) break;
              await handler({ topic: this.opts.topic, partition, offset: rec.offset!, key: rec.key, value: rec.value });
              this.offsets.set(partition, rec.offset! + 1n);
              anyData = true;
            }
            if (anyData && autoCommit) {
              await this.client.commitOffset(this.opts.groupId, this.opts.topic, partition, this.offsets.get(partition)!);
            }
          } catch {
            // transient fetch error; brief pause then retry
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        if (!anyData) await new Promise((r) => setTimeout(r, 50));
      }
    };
    void loop();
  }

  /** Manually commit the current next-offset for a partition. */
  async commit(partition: number): Promise<void> {
    const off = this.offsets.get(partition);
    if (off !== undefined) await this.client.commitOffset(this.opts.groupId, this.opts.topic, partition, off);
  }

  /** Graceful shutdown: stop polling. */
  async stop(): Promise<void> {
    this.running = false;
    await new Promise((r) => setTimeout(r, 60));
  }
}

// ── StreamTransport adapter ───────────────────────────────────────────────────

export class KafkaStreamTransport implements StreamTransport {
  private readonly client: KafkaClient;
  private readonly producer: KafkaProducer;
  private readonly consumers: KafkaConsumer[] = [];

  constructor(opts: KafkaClientOptions = {}) {
    this.client = new KafkaClient(opts);
    this.producer = new KafkaProducer(this.client);
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    await this.producer.send(topic, { key: null, value: Buffer.from(JSON.stringify(payload), 'utf8') });
    await this.producer.flush();
  }

  subscribe(topic: string, groupId: string, handler: (msg: unknown) => Promise<void>): () => void {
    const consumer = new KafkaConsumer(this.client, { groupId, topic });
    this.consumers.push(consumer);
    void consumer.run(async (msg) => {
      if (!msg.value) return;
      await handler(JSON.parse(msg.value.toString('utf8')));
    }).catch(() => undefined);
    return () => { void consumer.stop(); };
  }

  async close(): Promise<void> {
    for (const c of this.consumers) await c.stop();
    await this.producer.close();
    this.client.close();
  }
}
