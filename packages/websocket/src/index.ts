/**
 * @streetjs/websocket — the StreetJS realtime foundation.
 *
 * A hardened WebSocket server (origin + auth gating, heartbeat, capacity
 * limits), an event-framed {@link StreetSocket}, an {@link SseConnection} for
 * Server-Sent Events, and a transport-agnostic {@link ChannelHub} with presence
 * and typing indicators. Built on `ws`. Public API only.
 *
 * ```ts
 * import { StreetWebSocketServer, ChannelHub } from '@streetjs/websocket';
 *
 * const ws = new StreetWebSocketServer({ path: '/ws', heartbeatIntervalMs: 30_000 });
 * ws.attach(httpServer, (socket) => {
 *   socket.on('chat', (msg) => ws.broadcast('chat', msg));
 *   socket.onClose(() => { ... });
 * });
 * ```
 *
 * > This is the standalone home of the realtime transport that also backs the
 * > `streetjs/websocket` and `streetjs/sse` subpaths; the `streetjs` framework
 * > re-exports it, so there is a single implementation.
 */

export {
  StreetSocket,
  StreetWebSocketServer,
  normalizeOrigin,
  deriveSelfOrigin,
  isOriginAllowed,
  type WsHandler,
  type RawWsHandler,
  type WsEvent,
  type WsServerOptions,
} from './server.js';

export { SseConnection, createSse, type SseEvent } from './sse.js';

export {
  ChannelHub,
  ChannelEvents,
  type RealtimeConnection,
  type ChannelHubOptions,
  type PublishOptions,
  type PresencePayload,
  type TypingPayload,
} from './channels.js';

/**
 * Dependency-injection token for a {@link StreetWebSocketServer}. This package
 * depends on no container, so the token is a plain unique symbol.
 */
export const WEBSOCKET_SERVER: unique symbol = Symbol.for('@streetjs/websocket:Server');
