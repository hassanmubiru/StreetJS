// src/transports/redis-cluster.ts
// Public barrel for the `streetjs/redis-cluster` subpath: the pure cluster
// primitives (CRC16 hash slot, MOVED/ASK, CLUSTER SLOTS parsing) plus the
// cluster routing client (RFC 0003).

export * from './cluster.js';
export { RedisClusterClient } from './cluster-client.js';
export type { RedisClusterOptions } from './cluster-client.js';
