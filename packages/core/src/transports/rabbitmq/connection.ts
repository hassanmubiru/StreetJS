// src/transports/rabbitmq/connection.ts
// AMQP 0-9-1 connection + single-channel manager over node:net. Implements the
// handshake, channel/exchange/queue declaration, publisher confirms, consumer
// delivery + ack/nack, heartbeats, and graceful close.

import { createConnection, type Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import {
  PROTOCOL_HEADER, FRAME_METHOD, FRAME_HEADER, FRAME_BODY, FRAME_HEARTBEAT,
  AmqpWriter, FrameDecoder, buildMethodFrame, buildHeaderFrame, buildBodyFrame,
  buildHeartbeat, readMethodHeader, type RawFrame,
} from './codec.js';

export interface AmqpConnectionOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
  heartbeatSeconds?: number;
  connectTimeoutMs?: number;
}

export interface DeliveredMessage {
  deliveryTag: bigint;
  redelivered: boolean;
  exchange: string;
  routingKey: string;
  body: Buffer;
}

const CH = 1; // single working channel

export class AmqpConnection extends EventEmitter {
  private socket: Socket | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly opts: Required<AmqpConnectionOptions>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private closing = false;

  // class.method → resolver for synchronous server replies
  private readonly waiters = new Map<string, (r: { reader: import('./codec.js').AmqpReader }) => void>();
  // publisher confirms: delivery-tag → resolver
  private nextPublishTag = 1n;
  private readonly confirmWaiters = new Map<string, () => void>();
  private confirmEnabled = false;

  // consumer assembly state
  private pendingDelivery: { msg: Omit<DeliveredMessage, 'body'>; bodySize: number; chunks: Buffer[] } | null = null;
  private deliverHandler: ((msg: DeliveredMessage) => void) | null = null;

  constructor(opts: AmqpConnectionOptions = {}) {
    super();
    this.opts = {
      host: opts.host ?? '127.0.0.1',
      port: opts.port ?? 5672,
      username: opts.username ?? 'guest',
      password: opts.password ?? 'guest',
      vhost: opts.vhost ?? '/',
      heartbeatSeconds: opts.heartbeatSeconds ?? 60,
      connectTimeoutMs: opts.connectTimeoutMs ?? 10_000,
    };
  }

  private _key(classId: number, methodId: number): string { return `${classId}.${methodId}`; }

  private _send(frame: Buffer): void {
    if (!this.socket || this.socket.destroyed) throw new Error('AMQP socket not connected');
    this.socket.write(frame);
  }

  private _rpc(sendFrame: Buffer, expectClass: number, expectMethod: number): Promise<{ reader: import('./codec.js').AmqpReader }> {
    return new Promise((resolve) => {
      this.waiters.set(this._key(expectClass, expectMethod), resolve);
      this._send(sendFrame);
    });
  }

  /** Open the TCP socket, perform the AMQP handshake, and open a channel. */
  async connect(): Promise<void> {
    this.closing = false;
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection({ host: this.opts.host, port: this.opts.port }, () => {
        sock.write(PROTOCOL_HEADER);
      });
      const to = setTimeout(() => { sock.destroy(); reject(new Error('AMQP connect timeout')); }, this.opts.connectTimeoutMs);
      to.unref();

      let handshakeDone = false;
      const onError = (err: Error): void => { clearTimeout(to); if (!handshakeDone) reject(err); else this.emit('error', err); };
      sock.on('error', onError);
      sock.on('data', (chunk: Buffer) => this._onData(chunk));
      sock.on('close', () => this._onClose());

      this.socket = sock;
      this.once('_open', () => { clearTimeout(to); handshakeDone = true; resolve(); });
      this.once('_handshakeError', (e: Error) => { clearTimeout(to); reject(e); });
    });
  }

  private _onData(chunk: Buffer): void {
    this.decoder.push(chunk);
    let frame = this.decoder.next();
    while (frame !== null) {
      try { this._handleFrame(frame); }
      catch (err) { this.emit('error', err instanceof Error ? err : new Error(String(err))); }
      frame = this.decoder.next();
    }
  }

  private _handleFrame(frame: RawFrame): void {
    if (frame.type === FRAME_HEARTBEAT) return;
    if (frame.type === FRAME_HEADER) { this._handleHeader(frame); return; }
    if (frame.type === FRAME_BODY) { this._handleBody(frame); return; }
    if (frame.type !== FRAME_METHOD) return;

    const { classId, methodId, reader } = readMethodHeader(frame.payload);

    // Handshake-driving methods
    if (classId === 10 && methodId === 10) { this._sendStartOk(); return; }          // Connection.Start
    if (classId === 10 && methodId === 30) { this._sendTuneOkAndOpen(reader); return; } // Connection.Tune
    if (classId === 10 && methodId === 41) { this._afterConnectionOpen(); return; }   // Connection.Open-Ok
    if (classId === 10 && methodId === 50) { this._handleServerClose(reader); return; } // Connection.Close

    // Async deliveries / confirms
    if (classId === 60 && methodId === 60) { this._beginDelivery(reader); return; }   // Basic.Deliver
    if (classId === 60 && methodId === 80) { this._handleConfirm(reader, false); return; } // Basic.Ack
    if (classId === 60 && methodId === 120) { this._handleConfirm(reader, true); return; } // Basic.Nack

    // Synchronous replies
    const waiter = this.waiters.get(this._key(classId, methodId));
    if (waiter) {
      this.waiters.delete(this._key(classId, methodId));
      waiter({ reader });
    }
  }

  private _sendStartOk(): void {
    const clientProps = { product: 'street-framework', platform: 'node', version: '1.0', information: 'AMQP 0-9-1' };
    const args = new AmqpWriter()
      .table(clientProps)
      .shortStr('PLAIN')
      .longStr(`\0${this.opts.username}\0${this.opts.password}`)
      .shortStr('en_US')
      .build();
    this._send(buildMethodFrame(0, 10, 11, args)); // Connection.Start-Ok
  }

  private _sendTuneOkAndOpen(reader: import('./codec.js').AmqpReader): void {
    const channelMax = reader.shortUint();
    const frameMax = reader.longUint();
    reader.shortUint(); // server heartbeat suggestion (ignored; we set our own)
    const hb = this.opts.heartbeatSeconds;
    const tuneOk = new AmqpWriter().shortUint(channelMax || 0).longUint(frameMax || 131072).shortUint(hb).build();
    this._send(buildMethodFrame(0, 10, 31, tuneOk)); // Connection.Tune-Ok
    const open = new AmqpWriter().shortStr(this.opts.vhost).shortStr('').octet(0).build();
    this._send(buildMethodFrame(0, 10, 40, open)); // Connection.Open
  }

  private _afterConnectionOpen(): void {
    // Open the working channel.
    this._rpc(buildMethodFrame(CH, 20, 10, new AmqpWriter().shortStr('').build()), 20, 11)
      .then(() => {
        this._startHeartbeat();
        this.emit('_open');
      })
      .catch((e: Error) => this.emit('_handshakeError', e));
  }
