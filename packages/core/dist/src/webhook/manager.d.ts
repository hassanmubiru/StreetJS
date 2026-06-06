import { WebhookDispatcher } from './dispatcher.js';
export declare const WEBHOOK_ENDPOINTS_MIGRATION_SQL: string;
export declare const WEBHOOK_DELIVERIES_MIGRATION_SQL: string;
export interface WebhookManagerPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, string | null>[];
        rowCount: number;
        command: string;
    }>;
}
export interface WebhookEndpoint {
    id: string;
    url: string;
    events: string[];
    secret: string;
    createdAt: string;
}
export interface WebhookDelivery {
    id: string;
    endpointId: string;
    event: string;
    status: string;
    responseCode: number | null;
    responseBody: string | null;
    attempt: number;
    createdAt: string;
}
/** Compute the HMAC-SHA256 signature for a webhook body (matches dispatcher). */
export declare function signWebhookPayload(body: string, secret: string): string;
/**
 * Verify an inbound webhook signature in constant time.
 * `signature` is the value of the `X-Street-Signature` header.
 */
export declare function verifyIncomingWebhook(secret: string, signature: string, rawBody: string): boolean;
export interface WebhookManagerOptions {
    pool: WebhookManagerPool;
    dispatcher?: WebhookDispatcher;
}
export declare class WebhookManager {
    private readonly _pool;
    private readonly _dispatcher;
    constructor(opts: WebhookManagerOptions);
    /** Register a webhook endpoint. Generates a secret if none is provided. */
    registerEndpoint(url: string, events: string[], secret?: string): Promise<WebhookEndpoint>;
    /** List all endpoints subscribed to a given event type. */
    endpointsForEvent(event: string): Promise<WebhookEndpoint[]>;
    /**
     * Publish an event: find matching endpoints and enqueue a signed delivery for
     * each via the underlying dispatcher. A pending delivery row is recorded.
     */
    publish(event: string, payload: unknown): Promise<{
        delivered: number;
    }>;
    /** Record a delivery attempt outcome (truncates body to 1 KB). */
    recordResult(endpointId: string, event: string, responseCode: number, responseBody: string, attempt: number): Promise<void>;
    /** Read the recent delivery log for an endpoint. */
    deliveryLog(endpointId: string, limit?: number): Promise<WebhookDelivery[]>;
    /** Remove an endpoint registration. */
    revokeEndpoint(id: string): Promise<void>;
    /**
     * Compute the exponential-backoff delay (ms) for a given attempt, capped so
     * the cumulative retry window does not exceed ~72 hours.
     * delay = min(initialDelayMs * 2^attempt, maxDelayMs).
     */
    static backoffMs(attempt: number, initialDelayMs?: number, maxDelayMs?: number): number;
    /** Maximum delivery window: deliveries stop being retried after 72 hours. */
    static readonly MAX_RETRY_WINDOW_MS: number;
    /**
     * Deliver a single attempt result. When `attempt` reaches `maxAttempts` (or
     * the cumulative backoff would exceed the 72h window) and the response is not
     * 2xx, the delivery is recorded with status `dead_letter` (at-least-once:
     * retried until exhaustion, then parked rather than dropped).
     */
    recordAttempt(endpointId: string, event: string, responseCode: number, responseBody: string, attempt: number, maxAttempts?: number): Promise<{
        status: string;
        nextDelayMs: number | null;
    }>;
    private _recordDelivery;
}
//# sourceMappingURL=manager.d.ts.map