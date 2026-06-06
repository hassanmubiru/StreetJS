// src/transports/kafka/index.ts
// Production Kafka transport: a batching producer, a consumer with static
// partition assignment + group offset commit, and a StreamTransport adapter.
import { KafkaClient } from './client.js';
export { KafkaClient, KafkaProtocolError } from './client.js';
export { encodeRecordBatch, decodeRecordBatches } from './recordbatch.js';
export class KafkaProducer {
    client;
    batches = new Map(); // topic → pending
    rr = new Map(); // topic → round-robin cursor
    batchSize;
    lingerMs;
    acks;
    idempotent;
    maxRetries;
    retryBackoffMs;
    flushTimer = null;
    closed = false;
    // Idempotent producer state.
    producerId = -1n;
    producerEpoch = -1;
    initPromise = null;
    sequences = new Map(); // `${topic}/${partition}` → next baseSequence
    constructor(client, opts = {}) {
        this.client = client;
        this.batchSize = opts.batchSize ?? 100;
        this.lingerMs = opts.lingerMs ?? 5;
        this.idempotent = opts.idempotent ?? false;
        // Idempotent production requires acks=all.
        this.acks = this.idempotent ? -1 : (opts.acks ?? -1);
        this.maxRetries = opts.maxRetries ?? 3;
        this.retryBackoffMs = opts.retryBackoffMs ?? 200;
    }
    async _ensureProducerId() {
        if (!this.idempotent || this.producerId >= 0n)
            return;
        if (!this.initPromise) {
            this.initPromise = (async () => {
                const { producerId, producerEpoch } = await this.client.initProducerId();
                this.producerId = producerId;
                this.producerEpoch = producerEpoch;
            })();
        }
        await this.initPromise;
    }
    async _partitionCount(topic) {
        const meta = await this.client.metadata([topic]);
        const tm = meta.topics.find((t) => t.name === topic);
        return Math.max(1, tm?.partitions.length ?? 1);
    }
    /** Queue a record; resolves once its batch is acknowledged by the broker. */
    async send(topic, record, partition) {
        if (this.closed)
            throw new Error('KafkaProducer is closed');
        let p = partition;
        if (p === undefined) {
            const count = await this._partitionCount(topic);
            const cur = this.rr.get(topic) ?? 0;
            p = cur % count;
            this.rr.set(topic, cur + 1);
        }
        await new Promise((resolve, reject) => {
            const list = this.batches.get(topic) ?? [];
            list.push({ partition: p, record, resolve, reject });
            this.batches.set(topic, list);
            if (list.length >= this.batchSize) {
                void this._flushTopic(topic);
            }
            else if (!this.flushTimer) {
                this.flushTimer = setTimeout(() => { void this.flush(); }, this.lingerMs);
                this.flushTimer.unref();
            }
        });
    }
    async _flushTopic(topic) {
        const list = this.batches.get(topic);
        if (!list || list.length === 0)
            return;
        this.batches.set(topic, []);
        await this._ensureProducerId();
        // Group by partition so each Produce request targets one partition.
        const byPartition = new Map();
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
                if (this.idempotent)
                    this.sequences.set(key, baseSequence + prs.length);
                for (const pr of prs)
                    pr.resolve();
            }
            catch (err) {
                for (const pr of prs)
                    pr.reject(err);
            }
        }
    }
    async _produceWithRetry(topic, partition, records, baseSequence) {
        let attempt = 0;
        for (;;) {
            try {
                await this.client.produce(topic, partition, records, {
                    acks: this.acks,
                    ...(this.idempotent ? { producerId: this.producerId, producerEpoch: this.producerEpoch, baseSequence } : {}),
                });
                return;
            }
            catch (err) {
                if (attempt >= this.maxRetries)
                    throw err;
                attempt++;
                await new Promise((r) => setTimeout(r, this.retryBackoffMs * attempt));
            }
        }
    }
    /** Flush all buffered records. */
    async flush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        await Promise.all([...this.batches.keys()].map((t) => this._flushTopic(t)));
    }
    /** Flush remaining records and stop. */
    async close() {
        this.closed = true;
        await this.flush();
    }
}
export class KafkaConsumer {
    client;
    opts;
    running = false;
    offsets = new Map(); // partition → next offset
    constructor(client, opts) {
        this.client = client;
        this.opts = opts;
    }
    async _assignedPartitions() {
        if (this.opts.partitions && this.opts.partitions.length > 0)
            return this.opts.partitions;
        const meta = await this.client.metadata([this.opts.topic]);
        const tm = meta.topics.find((t) => t.name === this.opts.topic);
        return (tm?.partitions ?? []).map((p) => p.partition);
    }
    async _startOffset(partition) {
        const committed = await this.client.fetchOffset(this.opts.groupId, this.opts.topic, partition);
        if (committed >= 0n)
            return committed;
        const ts = (this.opts.fromBeginning ?? true) ? -2n : -1n; // earliest / latest
        return this.client.listOffset(this.opts.topic, partition, ts);
    }
    /** Begin the poll loop. Returns once the consumer is initialised. */
    async run(handler) {
        this.running = true;
        const partitions = await this._assignedPartitions();
        for (const p of partitions)
            this.offsets.set(p, await this._startOffset(p));
        const autoCommit = this.opts.autoCommit ?? true;
        const loop = async () => {
            while (this.running) {
                let anyData = false;
                for (const partition of partitions) {
                    if (!this.running)
                        break;
                    const from = this.offsets.get(partition);
                    try {
                        const { records } = await this.client.fetch(this.opts.topic, partition, from, { maxWaitMs: this.opts.pollWaitMs ?? 1000 });
                        for (const rec of records) {
                            if (!this.running)
                                break;
                            await handler({ topic: this.opts.topic, partition, offset: rec.offset, key: rec.key, value: rec.value });
                            this.offsets.set(partition, rec.offset + 1n);
                            anyData = true;
                        }
                        if (anyData && autoCommit) {
                            await this.client.commitOffset(this.opts.groupId, this.opts.topic, partition, this.offsets.get(partition));
                        }
                    }
                    catch {
                        // transient fetch error; brief pause then retry
                        await new Promise((r) => setTimeout(r, 200));
                    }
                }
                if (!anyData)
                    await new Promise((r) => setTimeout(r, 50));
            }
        };
        void loop();
    }
    /** Manually commit the current next-offset for a partition. */
    async commit(partition) {
        const off = this.offsets.get(partition);
        if (off !== undefined)
            await this.client.commitOffset(this.opts.groupId, this.opts.topic, partition, off);
    }
    /** Graceful shutdown: stop polling. */
    async stop() {
        this.running = false;
        await new Promise((r) => setTimeout(r, 60));
    }
}
// ── StreamTransport adapter ───────────────────────────────────────────────────
export class KafkaStreamTransport {
    client;
    producer;
    consumers = [];
    constructor(opts = {}) {
        this.client = new KafkaClient(opts);
        this.producer = new KafkaProducer(this.client);
    }
    async publish(topic, payload) {
        await this.producer.send(topic, { key: null, value: Buffer.from(JSON.stringify(payload), 'utf8') });
        await this.producer.flush();
    }
    subscribe(topic, groupId, handler) {
        const consumer = new KafkaConsumer(this.client, { groupId, topic });
        this.consumers.push(consumer);
        void consumer.run(async (msg) => {
            if (!msg.value)
                return;
            await handler(JSON.parse(msg.value.toString('utf8')));
        }).catch(() => undefined);
        return () => { void consumer.stop(); };
    }
    async close() {
        for (const c of this.consumers)
            await c.stop();
        await this.producer.close();
        this.client.close();
    }
}
//# sourceMappingURL=index.js.map