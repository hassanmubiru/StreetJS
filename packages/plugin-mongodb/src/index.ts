// packages/plugin-mongodb/src/index.ts
// Official StreetJS plugin: MongoDB.
//
// A standalone package that extends the core `PluginModule` SDK and ships a
// dependency-free MongoDB client built on node:net + node:crypto — BSON codec,
// OP_MSG wire framing, and SCRAM-SHA-256 auth, with no vendor driver. The codec
// and auth primitives (./bson, ./opmsg, ./scram) are pure and offline-verified;
// the client performs the live find/insert/command I/O against a mongod.

import { PluginModule, PluginError, type SandboxedApp, type PluginManifest } from 'streetjs';
import { Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { type BsonDocument, BsonBinary, encodeDocument } from './bson.js';
import { encodeOpMsg, parseOpMsg, type OpMsgReply } from './opmsg.js';
import {
  clientFirstBare, parseServerFirst, computeClientProof, verifyServerSignature, generateNonce,
} from './scram.js';

export { ObjectId, BsonBinary, BsonError, encodeDocument, decodeDocument } from './bson.js';
export type { BsonDocument, BsonValue } from './bson.js';
export { encodeOpMsg, parseOpMsg, OP_MSG } from './opmsg.js';
export {
  clientFirstBare, parseServerFirst, computeClientProof, verifyServerSignature,
  escapeUsername, generateNonce,
} from './scram.js';

export const MONGODB_PLUGIN_NAME = 'street-plugin-mongodb';
export const MONGODB_PLUGIN_VERSION = '1.0.0';

export interface MongoPluginConfig {
  host: string;
  /** Default 27017. */
  port?: number;
  database: string;
  user?: string;
  password?: string;
  /** Auth database. Default 'admin'. */
  authSource?: string;
  /** Connect/command timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** State key under which the client is injected. Default 'mongo'. */
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

export function mongoPluginManifest(): PluginManifest {
  return {
    name: MONGODB_PLUGIN_NAME,
    version: MONGODB_PLUGIN_VERSION,
    capabilities: ['database', 'document-store', 'mongodb'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validateMongoConfig(input: unknown): MongoPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('MongoDB plugin config must be an object');
  }
  const o = input as Record<string, unknown>;
  if (typeof o['host'] !== 'string' || (o['host'] as string).trim() === '') {
    throw new PluginError('MongoDB plugin config: "host" is required and must be a non-empty string');
  }
  if (typeof o['database'] !== 'string' || (o['database'] as string).trim() === '') {
    throw new PluginError('MongoDB plugin config: "database" is required and must be a non-empty string');
  }
  if (o['port'] !== undefined) {
    const port = o['port'];
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new PluginError('MongoDB plugin config: "port" must be an integer in [1, 65535]');
    }
  }
  for (const k of ['user', 'password', 'authSource', 'stateKey'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      throw new PluginError(`MongoDB plugin config: "${k}" must be a string`);
    }
  }
  if ((o['user'] !== undefined) !== (o['password'] !== undefined)) {
    throw new PluginError('MongoDB plugin config: "user" and "password" must be provided together');
  }
  if (o['timeoutMs'] !== undefined && (typeof o['timeoutMs'] !== 'number' || (o['timeoutMs'] as number) <= 0)) {
    throw new PluginError('MongoDB plugin config: "timeoutMs" must be a positive number');
  }
  if (o['tls'] !== undefined && typeof o['tls'] !== 'boolean') {
    throw new PluginError('MongoDB plugin config: "tls" must be a boolean');
  }
  if (o['tlsRejectUnauthorized'] !== undefined && typeof o['tlsRejectUnauthorized'] !== 'boolean') {
    throw new PluginError('MongoDB plugin config: "tlsRejectUnauthorized" must be a boolean');
  }
  for (const k of ['tlsServerName', 'tlsCa'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      throw new PluginError(`MongoDB plugin config: "${k}" must be a string`);
    }
  }
  return {
    host: o['host'] as string,
    database: o['database'] as string,
    ...(o['port'] !== undefined ? { port: o['port'] as number } : {}),
    ...(o['user'] !== undefined ? { user: o['user'] as string } : {}),
    ...(o['password'] !== undefined ? { password: o['password'] as string } : {}),
    ...(o['authSource'] !== undefined ? { authSource: o['authSource'] as string } : {}),
    ...(o['timeoutMs'] !== undefined ? { timeoutMs: o['timeoutMs'] as number } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
    ...(o['tls'] !== undefined ? { tls: o['tls'] as boolean } : {}),
    ...(o['tlsRejectUnauthorized'] !== undefined ? { tlsRejectUnauthorized: o['tlsRejectUnauthorized'] as boolean } : {}),
    ...(o['tlsServerName'] !== undefined ? { tlsServerName: o['tlsServerName'] as string } : {}),
    ...(o['tlsCa'] !== undefined ? { tlsCa: o['tlsCa'] as string } : {}),
  };
}

/**
 * Minimal, dependency-free MongoDB client (BSON + OP_MSG + SCRAM-SHA-256).
 * One command in flight at a time, which is sufficient for a reference plugin.
 */
export class MongoClient {
  private socket: Socket | null = null;
  private inbound = Buffer.alloc(0);
  private requestId = 0;
  private pending: { resolve: (r: OpMsgReply) => void; reject: (e: Error) => void } | null = null;

  constructor(private readonly config: MongoPluginConfig) {}

  private get timeout(): number {
    return this.config.timeoutMs ?? 10000;
  }

  /** Open the TCP connection and authenticate (when credentials are present). */
  async connect(): Promise<void> {
    if (this.socket) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => { sock.destroy(); reject(new PluginError(`Mongo connect failed: ${err.message}`)); };
      const onConnected = (): void => {
        sock.setTimeout(0);
        sock.removeListener('error', onError);
        sock.on('data', (c: Buffer | string) => this.onData(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        sock.on('error', (e) => this.failPending(e));
        sock.on('close', () => this.failPending(new Error('connection closed')));
        this.socket = sock;
        resolve();
      };
      let sock: Socket;
      if (this.config.tls) {
        sock = tlsConnect({
          host: this.config.host,
          port: this.config.port ?? 27017,
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
        sock.connect(this.config.port ?? 27017, this.config.host, onConnected);
      }
    });

    // Handshake (hello). Required before commands on modern servers.
    await this.runCommand({ hello: 1 }, this.config.authSource ?? 'admin');
    if (this.config.user !== undefined && this.config.password !== undefined) {
      await this.authenticate(this.config.user, this.config.password);
    }
  }

  private onData(chunk: Buffer): void {
    this.inbound = Buffer.concat([this.inbound, chunk]);
    for (;;) {
      let reply: OpMsgReply | null;
      try {
        reply = parseOpMsg(this.inbound);
      } catch (err) {
        this.failPending(err as Error);
        return;
      }
      if (reply === null) break;
      this.inbound = this.inbound.subarray(reply.messageLength);
      const p = this.pending;
      this.pending = null;
      if (p) p.resolve(reply);
    }
  }

  private failPending(err: Error): void {
    const e = new PluginError(`Mongo: ${err.message}`);
    const p = this.pending;
    this.pending = null;
    if (p) p.reject(e);
    if (this.socket) { this.socket.destroy(); this.socket = null; }
  }

  /** Run a single command against `db`, returning the response document. */
  runCommand(command: BsonDocument, db?: string): Promise<BsonDocument> {
    const sock = this.socket;
    if (!sock) return Promise.reject(new PluginError('Mongo client is not connected'));
    if (this.pending) return Promise.reject(new PluginError('Mongo: a command is already in flight'));
    const full: BsonDocument = { ...command, $db: db ?? this.config.database };
    const id = ++this.requestId;
    return new Promise<BsonDocument>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = null; reject(new PluginError('Mongo command timeout')); }, this.timeout);
      this.pending = {
        resolve: (r) => { clearTimeout(timer); resolve(r.document); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      sock.write(encodeOpMsg(id, full));
    });
  }

  private async authenticate(user: string, password: string): Promise<void> {
    const authDb = this.config.authSource ?? 'admin';
    const nonce = generateNonce();
    const cfb = clientFirstBare(user, nonce);
    const start = await this.runCommand({
      saslStart: 1,
      mechanism: 'SCRAM-SHA-256',
      payload: new BsonBinary(Buffer.from(`n,,${cfb}`, 'utf8')),
      options: { skipEmptyExchange: true },
    }, authDb);
    if (start['ok'] !== 1 && start['ok'] !== true) throw new PluginError(`Mongo saslStart failed: ${JSON.stringify(start)}`);

    const conversationId = start['conversationId'] as number;
    const serverFirstRaw = (start['payload'] as BsonBinary).data.toString('utf8');
    const serverFirst = parseServerFirst(serverFirstRaw);
    const proof = computeClientProof({ password, clientFirstBare: cfb, serverFirst });

    const cont = await this.runCommand({
      saslContinue: 1,
      conversationId,
      payload: new BsonBinary(Buffer.from(proof.clientFinal, 'utf8')),
    }, authDb);
    if (cont['ok'] !== 1 && cont['ok'] !== true) throw new PluginError('Mongo saslContinue failed');
    const serverFinal = (cont['payload'] as BsonBinary).data.toString('utf8');
    if (!verifyServerSignature(serverFinal, proof.serverSignature)) {
      throw new PluginError('Mongo: server signature verification failed');
    }
    // Drain a final empty exchange if the server has not marked the auth done.
    if (cont['done'] !== true) {
      await this.runCommand({ saslContinue: 1, conversationId, payload: new BsonBinary(Buffer.alloc(0)) }, authDb);
    }
  }

  /** Find documents in a collection. Returns the first batch. */
  async find(collection: string, filter: BsonDocument = {}, opts: { limit?: number } = {}): Promise<BsonDocument[]> {
    const res = await this.runCommand({
      find: collection,
      filter,
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });
    if (res['ok'] !== 1 && res['ok'] !== true) throw new PluginError(`Mongo find failed: ${JSON.stringify(res)}`);
    const cursor = res['cursor'] as BsonDocument | undefined;
    return (cursor?.['firstBatch'] as BsonDocument[]) ?? [];
  }

  /** Insert one document into a collection. */
  async insertOne(collection: string, doc: BsonDocument): Promise<BsonDocument> {
    const res = await this.runCommand({ insert: collection, documents: [doc] });
    if (res['ok'] !== 1 && res['ok'] !== true) throw new PluginError(`Mongo insert failed: ${JSON.stringify(res)}`);
    return res;
  }

  /** Close the socket. */
  async close(): Promise<void> {
    if (this.socket) { this.socket.destroy(); this.socket = null; }
  }
}

export class MongoDbPlugin extends PluginModule {
  readonly name = MONGODB_PLUGIN_NAME;
  readonly version = MONGODB_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: MongoPluginConfig | null = null;
  private client: MongoClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validateMongoConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new MongoClient(cfg);
    await this.client.connect();
    const stateKey = cfg.stateKey ?? 'mongo';
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  override async onUnload(): Promise<void> {
    if (this.client) { await this.client.close(); this.client = null; }
  }

  get db(): MongoClient {
    if (!this.client) throw new PluginError('MongoDB plugin is not loaded');
    return this.client;
  }

  private _config(): MongoPluginConfig {
    if (!this.config) this.config = validateMongoConfig(this.raw);
    return this.config;
  }
}

/** Convenience: encode a command document to its BSON bytes (testable seam). */
export function encodeCommand(command: BsonDocument): Buffer {
  return encodeDocument(command);
}
