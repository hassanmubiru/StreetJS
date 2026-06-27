// packages/plugin-nats/src/index.ts
// Official StreetJS plugin: NATS publish/subscribe messaging.
//
// A standalone package (outside streetjs core) that extends the core
// `PluginModule` SDK. It ships a dependency-free NATS client built on
// node:net speaking the NATS text protocol — no vendor SDK is required — and
// injects a connected client into each request via the sandboxed middleware
// surface (requires the 'middleware' permission).
//
// Protocol reference (NATS client protocol):
//   server → client: INFO {json}\r\n,  MSG <subj> <sid> [reply] <#bytes>\r\n<payload>\r\n,
//                    PING\r\n, PONG\r\n, +OK\r\n, -ERR <msg>\r\n
//   client → server: CONNECT {json}\r\n, PUB <subj> [reply] <#bytes>\r\n<payload>\r\n,
//                    SUB <subj> [queue] <sid>\r\n, UNSUB <sid> [max]\r\n, PING/PONG

import { PluginModule, PluginError, type SandboxedApp, type PluginManifest } from 'streetjs';
import { Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export const NATS_PLUGIN_NAME = 'street-plugin-nats';
export const NATS_PLUGIN_VERSION = '1.0.0';

const CRLF = '\r\n';

/** Configuration schema for the NATS plugin. */
export interface NatsPluginConfig {
  host: string;
  port: number;
  /** Optional token authentication. */
  token?: string;
  /** Optional username (paired with password). */
  user?: string;
  /** Optional password (paired with user). */
  pass?: string;
  /** Connection name advertised to the server. Default 'streetjs'. */
  name?: string;
  /** Connect/flush timeout in milliseconds. Default 5000. */
  timeoutMs?: number;
  /** State key under which the client is injected by the middleware. Default 'nats'. */
  stateKey?: string;
  /** Connect over TLS. Default false (plain TCP — unchanged). */
  tls?: boolean;
  /** When TLS is on, verify the server certificate chain. Default true. */
  tlsRejectUnauthorized?: boolean;
  /** When TLS is on, the SNI server name to present (defaults to `host`). */
  tlsServerName?: string;
  /** When TLS is on, a PEM CA bundle to trust (for private/self-signed CAs). */
  tlsCa?: string;
}

/** The unsigned manifest for the NATS plugin (sign it via the build step). */
export function natsPluginManifest(): PluginManifest {
  return {
    name: NATS_PLUGIN_NAME,
    version: NATS_PLUGIN_VERSION,
    capabilities: ['messaging', 'pubsub', 'nats'],
    permissions: ['net', 'middleware'],
  };
}

/**
 * Validate raw config against the NATS plugin's schema. Throws
 * {@link PluginError} with a precise message on the first violation.
 */
export function validateNatsConfig(input: unknown): NatsPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('NATS plugin config must be an object');
  }
  const o = input as Record<string, unknown>;

  const host = o['host'];
  if (typeof host !== 'string' || host.trim() === '') {
    throw new PluginError('NATS plugin config: "host" is required and must be a non-empty string');
  }
  const port = o['port'];
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PluginError('NATS plugin config: "port" is required and must be an integer in [1, 65535]');
  }
  for (const k of ['token', 'user', 'pass', 'name', 'stateKey'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      throw new PluginError(`NATS plugin config: "${k}" must be a string`);
    }
  }
  if ((o['user'] !== undefined) !== (o['pass'] !== undefined)) {
    throw new PluginError('NATS plugin config: "user" and "pass" must be provided together');
  }
  if (o['timeoutMs'] !== undefined && (typeof o['timeoutMs'] !== 'number' || o['timeoutMs'] <= 0)) {
    throw new PluginError('NATS plugin config: "timeoutMs" must be a positive number');
  }
  if (o['tls'] !== undefined && typeof o['tls'] !== 'boolean') {
    throw new PluginError('NATS plugin config: "tls" must be a boolean');
  }
  if (o['tlsRejectUnauthorized'] !== undefined && typeof o['tlsRejectUnauthorized'] !== 'boolean') {
    throw new PluginError('NATS plugin config: "tlsRejectUnauthorized" must be a boolean');
  }
  for (const k of ['tlsServerName', 'tlsCa'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      throw new PluginError(`NATS plugin config: "${k}" must be a string`);
    }
  }

  return {
    host,
    port,
    ...(o['token'] !== undefined ? { token: o['token'] as string } : {}),
    ...(o['user'] !== undefined ? { user: o['user'] as string } : {}),
    ...(o['pass'] !== undefined ? { pass: o['pass'] as string } : {}),
    ...(o['name'] !== undefined ? { name: o['name'] as string } : {}),
    ...(o['timeoutMs'] !== undefined ? { timeoutMs: o['timeoutMs'] as number } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
    ...(o['tls'] !== undefined ? { tls: o['tls'] as boolean } : {}),
    ...(o['tlsRejectUnauthorized'] !== undefined ? { tlsRejectUnauthorized: o['tlsRejectUnauthorized'] as boolean } : {}),
    ...(o['tlsServerName'] !== undefined ? { tlsServerName: o['tlsServerName'] as string } : {}),
    ...(o['tlsCa'] !== undefined ? { tlsCa: o['tlsCa'] as string } : {}),
  };
}

