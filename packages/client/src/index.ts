// @streetjs/client — universal, framework-agnostic, zero-dependency SDK for
// StreetJS backends. Tree-shakeable; browser + Node. Consumes public HTTP/WS
// APIs only — never core internals (RFC 0002).

export { createStreetClient } from './client.js';
export type { StreetClient, StreetClientBase, ResourceClient, AuthClient } from './client.js';

export { request, buildUrl, parseResponse } from './http.js';
export type { StreetClientConfig, RequestOptions, Query, FetchLike } from './http.js';

export { RealtimeClient, createRealtime, toWsUrl } from './realtime.js';
export type {
  RealtimeMessage,
  MessageHandler,
  RealtimeConnectionState,
  RealtimeStateHandler,
  RealtimeClientOptions,
} from './realtime.js';

export { streamChat, parseSseChunk } from './ai.js';
export type { ChatMessage } from './ai.js';

export { StreetApiError, StreetClientError } from './errors.js';
