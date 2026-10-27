// packages/client/src/realtime.ts
// Realtime client over the platform WebSocket (injectable for Node/tests).
// Uses a simple JSON envelope: { type, channel, data }.

import { StreetClientError } from './errors.js';
import { trimTrailingSlashes } from './http.js';
import type { StreetClientConfig } from './http.js';

export interface RealtimeMessage<T = unknown> { type: string; channel?: string; data?: T; }
export type MessageHandler<T = unknown> = (msg: RealtimeMessage<T>) => void;
export type RealtimeConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
export type RealtimeStateHandler = (state: RealtimeConnectionState) => void;

export interface RealtimeClientOptions {
  /** Reconnect after an unexpected socket close. Defaults to true. */
  reconnect?: boolean;
  /** Initial reconnect delay in milliseconds. Defaults to 250. */
  reconnectDelayMs?: number;
  /** Maximum reconnect delay in milliseconds. Defaults to 10 seconds. */
  maxReconnectDelayMs?: number;
}

interface WsLike {
  send(data: string): void;
  close(): void;
  /** WebSocket.OPEN when available; omitted by small test implementations. */
  readonly readyState?: number;
  addEventListener(type: string, cb: (ev: { data?: unknown }) => void): void;
}
type WsCtor = new (url: string) => WsLike;

/**
 * Rewrite a leading http(s) scheme to the matching ws(s) scheme:
 * `http://` → `ws://`, `https://` → `wss://`. Only the leading `http` (4 chars)
 * is replaced, so the trailing `s` of `https` is preserved — matching the old
 * `replace(/^http/, 'ws')` exactly, but with `startsWith` + `slice` (O(n), no
 * regex). Inputs not starting with `http` are returned unchanged.
 */
function httpToWs(url: string): string {
  return url.startsWith('http') ? `ws${url.slice(4)}` : url;
}

