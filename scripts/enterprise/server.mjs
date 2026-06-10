#!/usr/bin/env node
// scripts/enterprise/server.mjs
//
// The "running app" for the Enterprise Console APIs Layer B verification
// (Requirement 6.10). A zero-dependency node:http server that:
//
//   1. Connects to the PostgreSQL container through the framework's `PgPool`
//      (lazy warm-up), so the app runs against a REAL database — not a mock.
//   2. Mounts the REAL `EnterpriseConsole` REST surface (CONSOLE_ROUTES) behind
//      its authn → authz → validate → perform lifecycle, backed by a
//      PostgreSQL-backed `ConsoleBackend` that persists tenant / policy /
//      compliance / admin state to the database.
//   3. Distinguishes liveness from DB-readiness: `/health/live` never touches
//      the DB; `/health/ready` is 200 only when the database is reachable.
//
// The suite (e2e.mjs) drives this server over HTTP exactly as a real client
// would, so a green run is genuine evidence the console works end-to-end against
// a running app + PostgreSQL.
//
// Config (all via env): PORT, HOST, PGHOST, PGPORT, and the credentials/secret
// from lib.mjs. Run standalone for local debugging:
//   PGHOST=127.0.0.1 PGPORT=5433 node scripts/enterprise/server.mjs
//
// _Design: Components → Enterprise Console APIs; Testing Strategy → Layer B.
//  Requirements: 6.1–6.10_

import { createServer } from 'node:http';

import {
  EnterpriseConsole,
  CONSOLE_ROUTES,
  JwtService,
  PgPool,
} from 'streetjs';

import { PG, CONSOLE_JWT_SECRET } from './lib.mjs';

const PORT = Number(process.env.PORT ?? 8099);
const HOST = process.env.HOST ?? '127.0.0.1';
const SECRET = process.env.STREET_CONSOLE_JWT_SECRET ?? CONSOLE_JWT_SECRET;

// ── PostgreSQL-backed ConsoleBackend ──────────────────────────────────────────
//
// Persists all console state to PostgreSQL so the suite exercises the running
// app against a real database. JSON-shaped values are stored as text (the wire
// driver returns columns as text), matching PostgreSQL text-protocol semantics.

class PgConsoleBackend {
  constructor(pool) {
    this.pool = pool;
  }

  /** Create the console tables once; idempotent. */
  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS console_tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        plan TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE IF NOT EXISTS console_policies (
        kind TEXT NOT NULL,
        key  TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (kind, key)
      );
      CREATE TABLE IF NOT EXISTS console_users (
        user_id TEXT PRIMARY KEY,
        roles TEXT NOT NULL DEFAULT '[]',
        disabled BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE IF NOT EXISTS console_secrets (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS console_rotated_keys (
        key_id TEXT PRIMARY KEY,
        rotated_at TEXT NOT NULL
      );
    `);
  }

  // ── Tenant (Req 6.1) ────────────────────────────────────────────────────────
  async createTenant(input) {
    const id = globalThis.crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO console_tenants (id, name, plan, status) VALUES ($1, $2, $3, 'active')`,
      [id, input.name, input.plan ?? null],
    );
    return { id };
  }

  async updateTenant(id, input) {
    const exists = await this.pool.query(`SELECT id FROM console_tenants WHERE id = $1`, [id]);
    if (exists.rows.length === 0) throw new NotFound(`tenant ${id} not found`);
    if (input.name !== undefined) await this.pool.query(`UPDATE console_tenants SET name = $2 WHERE id = $1`, [id, input.name]);
    if (input.plan !== undefined) await this.pool.query(`UPDATE console_tenants SET plan = $2 WHERE id = $1`, [id, input.plan]);
    if (input.status !== undefined) await this.pool.query(`UPDATE console_tenants SET status = $2 WHERE id = $1`, [id, input.status]);
    return { id };
  }

  async suspendTenant(id) {
    const r = await this.pool.query(`UPDATE console_tenants SET status = 'suspended' WHERE id = $1`, [id]);
    if (r.rowCount === 0) throw new NotFound(`tenant ${id} not found`);
    return { id, status: 'suspended' };
  }

  // ── Policy (Req 6.2) ──────────────────────────────────────────────────────────
  async setRbacPolicy(input) {
    await this.upsertPolicy('rbac', 'rbac', JSON.stringify(input));
  }

  async setMfaPolicy(input) {
    await this.upsertPolicy('mfa', 'mfa', JSON.stringify(input));
  }

  async setRetentionPolicy(input) {
    await this.upsertPolicy('retention', input.entity, JSON.stringify({ retentionDays: input.retentionDays }));
  }

  async setClassificationPolicy(input) {
    await this.upsertPolicy('classification', input.field, JSON.stringify({ level: input.level }));
  }

  async upsertPolicy(kind, key, payload) {
    await this.pool.query(
      `INSERT INTO console_policies (kind, key, payload) VALUES ($1, $2, $3)
       ON CONFLICT (kind, key) DO UPDATE SET payload = EXCLUDED.payload`,
      [kind, key, payload],
    );
  }

  // ── Compliance (Req 6.3) ────────────────────────────────────────────────────
  async exportAudit(input) {
    // No persisted audit log in this harness; report a zero-record export of the
    // requested format/window (shape matches the production ServiceConsoleBackend).
    return { format: input.format, recordCount: 0 };
  }

