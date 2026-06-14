// packages/plugin-mysql/src/index.ts
// Official StreetJS plugin: MySQL / MariaDB connection pool.
//
// Wraps the native, dependency-free `MysqlPool` shipped by streetjs (MySQL
// protocol client — no `mysql2`). Validates connection config and injects a
// ready pool into each request via the sandboxed middleware surface
// (requires 'middleware').

import {
  PluginModule, PluginError, MysqlPool,
  type SandboxedApp, type PluginManifest, type MysqlPoolOptions,
} from 'streetjs';

export const MYSQL_PLUGIN_NAME = 'street-plugin-mysql';
export const MYSQL_PLUGIN_VERSION = '1.0.0';

/** Configuration schema for the MySQL plugin. */
export interface MysqlPluginConfig {
  host: string;
  /** Default 3306. */
  port?: number;
  user: string;
  password: string;
  database: string;
  connectTimeoutMs?: number;
  minConnections?: number;
  maxConnections?: number;
  idleTimeoutMs?: number;
  acquireTimeoutMs?: number;
  /** State key under which the pool is injected. Default 'mysql'. */
  stateKey?: string;
}

/** The unsigned manifest for the MySQL plugin (sign it via the build step). */
export function mysqlPluginManifest(): PluginManifest {
  return {
    name: MYSQL_PLUGIN_NAME,
    version: MYSQL_PLUGIN_VERSION,
    capabilities: ['database', 'sql', 'mysql'],
    permissions: ['net', 'middleware'],
  };
}

function requireString(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new PluginError(`MySQL plugin config: "${k}" is required and must be a non-empty string`);
  }
  return v;
}

/**
 * Validate raw config against the MySQL plugin's schema. Throws
 * {@link PluginError} with a precise message on the first violation.
 */
export function validateMysqlConfig(input: unknown): MysqlPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('MySQL plugin config must be an object');
  }
  const o = input as Record<string, unknown>;

  const host = requireString(o, 'host');
  if (o['port'] !== undefined) {
    const port = o['port'];
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new PluginError('MySQL plugin config: "port" must be an integer in [1, 65535]');
    }
  }
  const user = requireString(o, 'user');
  const password = o['password'];
  if (typeof password !== 'string') {
    throw new PluginError('MySQL plugin config: "password" is required and must be a string');
  }
  const database = requireString(o, 'database');

  for (const k of ['connectTimeoutMs', 'minConnections', 'maxConnections', 'idleTimeoutMs', 'acquireTimeoutMs'] as const) {
    if (o[k] !== undefined && (typeof o[k] !== 'number' || (o[k] as number) < 0)) {
      throw new PluginError(`MySQL plugin config: "${k}" must be a non-negative number`);
    }
  }
  if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string') {
    throw new PluginError('MySQL plugin config: "stateKey" must be a string');
  }

  return {
    host, user, password, database,
    ...(o['port'] !== undefined ? { port: o['port'] as number } : {}),
    ...(o['connectTimeoutMs'] !== undefined ? { connectTimeoutMs: o['connectTimeoutMs'] as number } : {}),
    ...(o['minConnections'] !== undefined ? { minConnections: o['minConnections'] as number } : {}),
    ...(o['maxConnections'] !== undefined ? { maxConnections: o['maxConnections'] as number } : {}),
    ...(o['idleTimeoutMs'] !== undefined ? { idleTimeoutMs: o['idleTimeoutMs'] as number } : {}),
    ...(o['acquireTimeoutMs'] !== undefined ? { acquireTimeoutMs: o['acquireTimeoutMs'] as number } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
  };
}

/** Translate the plugin config into the core `MysqlPoolOptions`. */
export function toPoolOptions(cfg: MysqlPluginConfig): MysqlPoolOptions {
  return {
    host: cfg.host, user: cfg.user, password: cfg.password, database: cfg.database,
    ...(cfg.port !== undefined ? { port: cfg.port } : {}),
    ...(cfg.connectTimeoutMs !== undefined ? { connectTimeoutMs: cfg.connectTimeoutMs } : {}),
    ...(cfg.minConnections !== undefined ? { minConnections: cfg.minConnections } : {}),
    ...(cfg.maxConnections !== undefined ? { maxConnections: cfg.maxConnections } : {}),
    ...(cfg.idleTimeoutMs !== undefined ? { idleTimeoutMs: cfg.idleTimeoutMs } : {}),
    ...(cfg.acquireTimeoutMs !== undefined ? { acquireTimeoutMs: cfg.acquireTimeoutMs } : {}),
  };
}

/**
 * MySQL plugin. On load it constructs a {@link MysqlPool} (which connects
 * lazily) and injects it into each request's `ctx.state[stateKey]`.
 */
export class MysqlPlugin extends PluginModule {
  readonly name = MYSQL_PLUGIN_NAME;
  readonly version = MYSQL_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: MysqlPluginConfig | null = null;
  private pool: MysqlPool | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validateMysqlConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.pool = new MysqlPool(toPoolOptions(cfg));
    const stateKey = cfg.stateKey ?? 'mysql';
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
  get db(): MysqlPool {
    if (!this.pool) throw new PluginError('MySQL plugin is not loaded');
    return this.pool;
  }

  private _config(): MysqlPluginConfig {
    if (!this.config) this.config = validateMysqlConfig(this.raw);
    return this.config;
  }
}
