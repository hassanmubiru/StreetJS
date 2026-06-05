// src/database/mysql/wire.ts
// MySQL Client/Server Protocol v4.1 wire driver.
// Pure node:net + node:crypto — no external dependencies.

import { createConnection, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { DbResult } from '../types.js';

// ─── Capability Flags ──────────────────────────────────────────────────────────
const CLIENT_PROTOCOL_41            = 0x0000_0200;
const CLIENT_SECURE_CONNECTION      = 0x0000_8000;
const CLIENT_PLUGIN_AUTH            = 0x0008_0000;
const CLIENT_PLUGIN_AUTH_LENENC_DATA= 0x0020_0000;
const CLIENT_CONNECT_WITH_DB        = 0x0000_0008;
const CLIENT_LONG_FLAG              = 0x0000_0004;

// ─── Commands ─────────────────────────────────────────────────────────────────
const COM_QUIT         = 0x01;
const COM_QUERY        = 0x03;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const COM_STMT_CLOSE   = 0x19;

// ─── MySQL FIELD TYPE constants ────────────────────────────────────────────────
const FIELD_TYPE_NULL    = 0x06;
const FIELD_TYPE_VARCHAR = 0x0f;

// ─── Auth plugins ─────────────────────────────────────────────────────────────
const PLUGIN_NATIVE   = 'mysql_native_password';
const PLUGIN_SHA2     = 'caching_sha2_password';


// ─── Helper: read length-encoded integer ─────────────────────────────────────
function readLenEncInt(buf: Buffer, offset: number): { value: number; bytesRead: number } {
  const first = buf[offset]!;
  if (first < 0xfb) return { value: first, bytesRead: 1 };
  if (first === 0xfc) return { value: buf.readUInt16LE(offset + 1), bytesRead: 3 };
  if (first === 0xfd) {
    return { value: buf.readUIntLE(offset + 1, 3), bytesRead: 4 };
  }
  // 0xfe — 8 bytes (we only support up to 32-bit safe integers here)
  return { value: buf.readUInt32LE(offset + 1), bytesRead: 9 };
}

// ─── Helper: write length-encoded integer ────────────────────────────────────
function writeLenEncInt(value: number): Buffer {
  if (value < 0xfb) {
    const b = Buffer.allocUnsafe(1);
    b[0] = value;
    return b;
  }
  if (value <= 0xffff) {
    const b = Buffer.allocUnsafe(3);
    b[0] = 0xfc;
    b.writeUInt16LE(value, 1);
    return b;
  }
  const b = Buffer.allocUnsafe(4);
  b[0] = 0xfd;
  b.writeUIntLE(value, 1, 3);
  return b;
}

// ─── Packet framing ───────────────────────────────────────────────────────────
/** Wrap body bytes in a MySQL packet header (3-byte len LE + 1-byte seq id). */
function wrapPacket(body: Buffer, seq: number): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUIntLE(body.length, 0, 3);
  header[3] = seq & 0xff;
  return Buffer.concat([header, body]);
}


// ─── Task 6.2: mysql_native_password auth ─────────────────────────────────────
/**
 * Compute mysql_native_password response:
 *   SHA1(password) XOR SHA1(seed + SHA1(SHA1(password)))
 * @internal
 */
export function nativePasswordHash(password: string, seed: Buffer): Buffer {
  const sha1 = (data: Buffer | string): Buffer => {
    return createHash('sha1').update(data).digest();
  };
  const pw = Buffer.from(password, 'utf8');
  const hash1 = sha1(pw);                        // SHA1(password)
  const hash2 = sha1(hash1);                     // SHA1(SHA1(password))
  const combined = Buffer.concat([seed, hash2]); // seed + SHA1(SHA1(password))
  const hash3 = sha1(combined);                  // SHA1(seed + SHA1(SHA1(password)))
  // XOR hash1 with hash3
  const result = Buffer.allocUnsafe(20);
  for (let i = 0; i < 20; i++) {
    result[i] = hash1[i]! ^ hash3[i]!;
  }
  return result;
}

// ─── Task 6.3: caching_sha2_password auth ────────────────────────────────────
/**
 * Compute caching_sha2_password challenge response:
 *   XOR(SHA256(password), SHA256(SHA256(SHA256(password)) + seed))
 *
 * An empty password yields an empty (zero-length) response, matching the
 * MySQL client protocol — the server treats an empty scramble as "no password".
 * @internal
 */
export function sha2PasswordHash(password: string, seed: Buffer): Buffer {
  if (password.length === 0) return Buffer.alloc(0);
  const sha256 = (data: Buffer | string): Buffer => {
    return createHash('sha256').update(data).digest();
  };
  const pw = Buffer.from(password, 'utf8');
  const A = sha256(pw);                               // SHA256(password)
  const B = sha256(A);                                // SHA256(SHA256(password))
  const C = sha256(Buffer.concat([B, seed]));         // SHA256(SHA256(SHA256(password)) + seed)
  // XOR A with C
  const result = Buffer.allocUnsafe(32);
  for (let i = 0; i < 32; i++) {
    result[i] = A[i]! ^ C[i]!;
  }
  return result;
}


