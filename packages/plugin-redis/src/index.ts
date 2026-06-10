// packages/plugin-redis/src/index.ts
// Official Street plugin: Redis cache / key-value store.
//
// A standalone package (outside @streetjs/core) that extends the core
// `PluginModule` SDK. It ships a dependency-free RESP2 client built on
// node:net — no vendor SDK is required — and injects a connected client into
// each request via the sandboxed middleware surface.

import { PluginModule, PluginError, type SandboxedApp, type PluginManifest } from 'streetjs';
import { Socket } from 'node:net';

export const REDIS_PLUGIN_NAME = 'street-plugin-redis';
export const REDIS_PLUGIN_VERSION = '1.0.0';

/** Configuration schema for the Redis plugin. */
export interface RedisPluginConfig {
  host: string;
  port: number;
  /** Optional AUTH password (Redis ≥ 6 ignores the username when omitted). */
  password?: string;
  /** Logical DB index to SELECT after connecting. Default 0. */
  db?: number;
  /** Connect/command timeout in milliseconds. Default 5000. */
  timeoutMs?: number;
  /** State key under which the client is injected by the middleware. Default 'redis'. */
  stateKey?: string;
}

/** The unsigned manifest for the Redis plugin (sign it via the build step). */
export function redisPluginManifest(): PluginManifest {
  return {
    name: REDIS_PLUGIN_NAME,
    version: REDIS_PLUGIN_VERSION,
    capabilities: ['cache', 'key-value', 'redis'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

/**
 * Validate raw config against the Redis plugin's schema. Throws
 * {@link PluginError} with a precise message on the first violation.
 */
export function validateRedisConfig(input: unknown): RedisPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('Redis plugin config must be an object');
  }
  const o = input as Record<string, unknown>;

  const host = o['host'];
  if (typeof host !== 'string' || host.trim() === '') {
    throw new PluginError('Redis plugin config: "host" is required and must be a non-empty string');
  }
  const port = o['port'];
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PluginError('Redis plugin config: "port" is required and must be an integer in [1, 65535]');
  }
  if (o['password'] !== undefined && typeof o['password'] !== 'string') {
    throw new PluginError('Redis plugin config: "password" must be a string');
  }
  if (o['db'] !== undefined && (typeof o['db'] !== 'number' || !Number.isInteger(o['db']) || o['db'] < 0)) {
    throw new PluginError('Redis plugin config: "db" must be a non-negative integer');
  }
  if (o['timeoutMs'] !== undefined && (typeof o['timeoutMs'] !== 'number' || o['timeoutMs'] <= 0)) {
    throw new PluginError('Redis plugin config: "timeoutMs" must be a positive number');
  }
  if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string') {
    throw new PluginError('Redis plugin config: "stateKey" must be a string');
  }

  return {
    host,
    port,
    ...(o['password'] !== undefined ? { password: o['password'] as string } : {}),
    ...(o['db'] !== undefined ? { db: o['db'] as number } : {}),
    ...(o['timeoutMs'] !== undefined ? { timeoutMs: o['timeoutMs'] as number } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
  };
}

/** A RESP value returned by Redis. */
export type RedisReply = string | number | null | RedisReply[];

/** Encode a Redis command as a RESP2 array of bulk strings. */
export function encodeCommand(args: string[]): Buffer {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const buf = Buffer.from(a, 'utf8');
    out += `$${buf.length}\r\n${a}\r\n`;
  }
  return Buffer.from(out, 'utf8');
}

/**
 * Incremental RESP2 parser. Feed it bytes; it returns the next complete reply
 * and the number of bytes consumed, or `null` when more data is needed.
 */