/** A subject string is valid when non-empty and free of whitespace and the NUL byte. */
export function isValidSubject(subject: string): boolean {
  return typeof subject === 'string' && subject.length > 0 && !/[\s\0]/.test(subject);
}

/** Build the CONNECT control line from the connect options the client advertises. */
export function encodeConnect(opts: {
  token?: string;
  user?: string;
  pass?: string;
  name?: string;
  verbose?: boolean;
  pedantic?: boolean;
}): Buffer {
  const body: Record<string, unknown> = {
    verbose: opts.verbose ?? false,
    pedantic: opts.pedantic ?? false,
    tls_required: false,
    name: opts.name ?? 'streetjs',
    lang: 'typescript',
    version: NATS_PLUGIN_VERSION,
    protocol: 1,
  };
  if (opts.token !== undefined) body['auth_token'] = opts.token;
  if (opts.user !== undefined) body['user'] = opts.user;
  if (opts.pass !== undefined) body['pass'] = opts.pass;
  return Buffer.from(`CONNECT ${JSON.stringify(body)}${CRLF}`, 'utf8');
}

/** Encode a PUB frame: `PUB <subject> [reply] <#bytes>\r\n<payload>\r\n`. */
export function encodePub(subject: string, payload: Buffer | string, replyTo?: string): Buffer {
  if (!isValidSubject(subject)) throw new PluginError(`NATS: invalid subject "${subject}"`);
  if (replyTo !== undefined && !isValidSubject(replyTo)) {
    throw new PluginError(`NATS: invalid reply subject "${replyTo}"`);
  }
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const head = replyTo !== undefined
    ? `PUB ${subject} ${replyTo} ${data.length}${CRLF}`
    : `PUB ${subject} ${data.length}${CRLF}`;
  return Buffer.concat([Buffer.from(head, 'utf8'), data, Buffer.from(CRLF, 'utf8')]);
}

/** Encode a SUB frame: `SUB <subject> [queue] <sid>\r\n`. */
export function encodeSub(subject: string, sid: number, queue?: string): Buffer {
  if (!isValidSubject(subject)) throw new PluginError(`NATS: invalid subject "${subject}"`);
  if (!Number.isInteger(sid) || sid < 0) throw new PluginError(`NATS: invalid sid "${sid}"`);
  const line = queue !== undefined
    ? `SUB ${subject} ${queue} ${sid}${CRLF}`
    : `SUB ${subject} ${sid}${CRLF}`;
  return Buffer.from(line, 'utf8');
}

/** Encode an UNSUB frame: `UNSUB <sid> [max_msgs]\r\n`. */
export function encodeUnsub(sid: number, maxMsgs?: number): Buffer {
  if (!Number.isInteger(sid) || sid < 0) throw new PluginError(`NATS: invalid sid "${sid}"`);
  const line = maxMsgs !== undefined ? `UNSUB ${sid} ${maxMsgs}${CRLF}` : `UNSUB ${sid}${CRLF}`;
  return Buffer.from(line, 'utf8');
}

/** A parsed protocol frame from the server. */
export type NatsFrame =
  | { kind: 'INFO'; info: Record<string, unknown> }
  | { kind: 'MSG'; subject: string; sid: number; reply?: string; payload: Buffer }
  | { kind: 'PING' }
  | { kind: 'PONG' }
  | { kind: 'OK' }
  | { kind: 'ERR'; message: string };

/**
 * Incremental NATS protocol parser. Feed it the inbound buffer; it returns the
 * next complete frame and the number of bytes consumed, or `null` when more
 * data is needed. Throws {@link PluginError} on a malformed control line.
 */