  async generateComplianceReport() {
    const cls = await this.pool.query(`SELECT key, payload FROM console_policies WHERE kind = 'classification'`);
    const ret = await this.pool.query(`SELECT key, payload FROM console_policies WHERE kind = 'retention'`);
    const retByField = new Map(ret.rows.map((row) => [row.key, JSON.parse(row.payload ?? '{}').retentionDays ?? null]));
    const entries = cls.rows.map((row) => ({
      field: row.key,
      level: JSON.parse(row.payload ?? '{}').level ?? null,
      retentionDays: retByField.get(row.key) ?? null,
    }));
    return { generatedAt: new Date().toISOString(), entries };
  }

  async securityPosture() {
    const mfa = await this.pool.query(`SELECT payload FROM console_policies WHERE kind = 'mfa' AND key = 'mfa'`);
    const rbac = await this.pool.query(`SELECT 1 FROM console_policies WHERE kind = 'rbac' AND key = 'rbac'`);
    const tenants = await this.pool.query(`SELECT COUNT(*)::int AS c FROM console_tenants`);
    const retention = await this.pool.query(`SELECT COUNT(*)::int AS c FROM console_policies WHERE kind = 'retention'`);
    return {
      mfaRequired: mfa.rows.length > 0 ? Boolean(JSON.parse(mfa.rows[0].payload ?? '{}').required) : false,
      rbacConfigured: rbac.rows.length > 0,
      tenantCount: Number(tenants.rows[0]?.c ?? 0),
      retentionPolicies: Number(retention.rows[0]?.c ?? 0),
    };
  }

  // ── Admin (Req 6.4) ──────────────────────────────────────────────────────────
  async manageUser(input) {
    if (input.action === 'disable') {
      await this.pool.query(
        `INSERT INTO console_users (user_id, roles, disabled) VALUES ($1, '[]', TRUE)
         ON CONFLICT (user_id) DO UPDATE SET disabled = TRUE`,
        [input.userId],
      );
    } else {
      const roles = JSON.stringify(input.roles ?? []);
      await this.pool.query(
        `INSERT INTO console_users (user_id, roles, disabled) VALUES ($1, $2, FALSE)
         ON CONFLICT (user_id) DO UPDATE SET roles = EXCLUDED.roles, disabled = FALSE`,
        [input.userId, roles],
      );
    }
    return { userId: input.userId, action: input.action };
  }

  async rotateKey(input) {
    const rotatedAt = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO console_rotated_keys (key_id, rotated_at) VALUES ($1, $2)
       ON CONFLICT (key_id) DO UPDATE SET rotated_at = EXCLUDED.rotated_at`,
      [input.keyId, rotatedAt],
    );
    return { keyId: input.keyId, rotatedAt };
  }

  async manageSecret(name, input) {
    await this.pool.query(
      `INSERT INTO console_secrets (name, value) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
      [name, input.value],
    );
    return { name };
  }
}

class NotFound extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConsoleNotFoundError';
  }
}

// ── HTTP adapter ──────────────────────────────────────────────────────────────

/** Read and JSON-parse a request body; returns undefined for an empty body. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ __invalidJson: true });
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body ?? {});
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(data);
}

async function main() {
  const pool = new PgPool({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: PG.user,
    password: PG.password,
    database: PG.database,
    connectTimeoutMs: 5_000,
    minConnections: 1,
    maxConnections: 5,
  });

  // Warm up + migrate once before accepting traffic (the running app declares
  // PostgreSQL as a provisioned dependency for this verification).
  const backend = new PgConsoleBackend(pool);
  await pool.ensureInitialized();
  await backend.migrate();

  const jwt = new JwtService(SECRET);
  const consoleApi = new EnterpriseConsole({ jwt, backend, routes: CONSOLE_ROUTES });

  const server = createServer(async (req, res) => {
    try {
      const url = req.url ?? '/';
      const path = url.split('?')[0];

      // Liveness never depends on the DB.
      if (req.method === 'GET' && path === '/health/live') {
        return sendJson(res, 200, { status: 'live' });
      }
      // Readiness reflects DB reachability.
      if (req.method === 'GET' && path === '/health/ready') {
        try {
          await pool.query('SELECT 1');
          return sendJson(res, 200, { status: 'ready' });
        } catch (err) {
          return sendJson(res, 503, { status: 'not-ready', error: String(err?.message ?? err) });
        }
      }
      // Plain /health alias (live).
      if (req.method === 'GET' && path === '/health') {
        return sendJson(res, 200, { status: 'ok' });
      }

      // Everything else is a console operation.
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
      }
      const body = await readBody(req);
      const response = await consoleApi.handle({
        method: req.method,
        path,
        headers,
        // A body that failed to parse is surfaced as an invalid marker so the
        // validators reject it (rather than silently treating it as empty).
        body: body && body.__invalidJson ? body : body,
      });
      return sendJson(res, response.status, response.body);
    } catch (err) {
      return sendJson(res, 500, { error: 'internal_error', message: String(err?.message ?? err) });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[enterprise-server] listening on http://${HOST}:${PORT} (db ${process.env.PGHOST ?? '127.0.0.1'}:${process.env.PGPORT ?? 5432})`);
  });

  const shutdown = async () => {
    server.close();
    await pool.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`[enterprise-server] fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
