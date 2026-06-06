// src/transports/kafka/client.ts
// Kafka protocol client: metadata discovery, produce, fetch, list-offsets,
// group-coordinator lookup, and offset commit/fetch. Built on KafkaConnection.
import { KafkaConnection, API } from './connection.js';
import { encodeRecordBatch, decodeRecordBatches } from './recordbatch.js';
export class KafkaProtocolError extends Error {
    code;
    constructor(code, op) {
        super(`Kafka ${op} failed with error code ${code}`);
        this.code = code;
        this.name = 'KafkaProtocolError';
    }
}
export class KafkaClient {
    bootstrap;
    clientId;
    connTimeout;
    connections = new Map();
    meta = null;
    constructor(opts = {}) {
        const list = opts.brokers ?? [`${opts.host ?? '127.0.0.1'}:${opts.port ?? 9092}`];
        this.bootstrap = list.map((b) => {
            const [host, port] = b.split(':');
            return { host: host, port: Number(port ?? 9092) };
        });
        this.clientId = opts.clientId ?? 'street-kafka';
        this.connTimeout = opts.connectTimeoutMs ?? 10_000;
    }
    async _conn(host, port) {
        const key = `${host}:${port}`;
        let conn = this.connections.get(key);
        if (conn?.connected)
            return conn;
        conn = new KafkaConnection({ host, port, clientId: this.clientId, connectTimeoutMs: this.connTimeout });
        await conn.connect();
        this.connections.set(key, conn);
        return conn;
    }
    async _anyConn() {
        let lastErr;
        for (const b of this.bootstrap) {
            try {
                return await this._conn(b.host, b.port);
            }
            catch (e) {
                lastErr = e;
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error('No Kafka brokers reachable');
    }
    /** Metadata v1: brokers (with rack), controller id, topics with partitions. */
    async metadata(topics) {
        const conn = await this._anyConn();
        const r = await conn.request(API.METADATA, 1, (w) => {
            w.int32(topics.length);
            for (const t of topics)
                w.string(t);
        });
        const brokerCount = r.int32();
        const brokers = [];
        for (let i = 0; i < brokerCount; i++) {
            const nodeId = r.int32();
            const host = r.string();
            const port = r.int32();
            r.string(); // rack (nullable)
            brokers.push({ nodeId, host, port });
        }
        const controllerId = r.int32();
        const topicCount = r.int32();
        const tmeta = [];
        for (let i = 0; i < topicCount; i++) {
            const error = r.int16();
            const name = r.string();
            r.int8(); // is_internal
            const pCount = r.int32();
            const partitions = [];
            for (let p = 0; p < pCount; p++) {
                const perr = r.int16();
                const partition = r.int32();
                const leader = r.int32();
                const replicas = r.array((rd) => rd.int32());
                const isr = r.array((rd) => rd.int32());
                partitions.push({ error: perr, partition, leader, replicas, isr });
            }
            tmeta.push({ error, name, partitions });
        }
        this.meta = { brokers, controllerId, topics: tmeta };
        return this.meta;
    }
    _brokerById(nodeId) {
        const b = this.meta?.brokers.find((x) => x.nodeId === nodeId);
        if (!b)
            throw new Error(`Kafka broker ${nodeId} not found in metadata`);
        return b;
    }
    /** Resolve the leader broker for a topic-partition. */
    async leaderFor(topic, partition) {
        if (!this.meta)
            await this.metadata([topic]);
        let tm = this.meta.topics.find((t) => t.name === topic);
        if (!tm) {
            await this.metadata([topic]);
            tm = this.meta.topics.find((t) => t.name === topic);
        }
        const pm = tm?.partitions.find((p) => p.partition === partition);
        if (!pm)
            throw new Error(`No leader for ${topic}-${partition}`);
        return this._brokerById(pm.leader);
    }
    /** Produce records to a topic-partition (acks=all). Returns base offset. */
    async produce(topic, partition, records, opts = {}) {
        const leader = await this.leaderFor(topic, partition);
        const conn = await this._conn(leader.host, leader.port);
        const batch = encodeRecordBatch(records);
        const r = await conn.request(API.PRODUCE, 3, (w) => {
            w.string(null); // transactional_id
            w.int16(opts.acks ?? -1); // acks (-1 = all)
            w.int32(opts.timeoutMs ?? 30_000);
            w.int32(1); // topic count
            w.string(topic);
            w.int32(1); // partition count
            w.int32(partition);
            w.bytes(batch); // records
        });
        const topicCount = r.int32();
        let baseOffset = -1n;
        for (let i = 0; i < topicCount; i++) {
            r.string(); // name
            const pCount = r.int32();
            for (let p = 0; p < pCount; p++) {
                r.int32(); // index
                const err = r.int16();
                const bo = r.int64();
                r.int64(); // log_append_time
                r.int64(); // log_start_offset
                if (err !== 0)
                    throw new KafkaProtocolError(err, 'produce');
                baseOffset = bo;
            }
        }
        return baseOffset;
    }
    /** Fetch records from a topic-partition starting at `fetchOffset`. */
    async fetch(topic, partition, fetchOffset, opts = {}) {
        const leader = await this.leaderFor(topic, partition);
        const conn = await this._conn(leader.host, leader.port);
        const maxBytes = opts.maxBytes ?? 1_048_576;
        const r = await conn.request(API.FETCH, 4, (w) => {
            w.int32(-1); // replica_id
            w.int32(opts.maxWaitMs ?? 1000); // max_wait_ms
            w.int32(1); // min_bytes
            w.int32(maxBytes); // max_bytes
            w.int8(0); // isolation_level (read_uncommitted)
            w.int32(1); // topic count
            w.string(topic);
            w.int32(1); // partition count
            w.int32(partition);
            w.int64(fetchOffset); // fetch_offset
            w.int32(maxBytes); // partition_max_bytes
        });
        r.int32(); // throttle_time_ms
        const topicCount = r.int32();
        let records = [];
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
                for (let a = 0; a < Math.max(0, abortedCount); a++) {
                    r.int64();
                    r.int64();
                }
                const recordSet = r.bytes();
                if (err !== 0)
                    throw new KafkaProtocolError(err, 'fetch');
                if (recordSet && recordSet.length > 0) {
                    records = records.concat(decodeRecordBatches(recordSet).filter((rec) => (rec.offset ?? 0n) >= fetchOffset));
                }
            }
        }
        return { records, highWatermark };
    }
    /** List offsets: timestamp -1 = latest (end), -2 = earliest (start). */
    async listOffset(topic, partition, timestamp) {
        const leader = await this.leaderFor(topic, partition);
        const conn = await this._conn(leader.host, leader.port);
        const r = await conn.request(API.LIST_OFFSETS, 1, (w) => {
            w.int32(-1); // replica_id
            w.int32(1); // topic count
            w.string(topic);
            w.int32(1); // partition count
            w.int32(partition);
            w.int64(timestamp);
        });
        const topicCount = r.int32();
        let offset = -1n;
        for (let i = 0; i < topicCount; i++) {
            r.string();
            const pCount = r.int32();
            for (let p = 0; p < pCount; p++) {
                r.int32();
                const err = r.int16();
                r.int64();
                const off = r.int64();
                if (err !== 0)
                    throw new KafkaProtocolError(err, 'listOffsets');
                offset = off;
            }
        }
        return offset;
    }
    /** Find the group coordinator broker for a consumer group. */
    async findCoordinator(groupId) {
        const conn = await this._anyConn();
        const r = await conn.request(API.FIND_COORDINATOR, 0, (w) => { w.string(groupId); });
        const err = r.int16();
        if (err !== 0)
            throw new KafkaProtocolError(err, 'findCoordinator');
        const nodeId = r.int32();
        const host = r.string();
        const port = r.int32();
        return { nodeId, host, port };
    }
    /** Commit an offset for a consumer group (group offset storage). */
    async commitOffset(groupId, topic, partition, offset) {
        const coord = await this.findCoordinator(groupId);
        const conn = await this._conn(coord.host, coord.port);
        const r = await conn.request(API.OFFSET_COMMIT, 2, (w) => {
            w.string(groupId);
            w.int32(-1); // generation_id
            w.string(''); // member_id
            w.int64(-1n); // retention_time_ms
            w.int32(1); // topic count
            w.string(topic);
            w.int32(1); // partition count
            w.int32(partition);
            w.int64(offset);
            w.string(null); // committed metadata
        });
        const topicCount = r.int32();
        for (let i = 0; i < topicCount; i++) {
            r.string();
            const pCount = r.int32();
            for (let p = 0; p < pCount; p++) {
                r.int32();
                const err = r.int16();
                if (err !== 0)
                    throw new KafkaProtocolError(err, 'offsetCommit');
            }
        }
    }
    /** Fetch the committed offset for a consumer group (-1 if none). */
    async fetchOffset(groupId, topic, partition) {
        const coord = await this.findCoordinator(groupId);
        const conn = await this._conn(coord.host, coord.port);
        const r = await conn.request(API.OFFSET_FETCH, 1, (w) => {
            w.string(groupId);
            w.int32(1); // topic count
            w.string(topic);
            w.int32(1); // partition count
            w.int32(partition);
        });
        const topicCount = r.int32();
        let committed = -1n;
        for (let i = 0; i < topicCount; i++) {
            r.string();
            const pCount = r.int32();
            for (let p = 0; p < pCount; p++) {
                r.int32();
                const off = r.int64();
                r.string();
                const err = r.int16();
                if (err !== 0)
                    throw new KafkaProtocolError(err, 'offsetFetch');
                committed = off;
            }
        }
        return committed;
    }
    close() {
        for (const c of this.connections.values())
            c.close();
        this.connections.clear();
    }
}
export { encodeRecordBatch, decodeRecordBatches };
//# sourceMappingURL=client.js.map