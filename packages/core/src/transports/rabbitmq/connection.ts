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
  private pendingDelivery: { tag: string; msg: Omit<DeliveredMessage, 'body'>; bodySize: number; chunks: Buffer[] } | null = null;
  private readonly consumers = new Map<string, (msg: DeliveredMessage) => void>();

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

  private _startHeartbeat(): void {
    if (this.opts.heartbeatSeconds <= 0) return;
    const intervalMs = (this.opts.heartbeatSeconds * 1000) / 2;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && !this.socket.destroyed) this.socket.write(buildHeartbeat());
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  private _handleServerClose(reader: import('./codec.js').AmqpReader): void {
    const code = reader.shortUint();
    const text = reader.shortStr();
    this._send(buildMethodFrame(0, 10, 51, Buffer.alloc(0))); // Connection.Close-Ok
    this.emit('error', new Error(`AMQP server closed connection: ${code} ${text}`));
  }

  private _onClose(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (!this.closing) this.emit('disconnect');
    this.emit('close');
  }

  // ── Declarations ──────────────────────────────────────────────────────────

  /** Declare an exchange. Types: 'direct' | 'fanout' | 'topic'. */
  async declareExchange(name: string, type: 'direct' | 'fanout' | 'topic', opts: { durable?: boolean } = {}): Promise<void> {
    const args = new AmqpWriter()
      .shortUint(0)            // reserved-1
      .shortStr(name)
      .shortStr(type)
      .bits(false, opts.durable ?? true, false, false, false) // passive, durable, auto-delete, internal, no-wait
      .table({})
      .build();
    await this._rpc(buildMethodFrame(CH, 40, 10, args), 40, 11); // Exchange.Declare-Ok
  }

  /** Declare a queue. Returns the queue name (server-generated if empty). */
  async declareQueue(name: string, opts: { durable?: boolean; deadLetterExchange?: string; messageTtlMs?: number } = {}): Promise<string> {
    const tableArgs: Record<string, unknown> = {};
    if (opts.deadLetterExchange) tableArgs['x-dead-letter-exchange'] = opts.deadLetterExchange;
    if (typeof opts.messageTtlMs === 'number') tableArgs['x-message-ttl'] = opts.messageTtlMs;
    const args = new AmqpWriter()
      .shortUint(0)
      .shortStr(name)
      .bits(false, opts.durable ?? true, false, false, false) // passive, durable, exclusive, auto-delete, no-wait
      .table(tableArgs)
      .build();
    const { reader } = await this._rpc(buildMethodFrame(CH, 50, 10, args), 50, 11); // Queue.Declare-Ok
    return reader.shortStr();
  }

  /** Bind a queue to an exchange with a routing key. */
  async bindQueue(queue: string, exchange: string, routingKey: string): Promise<void> {
    const args = new AmqpWriter()
      .shortUint(0)
      .shortStr(queue)
      .shortStr(exchange)
      .shortStr(routingKey)
      .octet(0)   // no-wait
      .table({})
      .build();
    await this._rpc(buildMethodFrame(CH, 50, 20, args), 50, 21); // Queue.Bind-Ok
  }

  /** Enable publisher confirms on the channel. */
  async enableConfirms(): Promise<void> {
    if (this.confirmEnabled) return;
    await this._rpc(buildMethodFrame(CH, 85, 10, new AmqpWriter().octet(0).build()), 85, 11); // Confirm.Select-Ok
    this.confirmEnabled = true;
  }

  /** Set prefetch (QoS) so consumers don't get flooded. */
  async setQos(prefetchCount: number): Promise<void> {
    const args = new AmqpWriter().longUint(0).shortUint(prefetchCount).octet(0).build();
    await this._rpc(buildMethodFrame(CH, 60, 10, args), 60, 11); // Basic.Qos-Ok
  }

  // ── Publish ─────────────────────────────────────────────────────────────────

  /**
   * Publish a message. When confirms are enabled, the returned promise resolves
   * once the broker acks the publish (or rejects on nack).
   */
  async publish(exchange: string, routingKey: string, body: Buffer, opts: { persistent?: boolean; contentType?: string } = {}): Promise<void> {
    const methodArgs = new AmqpWriter()
      .shortUint(0)
      .shortStr(exchange)
      .shortStr(routingKey)
      .bits(false, false) // mandatory, immediate
      .build();
    const props: Record<string, unknown> = {};
    if (opts.contentType) props['contentType'] = opts.contentType;
    if (opts.persistent !== false) props['deliveryMode'] = 2; // persistent by default

    const tag = this.confirmEnabled ? this.nextPublishTag++ : 0n;
    const confirm = this.confirmEnabled
      ? new Promise<void>((resolve, reject) => {
          this.confirmWaiters.set(tag.toString(), () => resolve());
          // store reject alongside for nack
          this.confirmWaiters.set(`rej:${tag}`, (() => reject(new Error('publish nacked'))) as never);
        })
      : Promise.resolve();

    this._send(buildMethodFrame(CH, 60, 40, methodArgs));        // Basic.Publish
    this._send(buildHeaderFrame(CH, 60, body.length, props));    // content header
    if (body.length > 0) this._send(buildBodyFrame(CH, body));   // body

    await confirm;
  }

  private _handleConfirm(reader: import('./codec.js').AmqpReader, nack: boolean): void {
    const tag = reader.longLong();
    const multiple = reader.bit();
    const resolveTag = (t: string): void => {
      if (nack) {
        const rej = this.confirmWaiters.get(`rej:${t}`);
        if (rej) rej();
      } else {
        const ok = this.confirmWaiters.get(t);
        if (ok) ok();
      }
      this.confirmWaiters.delete(t);
      this.confirmWaiters.delete(`rej:${t}`);
    };
    if (multiple) {
      for (const key of [...this.confirmWaiters.keys()]) {
        if (key.startsWith('rej:')) continue;
        if (BigInt(key) <= tag) resolveTag(key);
      }
    } else {
      resolveTag(tag.toString());
    }
  }

  // ── Consume ─────────────────────────────────────────────────────────────────

  /** Start consuming from a queue. Deliveries are passed to `handler`. */
  async consume(queue: string, handler: (msg: DeliveredMessage) => void, opts: { noAck?: boolean } = {}): Promise<string> {
    const args = new AmqpWriter()
      .shortUint(0)
      .shortStr(queue)
      .shortStr('')  // consumer-tag (server generates)
      .bits(false, opts.noAck ?? false, false, false) // no-local, no-ack, exclusive, no-wait
      .table({})
      .build();
    const { reader } = await this._rpc(buildMethodFrame(CH, 60, 20, args), 60, 21); // Basic.Consume-Ok
    const tag = reader.shortStr();
    this.consumers.set(tag, handler);
    return tag;
  }

  private _beginDelivery(reader: import('./codec.js').AmqpReader): void {
    const consumerTag = reader.shortStr();
    const deliveryTag = reader.longLong();
    const redelivered = reader.bit();
    const exchange = reader.shortStr();
    const routingKey = reader.shortStr();
    this.pendingDelivery = { tag: consumerTag, msg: { deliveryTag, redelivered, exchange, routingKey }, bodySize: 0, chunks: [] };
  }

  private _handleHeader(frame: RawFrame): void {
    if (!this.pendingDelivery) return;
    // payload: class-id(2) weight(2) body-size(8) flags(2) [props...]
    const bodySize = Number(frame.payload.readBigUInt64BE(4));
    this.pendingDelivery.bodySize = bodySize;
    if (bodySize === 0) this._finishDelivery();
  }

  private _handleBody(frame: RawFrame): void {
    if (!this.pendingDelivery) return;
    this.pendingDelivery.chunks.push(frame.payload);
    const have = this.pendingDelivery.chunks.reduce((n, b) => n + b.length, 0);
    if (have >= this.pendingDelivery.bodySize) this._finishDelivery();
  }

  private _finishDelivery(): void {
    if (!this.pendingDelivery) return;
    const { tag, msg, chunks } = this.pendingDelivery;
    this.pendingDelivery = null;
    const message: DeliveredMessage = { ...msg, body: Buffer.concat(chunks) };
    const handler = this.consumers.get(tag);
    if (handler) handler(message);
  }

  /** Abruptly drop the socket to simulate a network failure (used in tests). */
  simulateDrop(): void {
    this.socket?.destroy();
  }

  /** Acknowledge a delivery. */
  ack(deliveryTag: bigint): void {
    const args = new AmqpWriter().longLong(deliveryTag).bits(false).build();
    this._send(buildMethodFrame(CH, 60, 80, args)); // Basic.Ack
  }

  /** Negatively acknowledge a delivery; `requeue` controls redelivery. */
  nack(deliveryTag: bigint, requeue: boolean): void {
    const args = new AmqpWriter().longLong(deliveryTag).bits(false, requeue).build();
    this._send(buildMethodFrame(CH, 60, 120, args)); // Basic.Nack
  }

  /** Gracefully close the connection. */
  async close(): Promise<void> {
    this.closing = true;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    try {
      if (this.socket && !this.socket.destroyed) {
        const args = new AmqpWriter().shortUint(200).shortStr('OK').shortUint(0).shortUint(0).build();
        this._send(buildMethodFrame(0, 10, 50, args)); // Connection.Close
      }
    } catch { /* ignore */ }
    this.socket?.destroy();
    this.socket = null;
  }

  get connected(): boolean { return this.socket !== null && !this.socket.destroyed; }
}