export function parseFrame(buf: Buffer, offset = 0): { frame: NatsFrame; next: number } | null {
  const lineEnd = buf.indexOf('\r\n', offset, 'utf8');
  if (lineEnd === -1) return null;
  const line = buf.toString('utf8', offset, lineEnd);
  const afterLine = lineEnd + 2;
  const space = line.indexOf(' ');
  const op = (space === -1 ? line : line.slice(0, space)).toUpperCase();
  const rest = space === -1 ? '' : line.slice(space + 1).trim();

  switch (op) {
    case 'PING':
      return { frame: { kind: 'PING' }, next: afterLine };
    case 'PONG':
      return { frame: { kind: 'PONG' }, next: afterLine };
    case '+OK':
      return { frame: { kind: 'OK' }, next: afterLine };
    case '-ERR':
      return { frame: { kind: 'ERR', message: rest.replace(/^'|'$/g, '') }, next: afterLine };
    case 'INFO': {
      let info: Record<string, unknown>;
      try {
        info = JSON.parse(rest) as Record<string, unknown>;
      } catch {
        throw new PluginError('NATS: malformed INFO payload');
      }
      return { frame: { kind: 'INFO', info }, next: afterLine };
    }
    case 'MSG': {
      // MSG <subject> <sid> [reply-to] <#bytes>
      const parts = rest.split(/\s+/);
      if (parts.length < 3 || parts.length > 4) {
        throw new PluginError(`NATS: malformed MSG header "${line}"`);
      }
      const subject = parts[0]!;
      const sid = Number.parseInt(parts[1]!, 10);
      const reply = parts.length === 4 ? parts[2] : undefined;
      const nBytes = Number.parseInt(parts[parts.length - 1]!, 10);
      if (!Number.isInteger(sid) || !Number.isInteger(nBytes) || nBytes < 0) {
        throw new PluginError(`NATS: malformed MSG header "${line}"`);
      }
      const payloadEnd = afterLine + nBytes;
      if (buf.length < payloadEnd + 2) return null; // need full payload + trailing CRLF
      const payload = buf.subarray(afterLine, payloadEnd);
      return {
        frame: { kind: 'MSG', subject, sid, ...(reply !== undefined ? { reply } : {}), payload },
        next: payloadEnd + 2,
      };
    }
    default:
      throw new PluginError(`NATS: unsupported protocol op "${op}"`);
  }
}

/** A delivered message handed to a subscription handler. */
export interface NatsMessage {
  subject: string;
  sid: number;
  reply?: string;
  data: Buffer;
}

/** Subscription handler signature. */
export type NatsHandler = (msg: NatsMessage) => void;

/**
 * Minimal, dependency-free NATS client speaking the NATS text protocol over a
 * TCP socket. Sufficient for a reference plugin and deterministic testing.
 */
export class NatsClient {
  private socket: Socket | null = null;
  private inbound = Buffer.alloc(0);
  private sidCounter = 0;
  private readonly subs = new Map<number, NatsHandler>();
  private pongWaiters: Array<() => void> = [];

  constructor(private readonly config: NatsPluginConfig) {}

  private get timeout(): number {
    return this.config.timeoutMs ?? 5000;
  }

