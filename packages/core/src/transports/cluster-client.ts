// src/transports/cluster-client.ts
// Redis Cluster routing client (RFC 0003). Composes one RedisClient per cluster
// node and routes commands by key hash slot, following MOVED/ASK redirects and
// refreshing the slot map on topology change. Built on the pure primitives in
// `cluster.ts` (verified against Redis reference vectors) + the single-node
// RedisClient in `resp.ts` (unchanged).
//
// Zero dependencies. Command surface mirrors the single-node client subset
// (GET / SET / DEL / PUBLISH), which is what the event-bus and cache transports use.

import { RedisClient, type RespValue } from './resp.js';
import {
  hashSlot,
  parseRedirect,
  parseClusterSlots,
  buildSlotMap,
  type ClusterNode,
} from './cluster.js';

export interface RedisClusterOptions {
  /** Seed nodes to bootstrap topology discovery. At least one is required. */
  nodes: Array<{ host: string; port: number }>;
  password?: string;
  /** Max MOVED/ASK redirects to follow for a single command. Default 5. */
  maxRedirects?: number;
}

const nodeKey = (n: ClusterNode): string => `${n.host}:${n.port}`;

/** Detect a MOVED/ASK redirect in a RESP reply. RedisClient surfaces protocol
 * errors as `"ERR:<message>"` strings, so strip that prefix before parsing. */
function redirectOf(reply: RespValue): ReturnType<typeof parseRedirect> {
  if (typeof reply !== 'string') return null;
  const msg = reply.startsWith('ERR:') ? reply.slice(4) : reply;
  return parseRedirect(msg);
}

function isErr(reply: RespValue): reply is string {
  return typeof reply === 'string' && reply.startsWith('ERR:');
}

export class RedisClusterClient {
  private readonly seeds: ClusterNode[];
  private readonly password: string | undefined;
  private readonly maxRedirects: number;
  private readonly conns = new Map<string, RedisClient>();
  private slotMap: (ClusterNode | undefined)[] = [];
  private connected = false;

  constructor(opts: RedisClusterOptions) {
    if (!opts.nodes || opts.nodes.length === 0) {
      throw new Error('RedisClusterClient requires at least one seed node');
    }
    this.seeds = opts.nodes.map((n) => ({ host: n.host, port: n.port }));
    this.password = opts.password;
    this.maxRedirects = Math.max(1, opts.maxRedirects ?? 5);
  }

  /** Connect to a seed and discover the slot topology. */
  async connect(): Promise<void> {
    if (this.connected) return;
    await this.refreshSlots();
    this.connected = true;
  }

  /** Get-or-open a pooled connection to a node. */
  private async conn(node: ClusterNode): Promise<RedisClient> {
    const key = nodeKey(node);
    let c = this.conns.get(key);
    if (!c) {
      c = new RedisClient({ host: node.host, port: node.port, password: this.password });
      this.conns.set(key, c);
    }
    await c.connect(); // idempotent — no-op if already connected
    return c;
  }

  /** (Re)discover slots from the first reachable seed or known node. */
  private async refreshSlots(): Promise<void> {
    const candidates = [...this.knownNodes(), ...this.seeds];
    let lastErr: unknown;
    for (const node of candidates) {
      try {
        const c = await this.conn(node);
        const reply = await c.command(['CLUSTER', 'SLOTS']);
        const ranges = parseClusterSlots(reply);
        if (ranges.length > 0) {
          this.slotMap = buildSlotMap(ranges);
          return;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      `RedisClusterClient: could not discover cluster slots from any seed${
        lastErr instanceof Error ? ` (${lastErr.message})` : ''
      }`,
    );
  }

  private knownNodes(): ClusterNode[] {
    const seen = new Map<string, ClusterNode>();
    for (const n of this.slotMap) if (n) seen.set(nodeKey(n), n);
    return [...seen.values()];
  }

  /** Route a keyed command to its slot owner, following MOVED/ASK redirects. */
  private async route(key: string, args: (string | number)[]): Promise<RespValue> {
    if (!this.connected) await this.connect();
    const slot = hashSlot(key);
    let target: ClusterNode | undefined = this.slotMap[slot] ?? this.seeds[0];
    let asking = false;

    for (let attempt = 0; attempt <= this.maxRedirects; attempt++) {
      const c = await this.conn(target!);
      if (asking) await c.command(['ASKING']);
      const reply = await c.command(args);
      const redirect = redirectOf(reply);
      if (!redirect) return reply;

      target = { host: redirect.host, port: redirect.port };
      if (redirect.kind === 'MOVED') {
        // Topology moved: update this slot and refresh the full map lazily.
        this.slotMap[redirect.slot] = target;
        asking = false;
      } else {
        // ASK: one-shot redirect to the target with a preceding ASKING; do not
        // update the slot map.
        asking = true;
      }
    }
    throw new Error(`RedisClusterClient: exceeded ${this.maxRedirects} redirects for key "${key}"`);
  }

  async get(key: string): Promise<string | null> {
    const r = await this.route(key, ['GET', key]);
    return typeof r === 'string' && !isErr(r) ? r : null;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const args =
      ttlMs && ttlMs > 0
        ? ['SET', key, value, 'PX', Math.floor(ttlMs)]
        : ['SET', key, value];
    await this.route(key, args);
  }

  async del(key: string): Promise<void> {
    await this.route(key, ['DEL', key]);
  }

  /** PUBLISH is cluster-wide; send it to any reachable node. */
  async publish(channel: string, message: string): Promise<void> {
    const node = this.knownNodes()[0] ?? this.seeds[0]!;
    const c = await this.conn(node);
    await c.command(['PUBLISH', channel, message]);
  }

  /** Expose the current slot→node map size for diagnostics/tests. */
  coveredSlots(): number {
    let n = 0;
    for (const s of this.slotMap) if (s) n++;
    return n;
  }

  close(): void {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.connected = false;
  }
}