// ─── Server Greeting (Handshake v10) ─────────────────────────────────────────
interface ServerGreeting {
  protocolVersion: number;
  serverVersion: string;
  connectionId: number;
  authPluginData: Buffer;  // full seed (part1 + part2)
  capabilityFlags: number;
  charset: number;
  statusFlags: number;
  authPluginName: string;
}

/** Parse a MySQL Handshake v10 packet body. */
function parseServerGreeting(body: Buffer): ServerGreeting {
  let offset = 0;

  const protocolVersion = body[offset]!;
  offset += 1;

  // Null-terminated server version string
  const versionEnd = body.indexOf(0, offset);
  const serverVersion = body.toString('utf8', offset, versionEnd);
  offset = versionEnd + 1;

  // 4-byte connection id
  const connectionId = body.readUInt32LE(offset);
  offset += 4;

  // 8-byte auth-plugin-data part 1
  const part1 = body.subarray(offset, offset + 8);
  offset += 8;

  // 1-byte filler (0x00)
  offset += 1;

  // 2-byte capability flags (lower half)
  const capLow = body.readUInt16LE(offset);
  offset += 2;

  // 1-byte charset
  const charset = body[offset]!;
  offset += 1;

  // 2-byte status flags
  const statusFlags = body.readUInt16LE(offset);
  offset += 2;

  // 2-byte capability flags (upper half)
  const capHigh = body.readUInt16LE(offset);
  offset += 2;
  const capabilityFlags = capLow | (capHigh << 16);

  // 1-byte auth plugin data length (total length of seed)
  const authPluginDataLen = body[offset]!;
  offset += 1;

  // 10-byte reserved zeros
  offset += 10;

  // auth-plugin-data part 2: max(13, authPluginDataLen - 8) bytes
  const part2Len = Math.max(13, authPluginDataLen - 8);
  const part2 = body.subarray(offset, offset + part2Len);
  offset += part2Len;

  // Combine part1 + part2 (strip trailing null from part2)
  const rawSeed = Buffer.concat([part1, part2]);
  // Seed is authPluginDataLen - 1 bytes (strip the null terminator)
  const seedLen = Math.max(0, authPluginDataLen - 1);
  const authPluginData = rawSeed.subarray(0, seedLen);

  // Null-terminated auth plugin name
  let authPluginName = '';
  if (offset < body.length) {
    const nameEnd = body.indexOf(0, offset);
    authPluginName = nameEnd === -1
      ? body.toString('utf8', offset)
      : body.toString('utf8', offset, nameEnd);
  }

  return {
    protocolVersion,
    serverVersion,
    connectionId,
    authPluginData,
    capabilityFlags,
    charset,
    statusFlags,
    authPluginName,
  };
}


// ─── HandshakeResponse41 ──────────────────────────────────────────────────────
function buildHandshakeResponse(
  user: string,
  database: string,
  authResponse: Buffer,
  authPluginName: string,
  charset = 0x21 /* utf8_general_ci */,
): Buffer {
  const userBuf = Buffer.concat([Buffer.from(user, 'utf8'), Buffer.from([0])]);
  const dbBuf   = Buffer.concat([Buffer.from(database, 'utf8'), Buffer.from([0])]);
  const pluginBuf = Buffer.concat([Buffer.from(authPluginName, 'utf8'), Buffer.from([0])]);

  const capabilities =
    CLIENT_PROTOCOL_41 |
    CLIENT_SECURE_CONNECTION |
    CLIENT_PLUGIN_AUTH |
    CLIENT_PLUGIN_AUTH_LENENC_DATA |
    CLIENT_CONNECT_WITH_DB |
    CLIENT_LONG_FLAG;

  // Build body
  const capBuf = Buffer.allocUnsafe(4);
  capBuf.writeUInt32LE(capabilities, 0);

  const maxPktBuf = Buffer.allocUnsafe(4);
  maxPktBuf.writeUInt32LE(0x40000000, 0); // 1 GB

  const charsetBuf = Buffer.from([charset]);
  const reservedBuf = Buffer.alloc(23, 0);

  const authLenBuf = writeLenEncInt(authResponse.length);

  const body = Buffer.concat([
    capBuf,
    maxPktBuf,
    charsetBuf,
    reservedBuf,
    userBuf,
    authLenBuf,
    authResponse,
    dbBuf,
    pluginBuf,
  ]);

  return wrapPacket(body, 1); // sequence id = 1
}


// ─── Column definition ────────────────────────────────────────────────────────
interface ColumnDef {
  name: string;
  fieldType: number;
}

/** Parse a column definition packet (41-format). Returns just the column name. */
function parseColumnDef(body: Buffer): ColumnDef {
  let offset = 0;
  // catalog (lenenc string)
  const cat = readLenEncInt(body, offset);
  offset += cat.bytesRead + cat.value;
  // schema (lenenc string)
  const schema = readLenEncInt(body, offset);
  offset += schema.bytesRead + schema.value;
  // table (lenenc string)
  const tbl = readLenEncInt(body, offset);
  offset += tbl.bytesRead + tbl.value;
  // org_table (lenenc string)
  const orgTbl = readLenEncInt(body, offset);
  offset += orgTbl.bytesRead + orgTbl.value;
  // name (lenenc string)
  const nameLen = readLenEncInt(body, offset);
  offset += nameLen.bytesRead;
  const name = body.toString('utf8', offset, offset + nameLen.value);
  offset += nameLen.value;
  // org_name (lenenc string)
  const orgNameLen = readLenEncInt(body, offset);
  offset += orgNameLen.bytesRead + orgNameLen.value;
  // next_length (0x0c)
  offset += 1;
  // charset (2), colLen (4), type (1), flags (2), decimals (1), filler (2)
  offset += 2 + 4;
  const fieldType = body[offset] ?? 0;
  return { name, fieldType };
}


