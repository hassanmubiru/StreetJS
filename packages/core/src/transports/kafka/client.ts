// src/transports/kafka/client.ts
// Kafka protocol client: metadata discovery, produce, fetch, list-offsets,
// group-coordinator lookup, and offset commit/fetch. Built on KafkaConnection.

import type { KafkaWriter } from './primitives.js';
import { KafkaConnection, API, type KafkaBroker, type KafkaConnectionOptions } from './connection.js';
import { encodeRecordBatch, decodeRecordBatches, type KafkaRecord } from './recordbatch.js';

export interface PartitionMeta { error: number; partition: number; leader: number; replicas: number[]; isr: number[]; }
export interface TopicMeta { error: number; name: string; partitions: PartitionMeta[]; }
export interface ClusterMeta { brokers: KafkaBroker[]; controllerId: number; topics: TopicMeta[]; }

export interface KafkaClientOptions extends KafkaConnectionOptions {
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
  private readonly tlsOpts: Pick<KafkaConnectionOptions, 'tls' | 'tlsRejectUnauthorized' | 'tlsServerName' | 'tlsCa'>;
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
    this.tlsOpts = {
      ...(opts.tls !== undefined ? { tls: opts.tls } : {}),
      ...(opts.tlsRejectUnauthorized !== undefined ? { tlsRejectUnauthorized: opts.tlsRejectUnauthorized } : {}),
      ...(opts.tlsServerName !== undefined ? { tlsServerName: opts.tlsServerName } : {}),
      ...(opts.tlsCa !== undefined ? { tlsCa: opts.tlsCa } : {}),
    };
  }

  private async _conn(host: string, port: number): Promise<KafkaConnection> {
    const key = `${host}:${port}`;
    let conn = this.connections.get(key);
    if (conn?.connected) return conn;
    conn = new KafkaConnection({ host, port, clientId: this.clientId, connectTimeoutMs: this.connTimeout, ...this.tlsOpts });
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

  /** Metadata v1: brokers (with rack), controller id, topics with partitions. */
  async metadata(topics: string[]): Promise<ClusterMeta> {
    const conn = await this._anyConn();
    const r = await conn.request(API.METADATA, 1, (w: KafkaWriter) => {
      w.int32(topics.length);
      for (const t of topics) w.string(t);
    });
    const brokerCount = r.int32();
    const brokers: KafkaBroker[] = [];
    for (let i = 0; i < brokerCount; i++) {
      const nodeId = r.int32(); const host = r.string()!; const port = r.int32();
      r.string(); // rack (nullable)
      brokers.push({ nodeId, host, port });
    }
    const controllerId = r.int32();
    const topicCount = r.int32();
    const tmeta: TopicMeta[] = [];
    for (let i = 0; i < topicCount; i++) {
      const error = r.int16(); const name = r.string()!; r.int8(); // is_internal
      const pCount = r.int32();
      const partitions: PartitionMeta[] = [];
      for (let p = 0; p < pCount; p++) {
        const perr = r.int16(); const partition = r.int32(); const leader = r.int32();
        const replicas = r.array((rd) => rd.int32());
        const isr = r.array((rd) => rd.int32());
        partitions.push({ error: perr, partition, leader, replicas, isr });
      }
      tmeta.push({ error, name, partitions });
    }
    this.meta = { brokers, controllerId, topics: tmeta };
    return this.meta;
  }

  private _brokerById(nodeId: number): KafkaBroker {
    const b = this.meta?.brokers.find((x) => x.nodeId === nodeId);
    if (!b) throw new Error(`Kafka broker ${nodeId} not found in metadata`);
    return b;
  }

  /** Resolve the leader broker for a topic-partition. */
  async leaderFor(topic: string, partition: number): Promise<KafkaBroker> {
    if (!this.meta) await this.metadata([topic]);
    let tm = this.meta!.topics.find((t) => t.name === topic);
    if (!tm) { await this.metadata([topic]); tm = this.meta!.topics.find((t) => t.name === topic); }
    let pm = tm?.partitions.find((p) => p.partition === partition);
    // Cold-start hardening: right after broker startup / topic creation a
    // partition can briefly have no elected leader (leader < 0) or a transient
    // error. Refresh metadata with short backoff before giving up.
    for (let attempt = 0; (pm === undefined || pm.leader < 0 || pm.error !== 0) && attempt < 25; attempt++) {
      await new Promise((r) => setTimeout(r, 200));
      await this.metadata([topic]);
      tm = this.meta!.topics.find((t) => t.name === topic);
      pm = tm?.partitions.find((p) => p.partition === partition);
    }
    if (!pm || pm.leader < 0) throw new Error(`No leader for ${topic}-${partition}`);
    return this._brokerById(pm.leader);
  }

  /**
   * Wait until a topic is fully ready to produce/consume: it exists with at
   * least `minPartitions`, and EVERY partition has a healthy state (error 0,
   * an elected leader >= 0, and a non-empty in-sync replica set). This closes
   * the cold-start race where `metadata()` returns a topic whose partitions
   * have no leader yet (LEADER_NOT_AVAILABLE), causing transient produce
   * failures. Polls with backoff until ready or `timeoutMs` elapses.
   */
  async awaitTopicReady(topic: string, minPartitions = 1, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const meta = await this.metadata([topic]);
      const tm = meta.topics.find((t) => t.name === topic);
      const ready = tm !== undefined
        && tm.error === 0
        && tm.partitions.length >= minPartitions
        && tm.partitions.every((p) => p.error === 0 && p.leader >= 0 && p.isr.length >= 1);
      if (ready) return;
      if (Date.now() > deadline) {
        throw new Error(`Kafka topic "${topic}" not ready within ${timeoutMs}ms (no elected leader on all partitions)`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Allocate a producer id + epoch for the idempotent producer (InitProducerId v0). */
  async initProducerId(): Promise<{ producerId: bigint; producerEpoch: number }> {
    // Cold-start hardening: the transaction coordinator (__transaction_state)
    // may report COORDINATOR_LOAD_IN_PROGRESS / NOT_AVAILABLE right after broker
    // boot; retry transiently rather than failing the producer.
    return this._withCoordinatorRetry(async () => {
      const conn = await this._anyConn();
      const r = await conn.request(API.INIT_PRODUCER_ID, 0, (w: KafkaWriter) => {
        w.string(null);        // transactional_id (non-transactional)
        w.int32(60_000);       // transaction_timeout_ms
      });
      r.int32(); // throttle_time_ms
      const err = r.int16();
      if (err !== 0) throw new KafkaProtocolError(err, 'initProducerId');
      const producerId = r.int64();
      const producerEpoch = r.int16();
      return { producerId, producerEpoch };
    });
  }

  /** Produce records to a topic-partition (acks=all). Returns base offset.
   *  When idempotent fields are supplied, the RecordBatch carries the producer
   *  id/epoch/sequence so the broker can de-duplicate retries. */
  async produce(
    topic: string,
    partition: number,
    records: KafkaRecord[],
    opts: { acks?: number; timeoutMs?: number; producerId?: bigint; producerEpoch?: number; baseSequence?: number } = {},
  ): Promise<bigint> {
    const leader = await this.leaderFor(topic, partition);
    const conn = await this._conn(leader.host, leader.port);
    const batch = encodeRecordBatch(records, {
      producerId: opts.producerId,
      producerEpoch: opts.producerEpoch,
      baseSequence: opts.baseSequence,
    });
    const r = await conn.request(API.PRODUCE, 3, (w: KafkaWriter) => {
      w.string(null);                  // transactional_id
      w.int16(opts.acks ?? -1);        // acks (-1 = all)
      w.int32(opts.timeoutMs ?? 30_000);
      w.int32(1);                      // topic count
      w.string(topic);
      w.int32(1);                      // partition count
      w.int32(partition);
      w.bytes(batch);                  // records
    });
    // Produce Response v3: [responses(name,[partitions(index,error_code,base_offset,log_append_time_ms)])] throttle_time_ms
    const topicCount = r.int32();
    let baseOffset = -1n;
    let perr = 0;
    for (let i = 0; i < topicCount; i++) {
      r.string(); // name
      const pCount = r.int32();
      for (let p = 0; p < pCount; p++) {
        r.int32(); // index
        const err = r.int16();
        const bo = r.int64();
        r.int64(); // log_append_time_ms
        if (err !== 0) perr = err;
        baseOffset = bo;
      }
    }
    r.int32(); // throttle_time_ms (end of response in v1+)
    if (perr !== 0) throw new KafkaProtocolError(perr, 'produce');
    return baseOffset;
  }

  /** Fetch records from a topic-partition starting at `fetchOffset`. */
  async fetch(topic: string, partition: number, fetchOffset: bigint, opts: { maxWaitMs?: number; maxBytes?: number } = {}): Promise<{ records: KafkaRecord[]; highWatermark: bigint }> {
    const leader = await this.leaderFor(topic, partition);
    const conn = await this._conn(leader.host, leader.port);
    const maxBytes = opts.maxBytes ?? 1_048_576;
    const r = await conn.request(API.FETCH, 4, (w: KafkaWriter) => {
      w.int32(-1);                     // replica_id
      w.int32(opts.maxWaitMs ?? 1000); // max_wait_ms
      w.int32(1);                      // min_bytes
      w.int32(maxBytes);               // max_bytes
      w.int8(0);                       // isolation_level (read_uncommitted)
      w.int32(1);                      // topic count
      w.string(topic);
      w.int32(1);                      // partition count
      w.int32(partition);
      w.int64(fetchOffset);            // fetch_offset
      w.int32(maxBytes);               // partition_max_bytes
    });
    r.int32(); // throttle_time_ms
    const topicCount = r.int32();
    let records: KafkaRecord[] = [];
    let highWatermark = 0n;
    for (let i = 0; i < topicCount; i++) {
      r.string(); // topic
      const pCount = r.int32();
      for (let p = 0; p < pCount; p++) {
        r.int32(); // partition
        const err = r.int16();
        highWatermark = r.int64();
        r.int64(); // last_stable_offset
        const abortedCount = r.int32();
        for (let a = 0; a < Math.max(0, abortedCount); a++) { r.int64(); r.int64(); }
        const recordSet = r.bytes();
        if (err !== 0) throw new KafkaProtocolError(err, 'fetch');
        if (recordSet && recordSet.length > 0) {
          records = records.concat(decodeRecordBatches(recordSet).filter((rec) => (rec.offset ?? 0n) >= fetchOffset));
        }
      }
    }
    return { records, highWatermark };
  }

  /**
   * List offsets: timestamp -1 = latest (end), -2 = earliest (start).
   *
   * Retries on transient partition-leadership errors (5 LEADER_NOT_AVAILABLE,
   * 6 NOT_LEADER_FOR_PARTITION, 9 REPLICA_NOT_AVAILABLE) — which occur right
   * after topic creation or a leader change, before metadata has settled — by
   * forcing a metadata refresh (so `leaderFor` re-resolves the current leader)
   * and backing off. Mirrors the coordinator-retry hardening used for
   * OFFSET_COMMIT/OFFSET_FETCH. Without this, a fresh-topic `listOffset` can
   * throw NOT_LEADER_FOR_PARTITION transiently.
   */
  async listOffset(topic: string, partition: number, timestamp: bigint): Promise<bigint> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const leader = await this.leaderFor(topic, partition);
        const conn = await this._conn(leader.host, leader.port);
        const r = await conn.request(API.LIST_OFFSETS, 1, (w: KafkaWriter) => {
          w.int32(-1);     // replica_id
          w.int32(1);      // topic count
          w.string(topic);
          w.int32(1);      // partition count
          w.int32(partition);
          w.int64(timestamp);
        });
        const topicCount = r.int32();
        let offset = -1n;
        for (let i = 0; i < topicCount; i++) {
          r.string();
          const pCount = r.int32();
          for (let p = 0; p < pCount; p++) {
            r.int32(); const err = r.int16(); r.int64(); const off = r.int64();
            if (err !== 0) throw new KafkaProtocolError(err, 'listOffsets');
            offset = off;
          }
        }
        return offset;
      } catch (e) {
        lastErr = e;
        const code = e instanceof KafkaProtocolError ? e.code : undefined;
        if (code !== undefined && KafkaClient.TRANSIENT_LEADER_ERRORS.has(code)) {
          // Force a metadata refresh so leaderFor re-resolves the new leader.
          await this.metadata([topic]).catch(() => { /* refreshed best-effort */ });
          await new Promise((res) => setTimeout(res, Math.min(200 * (attempt + 1), 1500)));
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new KafkaProtocolError(6, 'listOffsets');
  }

  /** Transient partition-leadership errors that should be retried with a
   *  metadata refresh (leader not yet elected / moved). */
  private static readonly TRANSIENT_LEADER_ERRORS = new Set<number>([5, 6, 9]);

  /** Find the group coordinator broker for a consumer group. Retries on
   *  transient coordinator errors (14 LOAD_IN_PROGRESS, 15 NOT_AVAILABLE,
   *  16 NOT_COORDINATOR) while the internal __consumer_offsets topic initialises
   *  and a coordinator is elected (cold-start hardening). */
  async findCoordinator(groupId: string): Promise<KafkaBroker> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 12; attempt++) {
      const conn = await this._anyConn();
      const r = await conn.request(API.FIND_COORDINATOR, 0, (w: KafkaWriter) => { w.string(groupId); });
      const err = r.int16();
      if (err === 0) {
        const nodeId = r.int32(); const host = r.string()!; const port = r.int32();
        return { nodeId, host, port };
      }
      lastErr = new KafkaProtocolError(err, 'findCoordinator');
      if (!KafkaClient.TRANSIENT_COORDINATOR_ERRORS.has(err)) throw lastErr;
      await new Promise((res) => setTimeout(res, Math.min(250 * (attempt + 1), 1500)));
    }
    throw lastErr instanceof Error ? lastErr : new KafkaProtocolError(15, 'findCoordinator');
  }

  /** Transient consumer-group coordinator errors that should be retried during cold start. */
  private static readonly TRANSIENT_COORDINATOR_ERRORS = new Set<number>([14, 15, 16]);

  /**
   * Run a coordinator-dependent operation, retrying (with fresh coordinator
   * resolution) on transient coordinator errors. Closes the cold-start race
   * where OFFSET_COMMIT/OFFSET_FETCH hit COORDINATOR_LOAD_IN_PROGRESS or
   * NOT_COORDINATOR while __consumer_offsets is still loading.
   */
  private async _withCoordinatorRetry<T>(op: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        return await op();
      } catch (e) {
        lastErr = e;
        const code = e instanceof KafkaProtocolError ? e.code : undefined;
        if (code !== undefined && KafkaClient.TRANSIENT_COORDINATOR_ERRORS.has(code)) {
          await new Promise((res) => setTimeout(res, Math.min(250 * (attempt + 1), 1500)));
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new KafkaProtocolError(16, 'coordinatorOp');
  }

  /** Commit an offset for a consumer group (group offset storage). */
  async commitOffset(groupId: string, topic: string, partition: number, offset: bigint): Promise<void> {
    return this._withCoordinatorRetry(async () => {
      const coord = await this.findCoordinator(groupId);
      const conn = await this._conn(coord.host, coord.port);
      const r = await conn.request(API.OFFSET_COMMIT, 2, (w: KafkaWriter) => {
        w.string(groupId);
        w.int32(-1);       // generation_id
        w.string('');      // member_id
        w.int64(-1n);      // retention_time_ms
        w.int32(1);        // topic count
        w.string(topic);
        w.int32(1);        // partition count
        w.int32(partition);
        w.int64(offset);
        w.string(null);    // committed metadata
      });
      const topicCount = r.int32();
      for (let i = 0; i < topicCount; i++) {
        r.string();
        const pCount = r.int32();
        for (let p = 0; p < pCount; p++) { r.int32(); const err = r.int16(); if (err !== 0) throw new KafkaProtocolError(err, 'offsetCommit'); }
      }
    });
  }

  /** Fetch the committed offset for a consumer group (-1 if none). */
  async fetchOffset(groupId: string, topic: string, partition: number): Promise<bigint> {
    return this._withCoordinatorRetry(async () => {
      const coord = await this.findCoordinator(groupId);
      const conn = await this._conn(coord.host, coord.port);
      const r = await conn.request(API.OFFSET_FETCH, 1, (w: KafkaWriter) => {
        w.string(groupId);
        w.int32(1);    // topic count
        w.string(topic);
        w.int32(1);    // partition count
        w.int32(partition);
      });
      const topicCount = r.int32();
      let committed = -1n;
      for (let i = 0; i < topicCount; i++) {
        r.string();
        const pCount = r.int32();
        for (let p = 0; p < pCount; p++) {
          r.int32(); const off = r.int64(); r.string(); const err = r.int16();
          if (err !== 0) throw new KafkaProtocolError(err, 'offsetFetch');
          committed = off;
        }
      }
      return committed;
    });
  }

  close(): void {
    for (const c of this.connections.values()) c.close();
    this.connections.clear();
  }
}

/** The internal Kafka topic that stores committed consumer-group offsets. */
const CONSUMER_OFFSETS_TOPIC = '__consumer_offsets';

export interface CoordinatorGateResult {
  /** True only when both FindCoordinator succeeded and __consumer_offsets is stable within the budget. */
  ready: boolean;
  /** A successful FindCoordinator response was observed. */
  findCoordinatorOk: boolean;
  /** __consumer_offsets exists with every partition reporting a live leader. */
  offsetsTopicStable: boolean;
  /** Total time spent waiting, in milliseconds. */
  waitedMs: number;
  /** Committed consumer offsets were left untouched (always true: the gate never commits/fetches/resets). */
  offsetsPreserved: boolean;
}

export interface CoordinatorReadinessGateOptions {
  /** Total readiness budget. Defaults to 30_000 ms (Req 9.1). */
  timeoutMs?: number;
  /** Consumer group whose coordinator must be resolvable. */
  group: string;
  /** Poll backoff between readiness probes. Defaults to 250 ms. */
  pollIntervalMs?: number;
}

/**
 * Coordinator Readiness Gate (Req 9.1/9.2).
 *
 * Before a consumer begins consuming, wait up to `timeoutMs` (default 30s) for
 * BOTH:
 *   1. a successful `FindCoordinator` response for the consumer group, AND
 *   2. `__consumer_offsets` stability — the topic exists and EVERY partition
 *      has a live leader (error 0, leader >= 0).
 *
 * On success the result reports `ready: true`. On timeout the result reports
 * `ready: false`: the caller MUST NOT begin consuming. The gate performs only
 * read-only metadata/coordinator lookups and never commits, fetches, or resets
 * offsets, so committed consumer offsets are always preserved
 * (`offsetsPreserved: true`).
 *
 * Built on `KafkaClient.findCoordinator` + metadata partition-leader checks
 * (mirrors `awaitTopicReady`).
 */
export class CoordinatorReadinessGate {
  private readonly client: KafkaClient;
  private readonly timeoutMs: number;
  private readonly group: string;
  private readonly pollIntervalMs: number;

  constructor(client: KafkaClient, opts: CoordinatorReadinessGateOptions) {
    this.client = client;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.group = opts.group;
    this.pollIntervalMs = opts.pollIntervalMs ?? 250;
  }

  /**
   * Wait for readiness within the budget. Resolves with a result describing
   * what was observed; never throws on broker unavailability (a failed probe
   * simply does not advance readiness). On timeout `ready` is false and no
   * consuming should follow.
   */
  async await(): Promise<CoordinatorGateResult> {
    const start = Date.now();
    const deadline = start + this.timeoutMs;
    let findCoordinatorOk = false;
    let offsetsTopicStable = false;

    for (;;) {
      if (!findCoordinatorOk) {
        try {
          await this.client.findCoordinator(this.group);
          findCoordinatorOk = true;
        } catch {
          findCoordinatorOk = false;
        }
      }
      if (findCoordinatorOk && !offsetsTopicStable) {
        offsetsTopicStable = await this._offsetsTopicStable();
      }
      if (findCoordinatorOk && offsetsTopicStable) {
        return {
          ready: true,
          findCoordinatorOk,
          offsetsTopicStable,
          waitedMs: Date.now() - start,
          offsetsPreserved: true,
        };
      }
      if (Date.now() >= deadline) {
        // Timeout: do not begin consuming. Committed offsets are untouched.
        return {
          ready: false,
          findCoordinatorOk,
          offsetsTopicStable,
          waitedMs: Date.now() - start,
          offsetsPreserved: true,
        };
      }
      const remaining = deadline - Date.now();
      await new Promise((r) => setTimeout(r, Math.min(this.pollIntervalMs, Math.max(0, remaining))));
    }
  }

  /** __consumer_offsets is stable: topic exists, no error, and every partition has a live leader. */
  private async _offsetsTopicStable(): Promise<boolean> {
    try {
      const meta = await this.client.metadata([CONSUMER_OFFSETS_TOPIC]);
      const tm = meta.topics.find((t) => t.name === CONSUMER_OFFSETS_TOPIC);
      return (
        tm !== undefined &&
        tm.error === 0 &&
        tm.partitions.length >= 1 &&
        tm.partitions.every((p) => p.error === 0 && p.leader >= 0)
      );
    } catch {
      return false;
    }
  }
}

export { encodeRecordBatch, decodeRecordBatches };
export type { KafkaRecord };
