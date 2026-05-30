// src/database/wire.ts
// PostgreSQL frontend/backend wire protocol v3 implementation.
// Pure node:net + node:crypto – no external dependencies.

import { createConnection, type Socket } from 'node:net';
import { createHash, createHmac, randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

// ─── Wire Constants ────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 196608; // 3.0

const BackendMsg = {
  AuthRequest: 0x52,      // 'R'
  BackendKeyData: 0x4b,   // 'K'
  BindComplete: 0x32,     // '2'
  CloseComplete: 0x33,    // '3'
  CommandComplete: 0x43,  // 'C'
  DataRow: 0x44,          // 'D'
  EmptyQuery: 0x49,       // 'I'
  ErrorResponse: 0x45,    // 'E'
  NoData: 0x6e,           // 'n'
  NoticeResponse: 0x4e,   // 'N'
  ParameterDescription: 0x74, // 't'
  ParameterStatus: 0x53,  // 'S'
  ParseComplete: 0x31,    // '1'
  PortalSuspended: 0x73,  // 's'
  ReadyForQuery: 0x5a,    // 'Z'
  RowDescription: 0x54,   // 'T'
} as const;

const AuthType = {
  Ok: 0,
  CleartextPassword: 3,
  MD5Password: 5,
  SASL: 10,
  SASLContinue: 11,
  SASLFinal: 12,
} as const;

// ─── Message Builders (client → server) ────────────────────────────────────────

function buildStartupMessage(user: string, database: string): Buffer {
  const params = `user\0${user}\0database\0${database}\0`;
  const paramBuf = Buffer.from(params, 'utf8');
  const buf = Buffer.allocUnsafe(4 + 4 + paramBuf.length + 1);
  let offset = 0;
  buf.writeUInt32BE(buf.length, offset); offset += 4;
  buf.writeUInt32BE(PROTOCOL_VERSION, offset); offset += 4;
  paramBuf.copy(buf, offset); offset += paramBuf.length;
  buf[offset] = 0; // terminator
  return buf;
}

function buildPasswordMessage(password: string): Buffer {
  const pwBuf = Buffer.from(password + '\0', 'utf8');
  const buf = Buffer.allocUnsafe(1 + 4 + pwBuf.length);
  buf[0] = 0x70; // 'p'
  buf.writeUInt32BE(4 + pwBuf.length, 1);
  pwBuf.copy(buf, 5);
  return buf;
}

function buildMD5Password(password: string, user: string, salt: Buffer): Buffer {
  const inner = md5(password + user);
  const outer = 'md5' + md5(inner + salt.toString('binary'));
  return buildPasswordMessage(outer);
}

function buildQueryMessage(sql: string): Buffer {
  const sqlBuf = Buffer.from(sql + '\0', 'utf8');
  const buf = Buffer.allocUnsafe(1 + 4 + sqlBuf.length);
  buf[0] = 0x51; // 'Q'
  buf.writeUInt32BE(4 + sqlBuf.length, 1);
  sqlBuf.copy(buf, 5);
  return buf;
}

function buildTerminateMessage(): Buffer {
  const buf = Buffer.allocUnsafe(5);
  buf[0] = 0x58; // 'X'
  buf.writeUInt32BE(4, 1);
  return buf;
}

// ─── Extended Query Protocol: Parse / Bind / Execute / Sync ────────────────────

/** @internal Exported for testing. Builds a PostgreSQL Parse ('P') message. */
export function buildParseMessage(query: string): Buffer {
  const queryBuf = Buffer.from(query + '\0', 'utf8');
  // Empty statement name + query string + 2-byte zero param types count
  const stmtNameLen = 1; // just null terminator for empty name
  const buf = Buffer.allocUnsafe(1 + 4 + stmtNameLen + queryBuf.length + 2);
  let offset = 0;
  buf[offset] = 0x50; // 'P'
  offset += 1;
  // Length placeholder, will be filled at the end
  const lenOffset = offset;
  offset += 4;
  // Empty statement name (just null terminator)
  buf[offset] = 0;
  offset += 1;
  // Query string + null terminator
  queryBuf.copy(buf, offset);
  offset += queryBuf.length;
  // Number of parameter types (0 = let server infer)
  buf.writeUInt16BE(0, offset);
  offset += 2;
  // Fill length
  buf.writeUInt32BE(offset - 1, lenOffset);
  return buf.subarray(0, offset);
}

/** @internal Exported for testing. Builds a PostgreSQL Bind ('B') message. */
export function buildBindMessage(params: unknown[]): Buffer {
  let totalLen = 1 + 4; // 'B' + length
  // Portal name (empty)
  totalLen += 1; // null terminator
  // Statement name (empty)
  totalLen += 1; // null terminator
  // Parameter format codes: 2 bytes, 0 = all text
  totalLen += 2;
  // Number of parameters: 2 bytes
  totalLen += 2;

  const paramBuffers: Buffer[] = [];
  for (const param of params) {
    if (param === null || param === undefined) {
      // NULL: 4-byte length = -1
      totalLen += 4;
      paramBuffers.push(Buffer.alloc(4));
      paramBuffers[paramBuffers.length - 1].writeInt32BE(-1);
    } else {
      let val: string;
      if (typeof param === 'boolean') {
        val = param ? 't' : 'f';
      } else if (typeof param === 'number') {
        val = String(param);
      } else if (param instanceof Buffer) {
        // Binary parameter - send raw bytes with text format (might not work for all types)
        val = param.toString('utf8');
      } else {
        val = String(param);
      }
      const valBuf = Buffer.from(val, 'utf8');
      totalLen += 4 + valBuf.length; // length prefix + value bytes
      paramBuffers.push(valBuf);
    }
  }

  // Result format codes: 2 bytes, 0 = all text
  totalLen += 2;

  const buf = Buffer.allocUnsafe(totalLen);
  let offset = 0;
  buf[offset] = 0x42; // 'B'
  offset += 1;
  buf.writeUInt32BE(totalLen - 1, offset);
  offset += 4;
  // Empty portal name
  buf[offset] = 0;
  offset += 1;
  // Empty statement name
  buf[offset] = 0;
  offset += 1;
  // All params use text format (0)
  buf.writeUInt16BE(0, offset);
  offset += 2;
  // Number of parameters
  buf.writeUInt16BE(params.length, offset);
  offset += 2;

  let paramIdx = 0;
  for (const param of params) {
    if (param === null || param === undefined) {
      const lenBuf = paramBuffers[paramIdx]!;
      lenBuf.copy(buf, offset);
      offset += 4;
    } else {
      const valBuf = paramBuffers[paramIdx]!;
      buf.writeInt32BE(valBuf.length, offset);
      offset += 4;
      valBuf.copy(buf, offset);
      offset += valBuf.length;
    }
    paramIdx++;
  }

  // Result format codes (0 = all text)
  buf.writeUInt16BE(0, offset);
  offset += 2;

  return buf.subarray(0, offset);
}

/** @internal Exported for testing. Builds a PostgreSQL Execute ('E') message. */
export function buildExecuteMessage(): Buffer {
  const buf = Buffer.allocUnsafe(1 + 4 + 1 + 4);
  buf[0] = 0x45; // 'E'
  buf.writeUInt32BE(9, 1); // length
  buf[5] = 0; // empty portal name (null terminator)
  buf.writeUInt32BE(0, 6); // max rows (0 = unlimited)
  return buf;
}

/** @internal Exported for testing. Builds a PostgreSQL Describe ('D') message for an unnamed prepared statement. */
export function buildDescribeMessage(): Buffer {
  const buf = Buffer.allocUnsafe(1 + 4 + 1 + 1);
  buf[0] = 0x44; // 'D'
  buf.writeUInt32BE(6, 1); // length (self + context + null name)
  buf[5] = 0x53; // 'S' — describe prepared statement
  buf[6] = 0;    // empty statement name (null terminator)
  return buf;
}

/** @internal Exported for testing. Builds a PostgreSQL Sync ('S') message. */
export function buildSyncMessage(): Buffer {
  const buf = Buffer.allocUnsafe(5);
  buf[0] = 0x53; // 'S'
  buf.writeUInt32BE(4, 1);
  return buf;
}

function md5(input: string): string {
  return createHash('md5').update(input, 'binary').digest('hex');
}

// ─── SASL / SCRAM-SHA-256 ──────────────────────────────────────────────────────

/** @internal Exported for testing. Builds a SASLInitialResponse ('p') message. */
export function buildSASLInitialResponse(mechanism: string, clientFirstMessage: string): Buffer {
  const mechBuf = Buffer.from(mechanism + '\0', 'utf8');
  const firstBuf = Buffer.from(clientFirstMessage, 'utf8');
  const bodyLen = mechBuf.length + 4 + firstBuf.length;
  const buf = Buffer.allocUnsafe(1 + 4 + bodyLen);
  buf[0] = 0x70; // 'p'
  buf.writeUInt32BE(4 + bodyLen, 1);
  mechBuf.copy(buf, 5);
  buf.writeUInt32BE(firstBuf.length, 5 + mechBuf.length);
  firstBuf.copy(buf, 5 + mechBuf.length + 4);
  return buf;
}

/** @internal Exported for testing. Builds a SASLResponse ('p') message with raw client-final-message bytes. */
export function buildSASLResponse(clientFinalMessage: string): Buffer {
  const msgBuf = Buffer.from(clientFinalMessage, 'utf8');
  const buf = Buffer.allocUnsafe(1 + 4 + msgBuf.length);
  buf[0] = 0x70; // 'p'
  buf.writeUInt32BE(4 + msgBuf.length, 1);
  msgBuf.copy(buf, 5);
  return buf;
}

/** @internal Exported for testing. Parse a SASL mechanism list from buffer (null-terminated strings). */
export function parseSASLMechanisms(data: Buffer): string[] {
  const mechanisms: string[] = [];
  let offset = 0;
  while (offset < data.length) {
    const end = data.indexOf(0, offset);
    if (end === offset) break; // empty string = end of list (double null)
    if (end === -1) {
      // No null terminator found — take the rest of the buffer
      mechanisms.push(data.toString('utf8', offset));
      break;
    }
    mechanisms.push(data.toString('utf8', offset, end));
    offset = end + 1;
  }
  return mechanisms;
}

/** @internal Exported for testing. Parse SCRAM key=value parameters from a comma-separated message string. */
export function parseScramParams(message: string): Record<string, string> {
  const params: Record<string, string> = {};
  const parts = message.split(',');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      params[part.slice(0, eqIdx)] = part.slice(eqIdx + 1);
    }
  }
  return params;
}