/** True when `url` begins with an absolute http(s) scheme. Regex-free. */
function isAbsoluteHttp(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** Convert an http(s) base + path into a ws(s) URL. */
export function toWsUrl(baseUrl: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (isAbsoluteHttp(baseUrl)) {
    return httpToWs(trimTrailingSlashes(baseUrl)) + p;
  }
  // Relative base — only resolvable in a browser with location.
  const loc = (globalThis as { location?: { origin: string } }).location;
  if (!loc) throw new StreetClientError('Realtime needs an absolute baseUrl (or a browser location) to build a ws:// URL.');
  const origin = httpToWs(loc.origin);
  return origin + trimTrailingSlashes(baseUrl) + p;
}

/**
 * A thin realtime client. Connect, subscribe to channels, publish, and receive
 * JSON-enveloped messages. The WebSocket implementation is injectable.
 */
export class RealtimeClient {
  private ws: WsLike | null = null;
  private readonly handlers = new Map<string, Set<MessageHandler>>();
  private readonly any = new Set<MessageHandler>();
  private readonly stateHandlers = new Set<RealtimeStateHandler>();
  private readonly pending: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private currentState: RealtimeConnectionState = 'idle';

  constructor(
    private readonly url: string,
    private readonly WebSocketImpl: WsCtor,
    private readonly options: RealtimeClientOptions = {},
  ) {}

  /** Current connection lifecycle state. */
  get state(): RealtimeConnectionState {
    return this.currentState;
  }

  connect(): void {
    if (this.ws || this.reconnectTimer !== undefined) return;
    this.manuallyClosed = false;
    this.openSocket(false);
  }

  private openSocket(reconnecting: boolean): void {
    this.setState(reconnecting ? 'reconnecting' : 'connecting');
    let ws: WsLike;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch (error) {
      this.ws = null;
      this.setState('idle');
      this.scheduleReconnect(error);
      return;
    }
    this.ws = ws;
    ws.addEventListener('message', (ev) => this.onMessage(ev.data));
    ws.addEventListener('open', () => this.handleOpen(ws));
    ws.addEventListener('close', () => this.handleClose(ws));

    // Browser WebSockets start in CONNECTING (0), while lightweight injected
    // implementations often omit readyState and are immediately usable.
    if (ws.readyState === undefined || ws.readyState === 1) this.handleOpen(ws);
  }

  private handleOpen(ws: WsLike): void {
    if (this.ws !== ws || this.manuallyClosed || this.currentState === 'connected') return;
    this.reconnectAttempt = 0;
    this.setState('connected');
    for (const channel of this.handlers.keys()) this.send({ type: 'subscribe', channel });
    this.flushPending();
  }

  private handleClose(ws: WsLike): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.pending.length = 0;
    if (this.manuallyClosed) {
      this.setState('closed');
      return;
    }
    this.setState('idle');
    this.scheduleReconnect();
  }

  private scheduleReconnect(_cause?: unknown): void {
    if (this.manuallyClosed || this.options.reconnect === false || this.reconnectTimer !== undefined) return;
    const base = Math.max(0, this.options.reconnectDelayMs ?? 250);
    const max = Math.max(base, this.options.maxReconnectDelayMs ?? 10_000);
    const delay = Math.min(max, base * (2 ** this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.manuallyClosed) this.openSocket(true);
    }, delay);
  }

  private setState(state: RealtimeConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const handler of this.stateHandlers) handler(state);
  }

  private send(envelope: RealtimeMessage): void {
    if (!this.ws) return;
    this.ws.send(JSON.stringify(envelope));
  }

  private flushPending(): void {
    for (const frame of this.pending.splice(0)) this.ws?.send(frame);
  }

  private onMessage(raw: unknown): void {
    let msg: RealtimeMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as RealtimeMessage;
    } catch {
      return; // ignore non-JSON frames
    }
    for (const h of this.any) h(msg);
    if (msg.channel) {
      const set = this.handlers.get(msg.channel);
      if (set) for (const h of set) h(msg);
    }
  }

  private write(envelope: RealtimeMessage): void {
    if (!this.ws) throw new StreetClientError('RealtimeClient is not connected — call connect() first.');
    const frame = JSON.stringify(envelope);
    if (this.currentState === 'connected') this.ws.send(frame);
    else this.pending.push(frame);
  }

  /** Subscribe to a channel; returns an unsubscribe function. */
  subscribe<T = unknown>(channel: string, handler: MessageHandler<T>): () => void {
    let set = this.handlers.get(channel);
    const first = !set;
    if (!set) { set = new Set(); this.handlers.set(channel, set); }
    set.add(handler as MessageHandler);
    // Keep subscriptions before connect so a reconnect can restore them. The
    // first subscription is the only one that needs a wire-level subscribe.
    if (first && this.ws && this.currentState === 'connected') this.send({ type: 'subscribe', channel });
    return () => {
      set!.delete(handler as MessageHandler);
      if (set!.size === 0) {
        this.handlers.delete(channel);
        if (this.ws && this.currentState === 'connected') this.send({ type: 'unsubscribe', channel });
      }
    };
  }

  /** Publish data to a channel. */
  publish<T = unknown>(channel: string, data: T): void {
    this.write({ type: 'publish', channel, data });
  }

  /** Receive every message (any channel). */
  onAny(handler: MessageHandler): () => void {
    this.any.add(handler);
    return () => this.any.delete(handler);
  }

  /** Observe connection changes; returns an unsubscribe function. */
  onStateChange(handler: RealtimeStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
    this.pending.length = 0;
    this.handlers.clear();
    this.any.clear();
    this.setState('closed');
    this.stateHandlers.clear();
  }
}

export function createRealtime(
  config: StreetClientConfig,
  path = '/realtime',
  options?: RealtimeClientOptions,
): RealtimeClient {
  const impl = (config.WebSocket ?? (globalThis as { WebSocket?: unknown }).WebSocket) as WsCtor | undefined;
  if (!impl) throw new StreetClientError('No WebSocket implementation: pass `WebSocket` in config or run on a platform with global WebSocket.');
  return new RealtimeClient(toWsUrl(config.baseUrl, path), impl, options);
}