// ─── OK / ERR packet parsers ──────────────────────────────────────────────────
interface OkPacket {
  affectedRows: number;
  lastInsertId: number;
  statusFlags: number;
}

function parseOkPacket(body: Buffer): OkPacket {
  let offset = 1; // skip 0x00 header
  const ar = readLenEncInt(body, offset);
  offset += ar.bytesRead;
  const li = readLenEncInt(body, offset);
  offset += li.bytesRead;
  const statusFlags = body.length >= offset + 2 ? body.readUInt16LE(offset) : 0;
  return { affectedRows: ar.value, lastInsertId: li.value, statusFlags };
}

function parseErrPacket(body: Buffer): Error {
  // 0xFF + 2-byte error code + '#' + 5-byte sqlstate + message
  const code = body.readUInt16LE(1);
  let msgStart = 3;
  if (body[msgStart] === 0x23 /* '#' */) msgStart += 6; // skip '#' + 5 sqlstate
  const msg = body.toString('utf8', msgStart).replace(/\0$/, '');
  return new Error(`MySQL error ${code}: ${msg}`);
}


// ─── Streaming result row stream ──────────────────────────────────────────────
export class MysqlResultStream extends Readable {
  private _done = false;

  constructor() {
    super({ objectMode: true, highWaterMark: 64 });
  }

  pushRow(row: Record<string, string | null>): boolean {
    if (this._done) return false;
    return this.push(row);
  }

