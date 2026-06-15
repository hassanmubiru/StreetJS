// packages/client/src/realtime.ts
// Realtime client over the platform WebSocket (injectable for Node/tests).
// Uses a simple JSON envelope: { type, channel, data }.

import { StreetClientError } from './errors.js';
import { trimTrailingSlashes } from './http.js';
import type { StreetClientConfig } from './http.js';

export interface RealtimeMessage<T = unknown> { type: string; channel?: string; data?: T; }
export type MessageHandler<T = unknown> = (msg: RealtimeMessage<T>) => void;

interface WsLike {
  send(data: string): void;
  close(): void;
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

  constructor(private readonly url: string, private readonly WebSocketImpl: WsCtor) {}

  connect(): void {
    if (this.ws) return;
    const ws = new this.WebSocketImpl(this.url);
    ws.addEventListener('message', (ev) => this.onMessage(ev.data));
    this.ws = ws;
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
    this.ws.send(JSON.stringify(envelope));
  }

  /** Subscribe to a channel; returns an unsubscribe function. */
  subscribe<T = unknown>(channel: string, handler: MessageHandler<T>): () => void {
    let set = this.handlers.get(channel);
    if (!set) { set = new Set(); this.handlers.set(channel, set); }
    set.add(handler as MessageHandler);
    this.write({ type: 'subscribe', channel });
    return () => {
      set!.delete(handler as MessageHandler);
      if (set!.size === 0) { this.handlers.delete(channel); this.write({ type: 'unsubscribe', channel }); }
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

  close(): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.handlers.clear();
    this.any.clear();
  }
}

export function createRealtime(config: StreetClientConfig, path = '/realtime'): RealtimeClient {
  const impl = (config.WebSocket ?? (globalThis as { WebSocket?: unknown }).WebSocket) as WsCtor | undefined;
  if (!impl) throw new StreetClientError('No WebSocket implementation: pass `WebSocket` in config or run on a platform with global WebSocket.');
  return new RealtimeClient(toWsUrl(config.baseUrl, path), impl);
}
