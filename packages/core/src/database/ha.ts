// src/database/ha.ts
// PostgreSQL high-availability client (RFC 0003). Additive wrapper over the
// single-endpoint PgConnection (wire.ts, unchanged): multi-host support, primary
// discovery via pg_is_in_recovery(), role-targeted routing, and failover
// (re-resolve + reconnect) on connection loss.
//
// Zero dependencies. Single-endpoint PgConnection semantics are untouched; this
// is a new opt-in class.

import { PgConnection, type PgConnectOptions, type PgResult } from './wire.js';

export type PgTarget = 'primary' | 'prefer-replica' | 'any';

export interface PgHaHost {
  host: string;
  port: number;
}

export interface PgHaOptions {
  /** Candidate hosts (primary + standbys). Order is not significant. */
  hosts: PgHaHost[];
  user: string;
  password: string;
  database: string;
  /** Default routing policy for queries. Default 'primary'. */
  target?: PgTarget;
  connectTimeoutMs?: number;
  /** Max failover re-resolve attempts for a single query. Default 2. */
  maxFailover?: number;
  /**
   * Per-attempt query timeout (ms) used for failover detection. A wedged or
   * already-closed connection to a dead primary can otherwise hang a query
   * indefinitely; on timeout the HA client drops that connection, re-discovers
   * the topology, and retries. Default 8000.
   */
  queryTimeoutMs?: number;
}

type Role = 'primary' | 'replica' | 'unknown';
const hostKey = (h: PgHaHost): string => `${h.host}:${h.port}`;

/** Read pg_is_in_recovery() → 'replica' when in recovery, else 'primary'. */
function roleFromRecovery(result: PgResult): Role {
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return 'unknown';
  const v = Object.values(row)[0];
  const inRecovery = v === true || v === 't' || v === 'true';
  return inRecovery ? 'replica' : 'primary';
}

export class PgHaClient {
  private readonly hosts: PgHaHost[];
  private readonly base: Omit<PgConnectOptions, 'host' | 'port'>;
  private readonly defaultTarget: PgTarget;
  private readonly maxFailover: number;
  private readonly queryTimeoutMs: number;
  private readonly conns = new Map<string, PgConnection>();
  private readonly roles = new Map<string, Role>();
  private connected = false;

  constructor(opts: PgHaOptions) {
    if (!opts.hosts || opts.hosts.length === 0) {
      throw new Error('PgHaClient requires at least one host');
    }
    this.hosts = opts.hosts.map((h) => ({ host: h.host, port: h.port }));
    this.base = {
      user: opts.user,
      password: opts.password,
      database: opts.database,
      connectTimeoutMs: opts.connectTimeoutMs,
    };
    this.defaultTarget = opts.target ?? 'primary';
    this.maxFailover = Math.max(1, opts.maxFailover ?? 2);
    this.queryTimeoutMs = Math.max(1, opts.queryTimeoutMs ?? 8000);
  }

  /** Connect to all reachable hosts and classify each as primary/replica. */
  async connect(): Promise<void> {
    await this.discover();
    this.connected = true;
  }

  /** (Re)connect to each host and classify its role. Unreachable hosts are
   * dropped from the live set until the next discovery. */
  private async discover(): Promise<void> {
    await Promise.all(
      this.hosts.map(async (h) => {
        const key = hostKey(h);
        try {
          const conn = await this.openFresh(h);
          this.conns.set(key, conn);
          const r = await conn.query('SELECT pg_is_in_recovery()');
          this.roles.set(key, roleFromRecovery(r));
        } catch {
          this.dropConn(key);
          this.roles.set(key, 'unknown');
        }
      }),
    );
    if (![...this.roles.values()].some((r) => r === 'primary' || r === 'replica')) {
      throw new Error('PgHaClient: no reachable PostgreSQL host during discovery');
    }
  }

  private async openFresh(h: PgHaHost): Promise<PgConnection> {
    return PgConnection.connect({ ...this.base, host: h.host, port: h.port });
  }

  private dropConn(key: string): void {
    const c = this.conns.get(key);
    if (c) void c.close().catch(() => {});
    this.conns.delete(key);
  }

  private pick(target: PgTarget): PgConnection | undefined {
    const byRole = (role: Role): PgConnection | undefined => {
      for (const [key, r] of this.roles) if (r === role) { const c = this.conns.get(key); if (c) return c; }
      return undefined;
    };
    if (target === 'primary') return byRole('primary');
    if (target === 'prefer-replica') return byRole('replica') ?? byRole('primary');
    return byRole('primary') ?? byRole('replica'); // 'any'
  }

  /** The current primary endpoint (or undefined if none known). */
  primaryEndpoint(): PgHaHost | undefined {
    for (const [key, r] of this.roles) if (r === 'primary') {
      const [host, port] = key.split(':');
      return { host: host!, port: Number(port) };
    }
    return undefined;
  }

  replicaEndpoints(): PgHaHost[] {
    const out: PgHaHost[] = [];
    for (const [key, r] of this.roles) if (r === 'replica') {
      const [host, port] = key.split(':');
      out.push({ host: host!, port: Number(port) });
    }
    return out;
  }

  /**
   * Run a query against the selected role. On connection loss (query throws),
   * re-discovers the topology and retries against the newly-resolved target,
   * up to `maxFailover` times — so a primary promotion is picked up transparently.
   */
  async query(sql: string, params?: unknown[], opts?: { target?: PgTarget }): Promise<PgResult> {
    if (!this.connected) await this.connect();
    const target = opts?.target ?? this.defaultTarget;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxFailover; attempt++) {
      const conn = this.pick(target);
      if (!conn) {
        await this.discover();
        continue;
      }
      try {
        return await conn.query(sql, params);
      } catch (err) {
        lastErr = err;
        // Connection likely lost / primary demoted — re-resolve and retry.
        await this.discover();
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error('PgHaClient: query failed after failover attempts');
  }

  async close(): Promise<void> {
    await Promise.all([...this.conns.values()].map((c) => c.close().catch(() => {})));
    this.conns.clear();
    this.roles.clear();
    this.connected = false;
  }
}
