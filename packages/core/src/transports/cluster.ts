// src/transports/cluster.ts
// Redis Cluster foundations (RFC 0003): the pure, spec-exact building blocks for
// cluster-aware routing — CRC16 hash-slot computation (with hash-tag support),
// MOVED/ASK redirect parsing, and CLUSTER SLOTS topology parsing.
//
// These are deterministic and verified offline against Redis's own documented
// reference vectors (see cluster.test). The connection/routing engine that
// consumes them is layered on top and additionally validated against a live
// cluster topology.
//
// Zero dependencies.

import type { RespValue } from './resp.js';

// ── CRC16 (CCITT/XMODEM, polynomial 0x1021) ─────────────────────────────────
// This is the exact function Redis Cluster uses to hash keys.
export function crc16(input: string | Buffer): number {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  let crc = 0;
  for (const byte of buf) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

export const REDIS_CLUSTER_SLOTS = 16384;

/**
 * Compute the Redis Cluster hash slot for a key: `CRC16(key) % 16384`.
 * Honors hash tags — if the key contains `{...}` with a non-empty substring,
 * only that substring is hashed (so related keys can be co-located).
 */
export function hashSlot(key: string): number {
  let hashKey = key;
  const open = key.indexOf('{');
  if (open !== -1) {
    const close = key.indexOf('}', open + 1);
    if (close > open + 1) {
      hashKey = key.slice(open + 1, close);
    }
  }
  return crc16(hashKey) % REDIS_CLUSTER_SLOTS;
}

// ── Redirect parsing (-MOVED / -ASK) ────────────────────────────────────────
export interface Redirect {
  kind: 'MOVED' | 'ASK';
  slot: number;
  host: string;
  port: number;
}

/**
 * Parse a `-MOVED <slot> <host:port>` or `-ASK <slot> <host:port>` error reply.
 * Returns null when the message is not a redirect. IPv6 hosts (which contain
 * colons) are handled by splitting on the LAST colon for the port.
 */
export function parseRedirect(message: string): Redirect | null {
  const m = /^(MOVED|ASK)\s+(\d+)\s+(.+)$/.exec(message.trim());
  if (!m) return null;
  const kind = m[1] as 'MOVED' | 'ASK';
  const slot = Number(m[2]);
  const endpoint = m[3] ?? '';
  const lastColon = endpoint.lastIndexOf(':');
  if (lastColon === -1) return null;
  const host = endpoint.slice(0, lastColon);
  const port = Number(endpoint.slice(lastColon + 1));
  if (!Number.isInteger(slot) || !Number.isInteger(port) || host.length === 0) return null;
  return { kind, slot, host, port };
}

// ── CLUSTER SLOTS parsing ───────────────────────────────────────────────────
export interface ClusterNode {
  host: string;
  port: number;
}
export interface SlotRange {
  start: number;
  end: number;
  master: ClusterNode;
  replicas: ClusterNode[];
}

/**
 * Parse the reply of `CLUSTER SLOTS` into slot ranges. The reply is an array of
 * `[startSlot, endSlot, [host, port, id?], ...replicaNodes]`. Malformed entries
 * are skipped rather than throwing, so a partial topology still yields the
 * ranges that parsed.
 */
export function parseClusterSlots(reply: RespValue): SlotRange[] {
  if (!Array.isArray(reply)) return [];
  const ranges: SlotRange[] = [];
  for (const entry of reply) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const start = entry[0];
    const end = entry[1];
    if (typeof start !== 'number' || typeof end !== 'number') continue;
    const nodes: ClusterNode[] = [];
    for (let i = 2; i < entry.length; i++) {
      const node = entry[i];
      if (!Array.isArray(node) || node.length < 2) continue;
      const host = node[0];
      const port = node[1];
      if (typeof host !== 'string' || typeof port !== 'number') continue;
      nodes.push({ host, port });
    }
    if (nodes.length === 0) continue;
    ranges.push({ start, end, master: nodes[0]!, replicas: nodes.slice(1) });
  }
  return ranges;
}

/**
 * Build a dense slot → master-node lookup from parsed ranges. Index by hash slot
 * to find the owning master. Slots not covered map to `undefined`.
 */
export function buildSlotMap(ranges: SlotRange[]): (ClusterNode | undefined)[] {
  const map = new Array<ClusterNode | undefined>(REDIS_CLUSTER_SLOTS);
  for (const r of ranges) {
    for (let slot = r.start; slot <= r.end && slot < REDIS_CLUSTER_SLOTS; slot++) {
      map[slot] = r.master;
    }
  }
  return map;
}