  finalize(error?: Error): void {
    this._done = true;
    if (error) {
      this.destroy(error);
    } else {
      this.push(null);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _read(_size: number): void {
    // push-mode stream — backpressure is handled by the connection layer
  }
}

// ─── Connection options ───────────────────────────────────────────────────────
export interface MysqlConnectOptions {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  connectTimeoutMs?: number;
}


// ─── Internal connection state ────────────────────────────────────────────────
type ConnState = 'connecting' | 'authenticating' | 'ready' | 'query' | 'closed';

interface PreparedStatement {
  stmtId: number;
  numParams: number;
  numColumns: number;
  paramDefs: ColumnDef[];
  colDefs: ColumnDef[];
}

interface PendingQuery {
  resolve: (result: DbResult) => void;
  reject: (err: Error) => void;
  rows: Record<string, string | null>[];
  command: string;
  affectedRows: number;
  lastInsertId: number;
}

// ─── caching_sha2_password second-factor states ───────────────────────────────
type Sha2State = 'initial' | 'expect_more';


// ─── MysqlConnection ──────────────────────────────────────────────────────────
export class MysqlConnection {
  protected socket: Socket | null = null;
  protected state: ConnState = 'connecting';
  private buffer = Buffer.alloc(0);

  // Server greeting info stored during auth
  protected greeting: ServerGreeting | null = null;
  private opts: MysqlConnectOptions | null = null;

  // Auth resolve/reject
  private authResolve: (() => void) | null = null;
  private authReject: ((err: Error) => void) | null = null;

  // Query state
  private pendingQuery: PendingQuery | null = null;
  private streamTarget: MysqlResultStream | null = null;
  private columns: ColumnDef[] = [];
  private colCount = 0;           // expected column count for result set
  private colsReceived = 0;       // column defs received so far
  private expectEof = false;      // waiting for EOF/OK after columns

  // Prepared statement state
  private pendingPrepare: {
    resolve: (stmt: PreparedStatement) => void;
    reject: (err: Error) => void;
    stmt: Partial<PreparedStatement>;
    paramsReceived: number;
    colsReceived: number;
  } | null = null;

  // caching_sha2_password sub-state
  private sha2State: Sha2State = 'initial';
  private sha2Seed: Buffer = Buffer.alloc(0);

  // Binary-protocol exec mode flag
  private _inExec = false;

  // Sequence number for outgoing packets (increments per command)
  private seq = 0;

  get isReady(): boolean { return this.state === 'ready'; }
  get isClosed(): boolean { return this.state === 'closed'; }

  /** The server version string from the greeting packet. */
  get serverVersion(): string { return this.greeting?.serverVersion ?? ''; }


  /**
   * Static factory: connects to MySQL/MariaDB and returns the appropriate
   * subclass based on the server greeting (task 6.7).
   */
  static async connect(opts: MysqlConnectOptions): Promise<MysqlConnection> {
    const conn = new MysqlConnection();
    await conn._connect(opts);
    // Check if the server is actually MariaDB
    const version = conn.greeting?.serverVersion ?? '';
    if (version.includes('MariaDB') || version.startsWith('5.5.5-')) {
      // Lazy import to avoid circular dependency (mariadb.ts imports from this file).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { MariaDbConnection } = await import('./mariadb.js');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const mariaConn = new MariaDbConnection() as MysqlConnection;
      mariaConn._transferFrom(conn);
      return mariaConn;
    }
    return conn;
  }

  /** @internal Used by MariaDbConnection to take over a connected MysqlConnection. */
  _transferFrom(other: MysqlConnection): void {
    this.socket = other.socket;
    this.state = other.state;
    this.buffer = other.buffer;
    this.greeting = other.greeting;
    this.opts = other.opts;
    this.authResolve = other.authResolve;
    this.authReject = other.authReject;
    this.pendingQuery = other.pendingQuery;
    this.streamTarget = other.streamTarget;
    this.columns = other.columns;
    this.colCount = other.colCount;
    this.colsReceived = other.colsReceived;
    this.expectEof = other.expectEof;
    this.pendingPrepare = other.pendingPrepare;
    this.sha2State = other.sha2State;
    this.sha2Seed = other.sha2Seed;
    this.seq = other.seq;
    this._inExec = other._inExec;
    // Re-wire socket event listeners to this instance
    if (this.socket) {
      this.socket.removeAllListeners('data');
      this.socket.on('data', (chunk: Buffer) => this._onData(chunk));
    }
  }


  protected _connect(opts: MysqlConnectOptions): Promise<void> {
    this.opts = opts;
    const port = opts.port ?? 3306;

    return new Promise((resolve, reject) => {
      const timeoutMs = opts.connectTimeoutMs ?? 10_000;
      const timer = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error('MySQL connection timeout'));
      }, timeoutMs);
      timer.unref();

      this.authResolve = () => { clearTimeout(timer); resolve(); };
      this.authReject  = (err) => { clearTimeout(timer); reject(err); };

      const socket = createConnection({ host: opts.host, port });
      this.socket = socket;

      socket.setKeepAlive(true, 10_000);
      socket.setNoDelay(true);

      socket.once('connect', () => {
        this.state = 'authenticating';
        // Server will send its greeting first; nothing to write yet
      });

      socket.on('data', (chunk: Buffer) => this._onData(chunk));

      socket.once('error', (err) => {
        this.state = 'closed';
        if (this.authReject) { this.authReject(err as Error); this.authReject = null; }
        if (this.pendingQuery) { this.pendingQuery.reject(err as Error); this.pendingQuery = null; }
        if (this.streamTarget) { this.streamTarget.finalize(err as Error); this.streamTarget = null; }
      });

      socket.once('close', () => {
        this.state = 'closed';
        const err = new Error('MySQL connection closed unexpectedly');
        if (this.pendingQuery) { this.pendingQuery.reject(err); this.pendingQuery = null; }
        if (this.streamTarget) { this.streamTarget.finalize(err); this.streamTarget = null; }
      });
    });
  }

  private _onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this._processBuffer();
  }

  private _processBuffer(): void {
    while (this.buffer.length >= 4) {
      const bodyLen = this.buffer.readUIntLE(0, 3);
      const totalLen = 4 + bodyLen;
      if (this.buffer.length < totalLen) break;

      // seq = this.buffer[3] — not used for state machine, just updated
      const body = this.buffer.subarray(4, totalLen);
      this.buffer = this.buffer.subarray(totalLen);
      this._handlePacket(body);
    }
  }


  private _handlePacket(body: Buffer): void {
    if (body.length === 0) return;

    const firstByte = body[0]!;

    if (this.state === 'authenticating') {
      this._handleAuthPacket(body, firstByte);
      return;
    }

    if (this.state === 'query') {
      if (this._inExec) {
        this._handleExecPacket(body, firstByte);
      } else {
        this._handleQueryPacket(body, firstByte);
      }
      return;
    }
  }

  private _handleAuthPacket(body: Buffer, firstByte: number): void {
    const opts = this.opts!;

    // First packet is the server greeting
    if (!this.greeting) {
      this.greeting = parseServerGreeting(body);
      this.sha2Seed = this.greeting.authPluginData;
      // Send HandshakeResponse
      const plugin = this.greeting.authPluginName || PLUGIN_NATIVE;
      let authResp: Buffer;
      if (plugin === PLUGIN_SHA2) {
        authResp = sha2PasswordHash(opts.password, this.sha2Seed);
        this.sha2State = 'expect_more';
      } else {
        // Default: mysql_native_password
        authResp = opts.password.length > 0
          ? nativePasswordHash(opts.password, this.sha2Seed)
          : Buffer.alloc(0);
      }
      const response = buildHandshakeResponse(opts.user, opts.database, authResp, plugin);
      this.socket?.write(response);
      return;
    }

    // ERR packet
    if (firstByte === 0xff) {
      const err = parseErrPacket(body);
      if (this.authReject) { this.authReject(err); this.authReject = null; }
      return;
    }

    // OK packet — auth success
    if (firstByte === 0x00) {
      this.state = 'ready';
      if (this.authResolve) { this.authResolve(); this.authResolve = null; }
      return;
    }

    // caching_sha2_password: auth-more-data (0x01 prefix)
    if (firstByte === 0x01) {
      const subtype = body[1];
      if (subtype === 0x04) {
        // Server requests full password in cleartext (RSA-encrypted or over TLS).
        // Sending cleartext passwords over non-TLS connections is a security violation.
        // We reject this auth path unless the connection was established with TLS.
        // Since this driver uses node:net (plain TCP) and does not negotiate SSL/TLS,
        // we MUST reject the request to prevent credential exposure.
        const err = new Error(
          'MySQL caching_sha2_password: server requested cleartext password transmission. ' +
          'This is only safe over TLS, but this connection is not TLS-encrypted. ' +
          'Configure your MySQL server to allow caching_sha2_password without RSA ' +
          '(e.g. caching_sha2_password_auto_generate_rsa_keys=OFF and require SSL), ' +
          'or use mysql_native_password instead.',
        );
        process.stderr.write(`[street/mysql] SECURITY: ${err.message}\n`);
        if (this.authReject) { this.authReject(err); this.authReject = null; }
        this.state = 'closed';
        this.socket?.destroy();
        return;
      }
      // subtype 0x02 = fast-auth succeeded, wait for OK
      // subtype 0x03 = full auth required
      return;
    }

    // AuthSwitchRequest (0xfe)
    if (firstByte === 0xfe) {
      let offset = 1;
      const nameEnd = body.indexOf(0, offset);
      const newPlugin = nameEnd === -1
        ? body.toString('utf8', offset)
        : body.toString('utf8', offset, nameEnd);
      offset = nameEnd + 1;
      // new seed follows
      const newSeed = body.subarray(offset, body.length - 1); // strip trailing null
      this.sha2Seed = newSeed;

      let authResp: Buffer;
      if (newPlugin === PLUGIN_SHA2) {
        authResp = sha2PasswordHash(opts.password, newSeed);
      } else {
        authResp = opts.password.length > 0
          ? nativePasswordHash(opts.password, newSeed)
          : Buffer.alloc(0);
      }
      const pkt = wrapPacket(authResp, this.seq++);
      this.socket?.write(pkt);
      return;
    }
  }


  private _handleQueryPacket(body: Buffer, firstByte: number): void {
    // Prepared statement response
    if (this.pendingPrepare) {
      this._handlePreparePacket(body, firstByte);
      return;
    }

    // ERR packet
    if (firstByte === 0xff) {
      const err = parseErrPacket(body);
      this.state = 'ready';
      if (this.streamTarget) { this.streamTarget.finalize(err); this.streamTarget = null; }
      else if (this.pendingQuery) { this.pendingQuery.reject(err); this.pendingQuery = null; }
      return;
    }

    // OK packet — DML/DDL result
    if (firstByte === 0x00 && this.colCount === 0 && !this.expectEof) {
      const ok = parseOkPacket(body);
      this.state = 'ready';
      const pq = this.pendingQuery;
      this.pendingQuery = null;
      if (pq) {
        pq.affectedRows = ok.affectedRows;
        pq.lastInsertId = ok.lastInsertId;
        pq.resolve({
          rows: pq.rows,
          rowCount: ok.affectedRows,
          command: pq.command || 'OK',
        });
      }
      return;
    }

    // EOF / OK that terminates column definitions or result set
    if ((firstByte === 0xfe && body.length < 9) || (firstByte === 0x00 && this.expectEof)) {
      if (!this.expectEof) {
        // End of column definitions — next are rows
        this.expectEof = true;
        return;
      }
      // End of result set
      this.state = 'ready';
      this.expectEof = false;
      const pq = this.pendingQuery;
      const st = this.streamTarget;
      this.pendingQuery = null;
      this.streamTarget = null;
      const cols = this.columns;
      this.columns = [];
      this.colCount = 0;
      this.colsReceived = 0;

      if (st) {
        st.finalize();
      } else if (pq) {
        pq.resolve({
          rows: pq.rows,
          rowCount: pq.rows.length,
          command: pq.command || 'SELECT',
        });
      }
      void cols; // suppress unused warning
      return;
    }

    // Column count packet (first packet of a result set)
    if (this.colCount === 0 && this.colsReceived === 0 && !this.expectEof && firstByte !== 0x00) {
      const { value } = readLenEncInt(body, 0);
      this.colCount = value;
      this.colsReceived = 0;
      this.columns = [];
      return;
    }

    // Column definition packet
    if (this.colsReceived < this.colCount) {
      const col = parseColumnDef(body);
      this.columns.push(col);
      this.colsReceived++;
      return;
    }

    // Row data packet (text protocol)
    if (this.expectEof) {
      const row: Record<string, string | null> = {};
      let offset = 0;
      for (const col of this.columns) {
        if (offset >= body.length) break;
        if (body[offset] === 0xfb) {
          row[col.name] = null;
          offset += 1;
        } else {
          const lenEnc = readLenEncInt(body, offset);
          offset += lenEnc.bytesRead;
          row[col.name] = body.toString('utf8', offset, offset + lenEnc.value);
          offset += lenEnc.value;
        }
      }
      if (this.streamTarget) {
        const canContinue = this.streamTarget.pushRow(row);
        if (!canContinue && this.socket) {
          this.socket.pause();
        }
      } else if (this.pendingQuery) {
        this.pendingQuery.rows.push(row);
      }
      return;
    }
  }


  // ─── Prepared statement packet handling ────────────────────────────────────
  private _handlePreparePacket(body: Buffer, firstByte: number): void {
    const pp = this.pendingPrepare!;

    if (firstByte === 0xff) {
      const err = parseErrPacket(body);
      this.pendingPrepare = null;
      this.state = 'ready';
      pp.reject(err);
      return;
    }

    // COM_STMT_PREPARE response OK: 0x00 + stmtId(4) + numCols(2) + numParams(2) + reserved(1) + warnings(2)
    if (!pp.stmt.stmtId) {
      if (firstByte !== 0x00) { pp.reject(new Error('Unexpected prepare response')); return; }
      pp.stmt.stmtId = body.readUInt32LE(1);
      pp.stmt.numParams = body.readUInt16LE(5);
      pp.stmt.numColumns = body.readUInt16LE(7);
      pp.stmt.paramDefs = [];
      pp.stmt.colDefs = [];
      pp.paramsReceived = 0;
      pp.colsReceived = 0;

      // If no params and no columns, we're done
      if (pp.stmt.numParams === 0 && pp.stmt.numColumns === 0) {
        this._completePrepare();
      }
      return;
    }

    // Receiving param defs
    if (pp.paramsReceived < (pp.stmt.numParams ?? 0)) {
      if (firstByte === 0xfe && body.length < 9) {
        // EOF after params — now expecting column defs
        return;
      }
      if (firstByte === 0x00 && body.length < 9) {
        // OK-style EOF in newer protocols
        return;
      }
      pp.stmt.paramDefs!.push(parseColumnDef(body));
      pp.paramsReceived++;
      if (pp.paramsReceived === pp.stmt.numParams && pp.stmt.numColumns === 0) {
        // Will see EOF, then we're done
      }
      return;
    }

    // EOF between param defs and column defs
    if ((firstByte === 0xfe && body.length < 9) || (firstByte === 0x00 && body.length < 9)) {
      if (pp.colsReceived === 0 && (pp.stmt.numColumns ?? 0) === 0) {
        this._completePrepare();
        return;
      }
      // If this is the EOF after all column defs
      if (pp.colsReceived >= (pp.stmt.numColumns ?? 0)) {
        this._completePrepare();
        return;
      }
      return;
    }

    // Receiving column defs
    if (pp.colsReceived < (pp.stmt.numColumns ?? 0)) {
      pp.stmt.colDefs!.push(parseColumnDef(body));
      pp.colsReceived++;
      if (pp.colsReceived === pp.stmt.numColumns) {
        // Expect final EOF
      }
      return;
    }
  }

  private _completePrepare(): void {
    const pp = this.pendingPrepare!;
    this.pendingPrepare = null;
    this.state = 'ready';
    pp.resolve(pp.stmt as PreparedStatement);
  }


  // ─── COM_STMT_EXECUTE result packets (binary protocol) ─────────────────────
  private execColumns: ColumnDef[] = [];
  private execColCount = 0;
  private execColsReceived = 0;
  private execExpectRows = false;
  private execPendingQuery: PendingQuery | null = null;
  private execStreamTarget: MysqlResultStream | null = null;

  private _handleExecPacket(body: Buffer, firstByte: number): void {
    if (firstByte === 0xff) {
      const err = parseErrPacket(body);
      this.state = 'ready';
      this._inExec = false;
      const pq = this.execPendingQuery;
      const st = this.execStreamTarget;
      this.execPendingQuery = null;
      this.execStreamTarget = null;
      this._resetExecState();
      if (st) st.finalize(err);
      else if (pq) pq.reject(err);
      return;
    }

    // OK — no result set (DML)
    if (firstByte === 0x00 && this.execColCount === 0 && !this.execExpectRows) {
      const ok = parseOkPacket(body);
      this.state = 'ready';
      this._inExec = false;
      const pq = this.execPendingQuery;
      this.execPendingQuery = null;
      this._resetExecState();
      if (pq) {
        pq.resolve({ rows: [], rowCount: ok.affectedRows, command: pq.command || 'OK' });
      }
      return;
    }

    // EOF/OK terminator after column defs or rows
    if ((firstByte === 0xfe && body.length < 9) || (firstByte === 0x00 && this.execExpectRows)) {
      if (!this.execExpectRows) {
        this.execExpectRows = true;
        return;
      }
      // End of result set
      this.state = 'ready';
      this._inExec = false;
      const pq = this.execPendingQuery;
      const st = this.execStreamTarget;
      this.execPendingQuery = null;
      this.execStreamTarget = null;
      this._resetExecState();
      if (st) st.finalize();
      else if (pq) pq.resolve({ rows: pq.rows, rowCount: pq.rows.length, command: pq.command || 'SELECT' });
      return;
    }

    // Column count
    if (this.execColCount === 0 && !this.execExpectRows) {
      const { value } = readLenEncInt(body, 0);
      this.execColCount = value;
      this.execColsReceived = 0;
      this.execColumns = [];
      return;
    }

    // Column definitions
    if (this.execColsReceived < this.execColCount) {
      this.execColumns.push(parseColumnDef(body));
      this.execColsReceived++;
      return;
    }

    // Binary result row
    if (this.execExpectRows) {
      const row = this._parseBinaryRow(body, this.execColumns);
      const st = this.execStreamTarget;
      const pq = this.execPendingQuery;
      if (st) {
        const canContinue = st.pushRow(row);
        if (!canContinue && this.socket) this.socket.pause();
      } else if (pq) {
        pq.rows.push(row);
      }
      return;
    }
  }

  private _resetExecState(): void {
    this.execColumns = [];
    this.execColCount = 0;
    this.execColsReceived = 0;
    this.execExpectRows = false;
    this._inExec = false;
  }

  /** Parse a binary protocol result row. */
  private _parseBinaryRow(body: Buffer, cols: ColumnDef[]): Record<string, string | null> {
    const row: Record<string, string | null> = {};
    // body[0] = 0x00 (packet header)
    let offset = 1;

    // NULL bitmap: ceil((numCols + 2) / 8) bytes
    const numCols = cols.length;
    const nullBitmapLen = Math.ceil((numCols + 2) / 8);
    const nullBitmap = body.subarray(offset, offset + nullBitmapLen);
    offset += nullBitmapLen;

    for (let i = 0; i < numCols; i++) {
      const col = cols[i]!;
      // NULL bitmap: bit i+2 in the bitmap
      const byteIdx = Math.floor((i + 2) / 8);
      const bitIdx  = (i + 2) % 8;
      if ((nullBitmap[byteIdx]! >> bitIdx) & 1) {
        row[col.name] = null;
        continue;
      }
      // Read value based on type
      const type = col.fieldType;
      if (offset >= body.length) { row[col.name] = null; continue; }
      // For simplicity, read all types as lenenc strings (text representation fallback)
      if (type === FIELD_TYPE_NULL) {
        row[col.name] = null;
      } else if (type === 1 /* TINY */) {
        row[col.name] = String(body.readInt8(offset)); offset += 1;
      } else if (type === 2 /* SHORT */ || type === 13 /* YEAR */) {
        row[col.name] = String(body.readInt16LE(offset)); offset += 2;
      } else if (type === 3 /* LONG */ || type === 9 /* INT24 */) {
        row[col.name] = String(body.readInt32LE(offset)); offset += 4;
      } else if (type === 8 /* LONGLONG */) {
        row[col.name] = String(body.readBigInt64LE(offset)); offset += 8;
      } else if (type === 4 /* FLOAT */) {
        row[col.name] = String(body.readFloatLE(offset)); offset += 4;
      } else if (type === 5 /* DOUBLE */) {
        row[col.name] = String(body.readDoubleLE(offset)); offset += 8;
      } else {
        // Lenenc string for VARCHAR, TEXT, BLOB, DATE, etc.
        const lenEnc = readLenEncInt(body, offset);
        offset += lenEnc.bytesRead;
        row[col.name] = body.toString('utf8', offset, offset + lenEnc.value);
        offset += lenEnc.value;
      }
    }
    return row;
  }


  // ─── Public API: query (task 6.4) ─────────────────────────────────────────
  /**
   * Execute a SQL query.
   * - With params: uses COM_STMT_PREPARE + COM_STMT_EXECUTE (binary protocol).
   * - Without params: uses COM_QUERY (text protocol).
   */
  async query(sql: string, params?: unknown[]): Promise<DbResult> {
    if (this.state !== 'ready') throw new Error('MySQL connection not ready');

    if (params && params.length > 0) {
      return this._execPrepared(sql, params);
    }

    return this._queryText(sql);
  }

  private _queryText(sql: string): Promise<DbResult> {
    this.state = 'query';
    this.seq = 0;
    // Reset text-protocol state
    this.columns = [];
    this.colCount = 0;
    this.colsReceived = 0;
    this.expectEof = false;

    return new Promise<DbResult>((resolve, reject) => {
      this.pendingQuery = { resolve, reject, rows: [], command: '', affectedRows: 0, lastInsertId: 0 };

      // Derive command from SQL prefix
      const cmd = sql.trimStart().split(/\s+/)[0]?.toUpperCase() ?? 'QUERY';
      this.pendingQuery.command = cmd;

      const sqlBuf = Buffer.from(sql, 'utf8');
      const body = Buffer.allocUnsafe(1 + sqlBuf.length);
      body[0] = COM_QUERY;
      sqlBuf.copy(body, 1);
      const pkt = wrapPacket(body, this.seq++);
      this.socket?.write(pkt);
    });
  }

  private async _execPrepared(sql: string, params: unknown[]): Promise<DbResult> {
    const stmt = await this._prepare(sql);
    try {
      return await this._execute(stmt, params);
    } finally {
      this._stmtClose(stmt.stmtId);
    }
  }

  private _prepare(sql: string): Promise<PreparedStatement> {
    this.state = 'query';
    this.seq = 0;
    return new Promise<PreparedStatement>((resolve, reject) => {
      this.pendingPrepare = {
        resolve,
        reject,
        stmt: {},
        paramsReceived: 0,
        colsReceived: 0,
      };
      const sqlBuf = Buffer.from(sql, 'utf8');
      const body = Buffer.allocUnsafe(1 + sqlBuf.length);
      body[0] = COM_STMT_PREPARE;
      sqlBuf.copy(body, 1);
      const pkt = wrapPacket(body, this.seq++);
      this.socket?.write(pkt);
    });
  }

  private _execute(stmt: PreparedStatement, params: unknown[]): Promise<DbResult> {
    this.state = 'query';
    this.seq = 0;
    this._resetExecState();
    this._inExec = true;

    return new Promise<DbResult>((resolve, reject) => {
      const cmd = 'SELECT';
      this.execPendingQuery = { resolve, reject, rows: [], command: cmd, affectedRows: 0, lastInsertId: 0 };

      const execBody = buildStmtExecutePacket(stmt.stmtId, params);
      const pkt = wrapPacket(execBody, this.seq++);
      this.socket?.write(pkt);
    });
  }

  private _stmtClose(stmtId: number): void {
    const body = Buffer.allocUnsafe(5);
    body[0] = COM_STMT_CLOSE;
    body.writeUInt32LE(stmtId, 1);
    const pkt = wrapPacket(body, this.seq++);
    this.socket?.write(pkt);
  }


  // ─── Public API: queryStream (task 6.5) ────────────────────────────────────
  /**
   * Execute a SELECT query and return a Readable stream of rows.
   * Uses text protocol (COM_QUERY) with socket.pause()/resume() for backpressure.
   */
  queryStream(sql: string): MysqlResultStream {
    if (this.state !== 'ready') throw new Error('MySQL connection not ready');

    this.state = 'query';
    this.seq = 0;
    this.columns = [];
    this.colCount = 0;
    this.colsReceived = 0;
    this.expectEof = false;

    const stream = new MysqlResultStream();

    // When the consumer is ready for more data, resume the socket
    stream.on('drain', () => { this.socket?.resume(); });

    this.streamTarget = stream;
    this.pendingQuery = { resolve: () => {}, reject: () => {}, rows: [], command: 'SELECT', affectedRows: 0, lastInsertId: 0 };

    const sqlBuf = Buffer.from(sql, 'utf8');
    const body = Buffer.allocUnsafe(1 + sqlBuf.length);
    body[0] = COM_QUERY;
    sqlBuf.copy(body, 1);
    const pkt = wrapPacket(body, this.seq++);
    this.socket?.write(pkt);

    return stream;
  }

  // ─── Close ────────────────────────────────────────────────────────────────
  async close(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closed';
    try {
      if (this.socket && !this.socket.destroyed) {
        const quitBody = Buffer.from([COM_QUIT]);
        const pkt = wrapPacket(quitBody, 0);
        this.socket.write(pkt);
        this.socket.destroy();
      }
    } catch {
      // Ignore errors on close
    }
    this.socket = null;
  }
}