  /** Open the connection, await the server INFO, send CONNECT, and verify with PING/PONG. */
  async connect(): Promise<void> {
    if (this.socket) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        sock.destroy();
        reject(new PluginError(`NATS connect failed: ${err.message}`));
      };
      const onConnected = (): void => {
        sock.setTimeout(0);
        sock.removeListener('error', onError);
        sock.on('data', (chunk: Buffer | string) =>
          this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        sock.on('error', (err) => this.failAll(err));
        sock.on('close', () => this.failAll(new Error('connection closed')));
        this.socket = sock;
        resolve();
      };
      let sock: Socket;
      if (this.config.tls) {
        sock = tlsConnect({
          host: this.config.host,
          port: this.config.port,
          rejectUnauthorized: this.config.tlsRejectUnauthorized ?? true,
          servername: this.config.tlsServerName ?? this.config.host,
          ...(this.config.tlsCa !== undefined ? { ca: this.config.tlsCa } : {}),
        }, onConnected);
        sock.setTimeout(this.timeout, () => onError(new Error('connect timeout')));
        sock.once('error', onError);
      } else {
        sock = new Socket();
        sock.setTimeout(this.timeout, () => onError(new Error('connect timeout')));
        sock.once('error', onError);
        sock.connect(this.config.port, this.config.host, onConnected);
      }
    });

    // Greet: advertise CONNECT options, then round-trip a PING to confirm.
    this.write(encodeConnect({
      ...(this.config.token !== undefined ? { token: this.config.token } : {}),
      ...(this.config.user !== undefined ? { user: this.config.user } : {}),
      ...(this.config.pass !== undefined ? { pass: this.config.pass } : {}),
      name: this.config.name ?? 'streetjs',
    }));
    await this.flush();
  }

  private write(buf: Buffer): void {
    if (!this.socket) throw new PluginError('NATS client is not connected');
    this.socket.write(buf);
  }

  private onData(chunk: Buffer): void {
    this.inbound = Buffer.concat([this.inbound, chunk]);
    for (;;) {
      let parsed: { frame: NatsFrame; next: number } | null;
      try {
        parsed = parseFrame(this.inbound, 0);
      } catch (err) {
        this.failAll(err as Error);
        return;
      }
      if (parsed === null) break;
      this.inbound = this.inbound.subarray(parsed.next);
      this.handleFrame(parsed.frame);
    }
  }

  private handleFrame(frame: NatsFrame): void {
    switch (frame.kind) {
      case 'PING':
        // Server heartbeat — must reply PONG to stay connected.
        if (this.socket) this.socket.write(Buffer.from(`PONG${CRLF}`, 'utf8'));
        break;
      case 'PONG': {
        const waiter = this.pongWaiters.shift();
        if (waiter) waiter();
        break;
      }
      case 'MSG': {
        const handler = this.subs.get(frame.sid);
        if (handler) {
          handler({
            subject: frame.subject,
            sid: frame.sid,
            ...(frame.reply !== undefined ? { reply: frame.reply } : {}),
            data: frame.payload,
          });
        }
        break;
      }
      case 'ERR':
        this.failAll(new Error(frame.message));
        break;
      case 'INFO':
      case 'OK':
        break;
    }
  }

  private failAll(err: Error): void {
    const e = new PluginError(`NATS: ${err.message}`);
    const waiters = this.pongWaiters;
    this.pongWaiters = [];
    for (const w of waiters) w(); // unblock flush waiters; the error surfaces via subsequent ops
    void e;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /** Publish a message to a subject, optionally with a reply subject. */
  publish(subject: string, payload: Buffer | string, replyTo?: string): void {
    this.write(encodePub(subject, payload, replyTo));
  }

  /** Subscribe to a subject (optionally within a queue group); returns the sid. */
  subscribe(subject: string, handler: NatsHandler, queue?: string): number {
    const sid = ++this.sidCounter;
    this.subs.set(sid, handler);
    this.write(encodeSub(subject, sid, queue));
    return sid;
  }

  /** Unsubscribe a subscription id. */
  unsubscribe(sid: number, maxMsgs?: number): void {
    if (maxMsgs === undefined) this.subs.delete(sid);
    this.write(encodeUnsub(sid, maxMsgs));
  }

  /** Round-trip a PING/PONG so callers can confirm the server processed prior frames. */
  flush(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PluginError('NATS flush timeout')), this.timeout);
      this.pongWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
      try {
        this.write(Buffer.from(`PING${CRLF}`, 'utf8'));
      } catch (err) {
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  /** Close the socket. */
  async close(): Promise<void> {
    if (!this.socket) return;
    this.socket.destroy();
    this.socket = null;
    this.subs.clear();
  }
}

/**
 * NATS plugin. On load it connects a {@link NatsClient} and injects it into
 * each request's `ctx.state[stateKey]` (requires the 'middleware' permission).
 */
export class NatsPlugin extends PluginModule {
  readonly name = NATS_PLUGIN_NAME;
  readonly version = NATS_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: NatsPluginConfig | null = null;
  private client: NatsClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  /** Validate configuration once at install time. */
  override async onInstall(): Promise<void> {
    this.config = validateNatsConfig(this.raw);
  }

  /** Connect the client and register the injection middleware. */
  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new NatsClient(cfg);
    await this.client.connect();
    const stateKey = cfg.stateKey ?? 'nats';
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  /** Disconnect the client. */
  override async onUnload(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /** The live client (only after onLoad). */
  get messaging(): NatsClient {
    if (!this.client) throw new PluginError('NATS plugin is not loaded');
    return this.client;
  }

  private _config(): NatsPluginConfig {
    if (!this.config) this.config = validateNatsConfig(this.raw);
    return this.config;
  }
}