/**
 * Validate that a string does not contain characters prohibited by RFC 4013 §3 (SASLprep).
 * Checks the most common prohibited categories after NFKC normalization.
 * @internal Exported for testing.
 */
export function validateSASLprep(s: string): boolean {
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i)!;
    // C.2.1 - ASCII control characters (U+0000-U+001F, U+007F-U+009F)
    if (cp <= 0x1F || (cp >= 0x7F && cp <= 0x9F)) return false;
    // C.5 - Surrogate code points (U+D800-U+DFFF) — shouldn't appear in valid JS strings
    if (cp >= 0xD800 && cp <= 0xDFFF) return false;
    // C.3 - Private use code points
    if ((cp >= 0xE000 && cp <= 0xF8FF) ||
        (cp >= 0xF0000 && cp <= 0xFFFFD) ||
        (cp >= 0x100000 && cp <= 0x10FFFD)) return false;
    // C.4 - Non-character code points (ending in FFFE or FFFF)
    if (cp <= 0x10FFFF && (cp & 0xFFFE) === 0xFFFE) return false;
    // C.4 - Non-character code points (U+FDD0-U+FDEF)
    if (cp >= 0xFDD0 && cp <= 0xFDEF) return false;
    i++;
    // Skip low surrogate if this was a supplementary character (outside BMP)
    if (cp > 0xFFFF) i++;
  }
  return true;
}

