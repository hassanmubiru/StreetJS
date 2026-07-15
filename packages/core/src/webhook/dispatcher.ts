// src/webhook/dispatcher.ts
//
// The SSRF-hardened outbound webhook dispatcher now lives in the standalone
// @streetjs/webhook-dispatcher package (single source of truth). This module
// re-exports it so the `streetjs/webhook` subpath and all internal
// `../webhook/dispatcher.js` imports keep working unchanged — dependency
// inversion, not duplication.

export { WebhookDispatcher, buildRequestOptions } from '@streetjs/webhook-dispatcher';
export type { WebhookPayload, WebhookTarget, WebhookJob } from '@streetjs/webhook-dispatcher';