export function parseReply(buf: Buffer, offset = 0): { value: RedisReply; next: number } | null {
  if (offset >= buf.length) return null;
  const type = String.fromCharCode(buf[offset]!);
  const lineEnd = buf.indexOf('\r\n', offset + 1, 'utf8');
  if (lineEnd === -1) return null;
  const line = buf.toString('utf8', offset + 1, lineEnd);
  const afterLine = lineEnd + 2;

  switch (type) {
    case '+':
      return { value: line, next: afterLine };
    case '-':
      throw new PluginError(`Redis error: ${line}`);
    case ':':
      return { value: Number.parseInt(line, 10), next: afterLine };
    case '$': {
      const len = Number.parseInt(line, 10);
      if (len === -1) return { value: null, next: afterLine };
      const end = afterLine + len;
      if (buf.length < end + 2) return null;
      return { value: buf.toString('utf8', afterLine, end), next: end + 2 };
    }
    case '*': {
      const count = Number.parseInt(line, 10);
      if (count === -1) return { value: null, next: afterLine };
      const items: RedisReply[] = [];
      let cursor = afterLine;
      for (let i = 0; i < count; i++) {
        const r = parseReply(buf, cursor);
        if (r === null) return null;
        items.push(r.value);
        cursor = r.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new PluginError(`Redis: unsupported reply type "${type}"`);
  }
}

/**
 * Minimal, dependency-free Redis client speaking RESP2 over a TCP socket.
 * Commands are serialized (one in flight at a time) which is sufficient for a
 * reference plugin and deterministic integration testing.
 */
export class RedisClient {
  private socket: Socket | null = null;
  private readonly queue: Array<{
    resolve: (v: RedisReply) => void;
    reject: (e: Error) => void;
  }> = [];
  private inbound = Buffer.alloc(0);

  constructor(private readonly config: RedisPluginConfig) {}

  private get timeout(): number {
    return this.config.timeoutMs ?? 5000;
  }

  /** Open the connection and perform AUTH / SELECT as configured. */
  async connect(): Promise<void> {
    if (this.socket) return;
    await new Promise<void>((resolve, reject) => {
      const sock = new Socket();
      const onError = (err: Error): void => {
        sock.destroy();
        reject(new PluginError(`Redis connect failed: ${err.message}`));
      };
      sock.setTimeout(this.timeout, () => onError(new Error('connect timeout')));
      sock.once('error', onError);
      sock.connect(this.config.port, this.config.host, () => {
        sock.setTimeout(0);
        sock.removeListener('error', onError);
        sock.on('data', (chunk: Buffer | string) => this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        sock.on('error', (err) => this.failAll(err));
        sock.on('close', () => this.failAll(new Error('connection closed')));
        this.socket = sock;
        resolve();
      });
    });

    if (this.config.password !== undefined) {
      await this.command('AUTH', this.config.password);
    }
    if (this.config.db !== undefined && this.config.db !== 0) {
      await this.command('SELECT', String(this.config.db));
    }
  }

  private onData(chunk: Buffer): void {
    this.inbound = Buffer.concat([this.inbound, chunk]);
    // Drain as many complete replies as are buffered.
    for (;;) {
      const pending = this.queue[0];
      if (!pending) break;
      let parsed: { value: RedisReply; next: number } | null;
      try {
        parsed = parseReply(this.inbound, 0);
      } catch (err) {
        this.queue.shift();
        this.inbound = Buffer.alloc(0);
        pending.reject(err as Error);
        continue;
      }
      if (parsed === null) break;
      this.queue.shift();
      this.inbound = this.inbound.subarray(parsed.next);
      pending.resolve(parsed.value);
    }
  }

  private failAll(err: Error): void {
    const e = new PluginError(`Redis: ${err.message}`);
    while (this.queue.length > 0) this.queue.shift()!.reject(e);
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /** Send a command and await its reply. */
  command(...args: string[]): Promise<RedisReply> {
    const sock = this.socket;
    if (!sock) return Promise.reject(new PluginError('Redis client is not connected'));
    return new Promise<RedisReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PluginError('Redis command timeout')), this.timeout);
      this.queue.push({
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      sock.write(encodeCommand(args));
    });
  }

  ping(): Promise<RedisReply> {
    return this.command('PING');
  }

  get(key: string): Promise<string | null> {
    return this.command('GET', key) as Promise<string | null>;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) await this.command('SET', key, value, 'EX', String(ttlSeconds));
    else await this.command('SET', key, value);
  }

  del(key: string): Promise<RedisReply> {
    return this.command('DEL', key);
  }

  /** Close the socket. */
  async quit(): Promise<void> {
    if (!this.socket) return;
    try {
      await this.command('QUIT');
    } catch {
      // ignore — we are tearing down
    }
    this.socket?.destroy();
    this.socket = null;
  }
}

/**
 * Redis plugin. On load it connects a {@link RedisClient} and injects it into
 * each request's `ctx.state[stateKey]` (requires the 'middleware' permission).
 */
export class RedisPlugin extends PluginModule {
  readonly name = REDIS_PLUGIN_NAME;
  readonly version = REDIS_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: RedisPluginConfig | null = null;
  private client: RedisClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  /** Validate configuration once at install time. */
  async onInstall(): Promise<void> {
    this.config = validateRedisConfig(this.raw);
  }

  /** Connect the client and register the injection middleware. */
  async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new RedisClient(cfg);
    await this.client.connect();
    const stateKey = cfg.stateKey ?? 'redis';
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  /** Disconnect the client. */
  async onUnload(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  /** The live client (only after onLoad). */
  get cache(): RedisClient {
    if (!this.client) throw new PluginError('Redis plugin is not loaded');
    return this.client;
  }

  private _config(): RedisPluginConfig {
    if (!this.config) this.config = validateRedisConfig(this.raw);
    return this.config;
  }
}