/**
 * Normalise a password for SCRAM using SASLprep (NFKC normalization
 * + RFC 4013 §3 character prohibition).
 * For ASCII passwords this is a no-op.
 */
function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

/**
 * SCRAM Hi() function: PBKDF2-SHA256.
 */
function scramHi(password: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(password, salt, iterations, 32, 'sha256');
}

/** @internal Exported for testing. XOR two buffers together (bytewise). */
export function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const len = Math.min(a.length, b.length);
  const out = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) {
    out[i] = a[i]! ^ b[i]!;
  }
  return out;
}

/**
 * Internal state for a multi-round SCRAM-SHA-256 authentication handshake.
 */
interface ScramState {
  clientFirstMessageBare: string;
  /** The client-generated nonce (before server concatenation) used for prefix validation in Round 2. */
  clientNonce: string;
  serverFirstMessage: string;
  saltedPassword: Buffer;
  authMessage: string;
}

// ─── PostgreSQL Row ────────────────────────────────────────────────────────────

export interface PgRow {
  [column: string]: string | null;
}

export interface PgResult {
  rows: PgRow[];
  command: string;
  rowCount: number;
}

// ─── Streaming result (backpressure-aware) ─────────────────────────────────────

export class StreetPostgresWireStream extends Readable {
  private _done = false;

