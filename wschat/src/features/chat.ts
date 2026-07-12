// Realtime chat wiring — channels, presence, typing over WebSockets.
import { StreetWebSocketServer, ChannelHub } from 'streetjs';

export const hub = new ChannelHub({ typingTtlMs: 5000 });
export const wss = new StreetWebSocketServer();
