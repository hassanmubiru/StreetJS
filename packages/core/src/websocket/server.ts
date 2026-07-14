// src/websocket/server.ts
//
// The WebSocket server now lives in the standalone @streetjs/websocket package
// (single source of truth). This module re-exports it so the `streetjs/websocket`
// subpath and all internal `../websocket/server.js` imports keep working
// unchanged — dependency inversion, not duplication.

export {
  StreetSocket,
  StreetWebSocketServer,
  normalizeOrigin,
  deriveSelfOrigin,
  isOriginAllowed,
} from '@streetjs/websocket';
export type { WsHandler, RawWsHandler, WsEvent, WsServerOptions } from '@streetjs/websocket';