  constructor() {
    super({ objectMode: true, highWaterMark: 64 });
  }

  /** Called internally when a DataRow is parsed */
  pushRow(row: PgRow): boolean {
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
    // Downstream wants more data — nothing to do in push mode
    // Socket resume is handled by the connection layer
  }
}

// ─── Connection ───────────────────────────────────────────────────────────────

export interface PgConnectOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectTimeoutMs?: number;
}

type PgState = 'connecting' | 'authenticating' | 'ready' | 'query' | 'closed';

interface FieldDescriptor {
  name: string;
  typeOid: number;
}

export class PgConnection {
  private socket: Socket | null = null;
  private state: PgState = 'connecting';
  private buffer = Buffer.alloc(0);
  private fields: FieldDescriptor[] = [];

  // Multi-round SASL/SCRAM auth state
  private scramState: ScramState | null = null;

  // Pending query callbacks
  private queryResolve: ((result: PgResult) => void) | null = null;
  private queryReject: ((err: Error) => void) | null = null;
  private queryRows: PgRow[] = [];
  private queryCommand = '';
  private streamTarget: StreetPostgresWireStream | null = null;

  // Auth resolve
  private authResolve: (() => void) | null = null;
  private authReject: ((err: Error) => void) | null = null;

  static async connect(opts: PgConnectOptions): Promise<PgConnection> {
    const conn = new PgConnection();
    await conn._connect(opts);
    return conn;
  }

