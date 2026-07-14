// src/websocket/sse.ts
//
// The SSE connection now lives in the standalone @streetjs/websocket package
// (single source of truth). This module re-exports it so the `streetjs/sse`
// subpath and all internal `../websocket/sse.js` imports keep working unchanged
// — dependency inversion, not duplication.

export { SseConnection, createSse } from '@streetjs/websocket';
export type { SseEvent } from '@streetjs/websocket';
