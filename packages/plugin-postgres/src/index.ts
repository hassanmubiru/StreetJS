// packages/plugin-postgres/src/index.ts
// Official StreetJS plugin: PostgreSQL connection pool.
//
// Wraps the native, dependency-free `PgPool` shipped by streetjs (PostgreSQL
// wire protocol v3 with SCRAM-SHA-256 auth — no `pg`). Validates connection
// config and injects a ready pool into each request via the sandboxed
// middleware surface (requires 'middleware').

import {
  PluginModule, PluginError, PgPool,
  type SandboxedApp, type PluginManifest, type PoolOptions,
} from 'streetjs';

export const POSTGRES_PLUGIN_NAME = 'street-plugin-postgres';
export const POSTGRES_PLUGIN_VERSION = '1.0.0';

/** Configuration schema for the PostgreSQL plugin. */
export interface PostgresPluginConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectTimeoutMs?: number;
  minConnections?: number;
  maxConnections?: number;
  idleTimeoutMs?: number;
  acquireTimeoutMs?: number;
  /** State key under which the pool is injected. Default 'pg'. */
  stateKey?: string;
}

/** The unsigned manifest for the PostgreSQL plugin (sign it via the build step). */
export function postgresPluginManifest(): PluginManifest {
  return {
    name: POSTGRES_PLUGIN_NAME,
    version: POSTGRES_PLUGIN_VERSION,
    capabilities: ['database', 'sql', 'postgres'],
    permissions: ['net', 'middleware'],
  };
}

function requireString(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new PluginError(`Postgres plugin config: "${k}" is required and must be a non-empty string`);
  }
  return v;
}

/**
 * Validate raw config against the PostgreSQL plugin's schema. Throws
 * {@link PluginError} with a precise message on the first violation.
 */
export function validatePostgresConfig(input: unknown): PostgresPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('Postgres plugin config must be an object');
  }
  const o = input as Record<string, unknown>;

  const host = requireString(o, 'host');
  const port = o['port'];
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PluginError('Postgres plugin config: "port" is required and must be an integer in [1, 65535]');
  }
  const user = requireString(o, 'user');
  const password = o['password'];
  if (typeof password !== 'string') {
    throw new PluginError('Postgres plugin config: "password" is required and must be a string');
  }
  const database = requireString(o, 'database');

  for (const k of ['connectTimeoutMs', 'minConnections', 'maxConnections', 'idleTimeoutMs', 'acquireTimeoutMs'] as const) {
    if (o[k] !== undefined && (typeof o[k] !== 'number' || (o[k] as number) < 0)) {
      throw new PluginError(`Postgres plugin config: "${k}" must be a non-negative number`);
    }
  }
  if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string') {
    throw new PluginError('Postgres plugin config: "stateKey" must be a string');
  }

  return {
    host, port, user, password, database,
    ...(o['connectTimeoutMs'] !== undefined ? { connectTimeoutMs: o['connectTimeoutMs'] as number } : {}),
    ...(o['minConnections'] !== undefined ? { minConnections: o['minConnections'] as number } : {}),
    ...(o['maxConnections'] !== undefined ? { maxConnections: o['maxConnections'] as number } : {}),
    ...(o['idleTimeoutMs'] !== undefined ? { idleTimeoutMs: o['idleTimeoutMs'] as number } : {}),
    ...(o['acquireTimeoutMs'] !== undefined ? { acquireTimeoutMs: o['acquireTimeoutMs'] as number } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
  };
}

/** Translate the plugin config into the core `PoolOptions`. */
export function toPoolOptions(cfg: PostgresPluginConfig): PoolOptions {
  return {
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
    ...(cfg.connectTimeoutMs !== undefined ? { connectTimeoutMs: cfg.connectTimeoutMs } : {}),
    ...(cfg.minConnections !== undefined ? { minConnections: cfg.minConnections } : {}),
    ...(cfg.maxConnections !== undefined ? { maxConnections: cfg.maxConnections } : {}),
    ...(cfg.idleTimeoutMs !== undefined ? { idleTimeoutMs: cfg.idleTimeoutMs } : {}),
    ...(cfg.acquireTimeoutMs !== undefined ? { acquireTimeoutMs: cfg.acquireTimeoutMs } : {}),
  };
}

/**
 * PostgreSQL plugin. On load it constructs a {@link PgPool} (which connects
 * lazily) and injects it into each request's `ctx.state[stateKey]`.
 */
export class PostgresPlugin extends PluginModule {
  readonly name = POSTGRES_PLUGIN_NAME;
  readonly version = POSTGRES_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: PostgresPluginConfig | null = null;
  private pool: PgPool | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validatePostgresConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.pool = new PgPool(toPoolOptions(cfg));
    const stateKey = cfg.stateKey ?? 'pg';
    const pool = this.pool;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = pool;
      await next();
    });
  }

  override async onUnload(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }

  /** The live pool (only after onLoad). */
  get db(): PgPool {
    if (!this.pool) throw new PluginError('Postgres plugin is not loaded');
    return this.pool;
  }

  private _config(): PostgresPluginConfig {
    if (!this.config) this.config = validatePostgresConfig(this.raw);
    return this.config;
  }
}
