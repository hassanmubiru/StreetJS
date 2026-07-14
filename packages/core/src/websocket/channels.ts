// src/websocket/channels.ts
//
// The realtime channel hub now lives in the standalone @streetjs/websocket
// package (single source of truth). This module re-exports it so all internal
// `../websocket/channels.js` imports keep working unchanged — dependency
// inversion, not duplication.

export { ChannelHub, ChannelEvents } from '@streetjs/websocket';
export type {
  RealtimeConnection,
  ChannelHubOptions,
  PublishOptions,
  PresencePayload,
  TypingPayload,
} from '@streetjs/websocket';