// ─── COM_STMT_EXECUTE packet builder ─────────────────────────────────────────
function buildStmtExecutePacket(stmtId: number, params: unknown[]): Buffer {
  const numParams = params.length;

  // Null bitmap
  const nullBitmapLen = Math.ceil(numParams / 8);
  const nullBitmap = Buffer.alloc(nullBitmapLen, 0);

  // Mark null params in bitmap
  for (let i = 0; i < numParams; i++) {
    if (params[i] === null || params[i] === undefined) {
      nullBitmap[Math.floor(i / 8)]! |= (1 << (i % 8));
    }
  }

  // Type + value buffers
  const typeBufs: Buffer[] = [];
  const valBufs: Buffer[] = [];

  for (let i = 0; i < numParams; i++) {
    const p = params[i];
    if (p === null || p === undefined) {
      // NULL — type FIELD_TYPE_NULL, no value
      const t = Buffer.allocUnsafe(2);
      t[0] = FIELD_TYPE_NULL; t[1] = 0;
      typeBufs.push(t);
    } else if (typeof p === 'number' && Number.isInteger(p)) {
      const t = Buffer.allocUnsafe(2); t[0] = 3 /* LONG */; t[1] = 0;
      const v = Buffer.allocUnsafe(4); v.writeInt32LE(p, 0);
      typeBufs.push(t); valBufs.push(v);
    } else if (typeof p === 'number') {
      const t = Buffer.allocUnsafe(2); t[0] = 5 /* DOUBLE */; t[1] = 0;
      const v = Buffer.allocUnsafe(8); v.writeDoubleLE(p, 0);
      typeBufs.push(t); valBufs.push(v);
    } else {
      // String/bool/Buffer — send as VARCHAR (lenenc string)
      const str = typeof p === 'boolean' ? (p ? '1' : '0') : String(p);
      const strBuf = Buffer.from(str, 'utf8');
      const lenBuf = writeLenEncInt(strBuf.length);
      const t = Buffer.allocUnsafe(2); t[0] = FIELD_TYPE_VARCHAR; t[1] = 0;
      typeBufs.push(t);
      valBufs.push(Buffer.concat([lenBuf, strBuf]));
    }
  }

  // Assemble packet
  // header: COM_STMT_EXECUTE(1) + stmtId(4) + flags(1) + iteration(4) + nullBitmap + newParamsBound(1) + types + values
  const header = Buffer.allocUnsafe(1 + 4 + 1 + 4 + nullBitmapLen + 1);
  let off = 0;
  header[off++] = COM_STMT_EXECUTE;
  header.writeUInt32LE(stmtId, off); off += 4;
  header[off++] = 0; // flags
  header.writeUInt32LE(1, off); off += 4; // iteration-count
  nullBitmap.copy(header, off); off += nullBitmapLen;
  header[off++] = 1; // new-params-bound-flag

  return Buffer.concat([header, ...typeBufs, ...valBufs]);
}