  private _connect(opts: PgConnectOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutMs = opts.connectTimeoutMs ?? 10_000;
      const timer = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error('PostgreSQL connection timeout'));
      }, timeoutMs);
      timer.unref();

      this.authResolve = () => { clearTimeout(timer); resolve(); };
      this.authReject = (err) => { clearTimeout(timer); reject(err); };

      const socket = createConnection({ host: opts.host, port: opts.port });
      this.socket = socket;

      socket.setKeepAlive(true, 10_000);
      socket.setNoDelay(true);

      socket.once('connect', () => {
        this.state = 'authenticating';
        socket.write(buildStartupMessage(opts.user, opts.database));
      });

      socket.on('data', (chunk: Buffer) => {
        // Finding 9 fix: enforce a hard cap on the receive buffer during
        // authentication to prevent a malicious server from causing OOM.
        // During normal query operation the pool's connection timeout and
        // per-query row limits provide the primary protection.
        const MAX_AUTH_BUFFER = 64 * 1024; // 64 KB — more than enough for any auth exchange
        if (this.state === 'authenticating' &&
            this.buffer.length + chunk.length > MAX_AUTH_BUFFER) {
          socket.destroy(new Error('PostgreSQL auth response exceeded 64 KB limit'));
          if (this.authReject) {
            this.authReject(new Error('PostgreSQL auth response too large'));
            this.authReject = null;
          }
          return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this._processBuffer(opts);
      });

      socket.once('error', (err) => {
        this.state = 'closed';
        if (this.authReject) { this.authReject(err); this.authReject = null; }
        if (this.queryReject) { this.queryReject(err); this.queryReject = null; }
        if (this.streamTarget) { this.streamTarget.finalize(err); this.streamTarget = null; }
      });

      socket.once('close', () => {
        this.state = 'closed';
        const err = new Error('PostgreSQL connection closed unexpectedly');
        if (this.queryReject) { this.queryReject(err); this.queryReject = null; }
        if (this.streamTarget) { this.streamTarget.finalize(err); this.streamTarget = null; }
      });
    });
  }

  private _processBuffer(opts: PgConnectOptions): void {
    while (this.buffer.length >= 5) {
      const msgType = this.buffer[0]!;
      const msgLen = this.buffer.readUInt32BE(1);
      const totalLen = 1 + msgLen;

      if (this.buffer.length < totalLen) break;

      const msgBody = this.buffer.subarray(5, totalLen);
      this.buffer = this.buffer.subarray(totalLen);

      this._handleMessage(msgType, msgBody, opts);
    }
  }

  private _handleMessage(type: number, body: Buffer, opts: PgConnectOptions): void {
    switch (type) {
      case BackendMsg.AuthRequest:
        this._handleAuth(body, opts);
        break;

      case BackendMsg.ParameterStatus:
        // e.g. "server_version=16.0" — ignore
        break;

      case BackendMsg.BackendKeyData:
        // pid + secret key — ignore for now
        break;

      case BackendMsg.ReadyForQuery:
        if (this.state === 'authenticating') {
          this.state = 'ready';
          if (this.authResolve) { this.authResolve(); this.authResolve = null; }
        } else if (this.state === 'query') {
          this.state = 'ready';
          const rows = this.queryRows;
          const cmd = this.queryCommand;
          const resolve = this.queryResolve;
          const stream = this.streamTarget;

          this.queryRows = [];
          this.queryCommand = '';
          this.queryResolve = null;
          this.queryReject = null;
          this.streamTarget = null;
          this.fields = [];

          if (stream) {
            stream.finalize();
          } else if (resolve) {
            // Parse row count from CommandComplete message when available
            // CommandComplete examples: "SELECT 3", "INSERT 0 1", "DELETE 2"
            const rcMatch = cmd.match(/(\d+)\s*$/);
            const rowCount = rcMatch ? parseInt(rcMatch[1]!, 10) : rows.length;
            resolve({ rows, command: cmd, rowCount });
          }
        }
        break;

      case BackendMsg.RowDescription:
        this.fields = this._parseRowDescription(body);
        break;

      case BackendMsg.DataRow: {
        const row = this._parseDataRow(body);
        if (this.streamTarget) {
          const canContinue = this.streamTarget.pushRow(row);
          if (!canContinue && this.socket) {
            this.socket.pause(); // backpressure
          }
        } else {
          this.queryRows.push(row);
        }
        break;
      }

      case BackendMsg.CommandComplete: {
        const cmd = body.toString('utf8').replace(/\0$/, '');
        this.queryCommand = cmd;
        break;
      }

      case BackendMsg.EmptyQuery:
        this.queryCommand = '';
        break;

      case BackendMsg.ErrorResponse: {
        const err = this._parseError(body);
        // Move to ready state immediately to avoid leaving the connection
        // stuck in "query" if the client checks isReady right after an error.
        if (this.state === 'query') this.state = 'ready';

        if (this.state === 'authenticating') {
          if (this.authReject) { this.authReject(err); this.authReject = null; }
        } else {
          if (this.streamTarget) {
            this.streamTarget.finalize(err);
            this.streamTarget = null;
          } else if (this.queryReject) {
            this.queryReject(err);
            this.queryReject = null;
          }
          // Clear any pending resolve to avoid duplicate callbacks when ReadyForQuery arrives
          this.queryResolve = null;
        }
        // After error, server will still send ReadyForQuery; ignore duplicate handling
        break;
      }

      case BackendMsg.NoticeResponse:
        // Log notices but don't block
        break;

      default:
        // Unknown message type — skip
        break;
    }
  }

  private _handleAuth(body: Buffer, opts: PgConnectOptions): void {
    const authType = body.readUInt32BE(0);

    switch (authType) {
      case AuthType.Ok:
        // Auth succeeded — wait for ReadyForQuery
        break;

      case AuthType.CleartextPassword:
        this.socket?.write(buildPasswordMessage(opts.password));
        break;

      case AuthType.MD5Password: {
        const salt = body.subarray(4, 8);
        this.socket?.write(buildMD5Password(opts.password, opts.user, salt));
        break;
      }

      case AuthType.SASL: {
        // AuthenticationSASL — server sent the list of supported SASL mechanisms
        const mechanisms = parseSASLMechanisms(body.subarray(4));
        const scramMechanism = mechanisms.find((m) => m === 'SCRAM-SHA-256');
        if (!scramMechanism) {
          if (this.authReject) {
            this.authReject(new Error('Server does not advertise SCRAM-SHA-256'));
            this.authReject = null;
          }
          return;
        }

        // Generate client-first-message with gs2-header: "n,,n=user,r=nonce"
        const cNonce = randomBytes(18).toString('base64url');
        const gs2Header = 'n,,';
        const clientFirstMessageBare = `n=${opts.user},r=${cNonce}`;
        const clientFirstMessage = gs2Header + clientFirstMessageBare;

        this.scramState = {
          clientFirstMessageBare,
          clientNonce: cNonce,
          serverFirstMessage: '',
          saltedPassword: Buffer.alloc(0),
          authMessage: '',
        };

        this.socket?.write(buildSASLInitialResponse(scramMechanism, clientFirstMessage));
        break;
      }

      case AuthType.SASLContinue: {
        // AuthenticationSASLContinue — server responded with server-first-message
        if (!this.scramState) {
          if (this.authReject) {
            this.authReject(new Error('Unexpected SASL continue without prior SASL handshake'));
            this.authReject = null;
          }
          return;
        }

        const serverFirstMessage = body.subarray(4).toString('utf8');
        this.scramState.serverFirstMessage = serverFirstMessage;

        // Parse server-first-message fields: r=<nonce>, s=<base64-salt>, i=<iterations>
        const params = parseScramParams(serverFirstMessage);
        const nonce = params['r'];
        const saltB64 = params['s'];
        const iterationsStr = params['i'];

        if (!nonce || !saltB64 || !iterationsStr) {
          if (this.authReject) {
            this.authReject(new Error('Malformed SCRAM server-first-message'));
            this.authReject = null;
          }
          return;
        }

        // RFC 5802 §7: Client MUST verify that the server's combined nonce starts
        // with the client's original nonce to prevent nonce substitution attacks.
        if (!nonce.startsWith(this.scramState.clientNonce)) {
          if (this.authReject) {
            this.authReject(new Error('SCRAM nonce mismatch — server nonce does not start with client nonce'));
            this.authReject = null;
          }
          return;
        }

        const salt = Buffer.from(saltB64, 'base64');
        const iterations = parseInt(iterationsStr, 10);

        // Validate salt length and iteration count
        if (salt.length === 0 || !Number.isFinite(iterations) || iterations < 4096 || iterations > 10_000_000) {
          if (this.authReject) {
            this.authReject(new Error('SCRAM server sent invalid salt length or iteration count'));
            this.authReject = null;
          }
          return;
        }

        // Compute SaltedPassword = Hi(normalize(password), salt, iterations)
        const normalizedPassword = normalizePassword(opts.password);

        // Validate normalized password against SASLprep character prohibitions
        if (!validateSASLprep(normalizedPassword)) {
          if (this.authReject) {
            this.authReject(new Error('Password contains characters prohibited by SASLprep (RFC 4013)'));
            this.authReject = null;
          }
          return;
        }
        const saltedPassword = scramHi(normalizedPassword, salt, iterations);
        this.scramState.saltedPassword = saltedPassword;

        // Compute ClientKey = HMAC(SaltedPassword, "Client Key")
        const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();

        // Compute StoredKey = SHA256(ClientKey)
        const storedKey = createHash('sha256').update(clientKey).digest();

        // Build client-final-message-without-proof
        const clientFinalMessageWithoutProof = `c=biws,r=${nonce}`;

        // Compute AuthMessage = client-first-message-bare + "," + server-first-message + "," + client-final-message-without-proof
        const authMessage = `${this.scramState.clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageWithoutProof}`;
        this.scramState.authMessage = authMessage;

        // Compute ClientSignature = HMAC(StoredKey, AuthMessage)
        const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();

        // Compute ClientProof = ClientKey XOR ClientSignature
        const clientProof = xorBuffers(clientKey, clientSignature);

        // Build client-final-message: client-final-message-without-proof + ",p=" + base64(client-proof)
        const clientFinalMessage = `${clientFinalMessageWithoutProof},p=${clientProof.toString('base64')}`;

        this.socket?.write(buildSASLResponse(clientFinalMessage));
        break;
      }

      case AuthType.SASLFinal: {
        // AuthenticationSASLFinal — server sent server-final-message with server-signature
        if (!this.scramState) {
          if (this.authReject) {
            this.authReject(new Error('Unexpected SASL final without prior SASL handshake'));
            this.authReject = null;
          }
          return;
        }

        const serverFinalMessage = body.subarray(4).toString('utf8');
        const params = parseScramParams(serverFinalMessage);
        const serverSignatureB64 = params['v'];

        if (!serverSignatureB64) {
          // No server signature — likely an error from the server
          const errMsg = params['e'] ?? 'SCRAM authentication failed (no verifier)';
          if (this.authReject) {
            this.authReject(new Error(`SCRAM authentication failed: ${errMsg}`));
            this.authReject = null;
          }
          return;
        }

        // Verify server signature: ServerSignature = HMAC(ServerKey, AuthMessage)
        // Use timingSafeEqual to prevent timing side-channel attacks on the comparison.
        const serverKey = createHmac('sha256', this.scramState.saltedPassword).update('Server Key').digest();
        const expectedSignature = createHmac('sha256', serverKey).update(this.scramState.authMessage).digest();
        const sigBuf = Buffer.from(serverSignatureB64, 'base64');

        if (sigBuf.length !== expectedSignature.length || !timingSafeEqual(sigBuf, expectedSignature)) {
          if (this.authReject) {
            this.authReject(new Error('SCRAM server signature mismatch — possible MITM attack'));
            this.authReject = null;
          }
          return;
        }

        // Server verified — clear SCRAM state, wait for AuthenticationOk
        this.scramState = null;
        break;
      }

      default:
        if (this.authReject) {
          this.authReject(new Error(`Unsupported PostgreSQL auth method: ${authType}`));
          this.authReject = null;
        }
    }
  }

  private _parseRowDescription(body: Buffer): FieldDescriptor[] {
    // Finding 9 fix: add bounds checks throughout to prevent OOB reads
    // on malformed packets from a misbehaving or malicious server.
    if (body.length < 2) return [];
    const fieldCount = body.readUInt16BE(0);
    const fields: FieldDescriptor[] = [];
    let offset = 2;
    for (let i = 0; i < fieldCount; i++) {
      if (offset >= body.length) break;
      const nameEnd = body.indexOf(0, offset);
      // No null terminator found, or not enough bytes for the fixed metadata
      if (nameEnd === -1 || nameEnd + 1 + 18 > body.length) break;
      const name = body.toString('utf8', offset, nameEnd);
      // typeOid is at nameEnd+1 (tableOid=4) + (attNum=2) = nameEnd+7
      const typeOid = body.readUInt32BE(nameEnd + 1 + 6);
      offset = nameEnd + 1 + 18; // skip tableOid(4)+attNum(2)+typeOid(4)+typeSize(2)+typeMod(4)+format(2)
      fields.push({ name, typeOid });
    }
    return fields;
  }

  private _parseDataRow(body: Buffer): PgRow {
    // Finding 9 fix: add bounds checks to prevent OOB reads on malformed packets.
    if (body.length < 2) return {};
    const colCount = body.readUInt16BE(0);
    const row: PgRow = {};
    let offset = 2;
    for (let i = 0; i < colCount; i++) {
      if (offset + 4 > body.length) break; // not enough bytes for length prefix
      const len = body.readInt32BE(offset);
      offset += 4;
      const fieldName = this.fields[i]?.name ?? `col${i}`;
      if (len === -1) {
        row[fieldName] = null;
      } else {
        if (len < 0 || offset + len > body.length) break; // malformed length
        row[fieldName] = body.toString('utf8', offset, offset + len);
        offset += len;
      }
    }
    return row;
  }

  private _parseError(body: Buffer): Error {
    const fields: Record<string, string> = {};
    let i = 0;
    while (i < body.length) {
      const code = String.fromCharCode(body[i]!);
      if (code === '\0') break;
      i++;
      const end = body.indexOf(0, i);
      // Finding B fix: if no null terminator found, stop parsing to prevent
      // i = -1 + 1 = 0 infinite loop on malformed error packets.
      if (end === -1) break;
      fields[code] = body.toString('utf8', i, end);
      i = end + 1;
    }
    const msg = fields['M'] ?? 'Unknown PostgreSQL error';
    const detail = fields['D'] ?? '';
    return new Error(`PostgreSQL: ${msg}${detail ? ' — ' + detail : ''}`);
  }

  /** Execute a query with optional parameters, return all rows buffered */
  query(sql: string, params?: unknown[]): Promise<PgResult> {
    if (this.state !== 'ready') {
      return Promise.reject(new Error(`Cannot query: connection is in state "${this.state}"`));
    }

    // Use extended query protocol when params are provided
    if (params !== undefined && params.length > 0) {
      return this._queryParams(sql, params);
    }

    return new Promise((resolve, reject) => {
      this.state = 'query';
      this.queryResolve = resolve;
      this.queryReject = reject;
      this.queryRows = [];
      this.streamTarget = null;
      this.socket?.write(buildQueryMessage(sql));
    });
  }

  /** Execute a parameterized query using Parse/Describe/Bind/Execute/Sync protocol */
  private _queryParams(sql: string, params: unknown[]): Promise<PgResult> {
    return new Promise((resolve, reject) => {
      this.state = 'query';
      this.queryResolve = resolve;
      this.queryReject = reject;
      this.queryRows = [];
      this.streamTarget = null;

      const parseMsg = buildParseMessage(sql);
      const describeMsg = buildDescribeMessage();
      const bindMsg = buildBindMessage(params);
      const execMsg = buildExecuteMessage();
      const syncMsg = buildSyncMessage();

      // Send Parse/Describe first so the server sends RowDescription,
      // then Bind/Execute/Sync to execute with actual parameters.
      // We send Describe BEFORE Bind to get column metadata before row data.
      this.socket?.write(Buffer.concat([parseMsg, describeMsg, bindMsg, execMsg, syncMsg]));
    });
  }

  /** Execute a query, return a Readable stream of PgRow objects */
  queryStream(sql: string): StreetPostgresWireStream {
    const stream = new StreetPostgresWireStream();

    if (this.state !== 'ready') {
      setImmediate(() => stream.finalize(new Error(`Cannot query: connection state is "${this.state}"`)));
      return stream;
    }

    this.state = 'query';
    this.streamTarget = stream;
    this.queryResolve = null;
    this.queryReject = null;
    this.queryRows = [];

    // Resume socket when consumer reads from stream
    stream.on('resume', () => {
      this.socket?.resume();
    });

    this.socket?.write(buildQueryMessage(sql));
    return stream;
  }

  /** Close the connection gracefully */
  async close(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closed';
    return new Promise((resolve) => {
      if (!this.socket) { resolve(); return; }
      this.socket.write(buildTerminateMessage(), () => {
        this.socket?.destroy();
        resolve();
      });
    });
  }

  get isReady(): boolean {
    return this.state === 'ready';
  }

  get isClosed(): boolean {
    return this.state === 'closed';
  }

  /** Sign a payload with HMAC-SHA256 (utility method) */
  static hmacSign(key: string, data: string): string {
    return createHmac('sha256', key).update(data).digest('hex');
  }
}
