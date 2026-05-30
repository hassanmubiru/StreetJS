export interface WebhookPayload {
    event: string;
    data: unknown;
    ts: number;
    id: string;
}
export interface WebhookTarget {
    url: string;
    secret: string;
    timeoutMs?: number;
    maxRetries?: number;
}
export interface WebhookJob {
    target: WebhookTarget;
    payload: WebhookPayload;
    attempt: number;
}
export declare class WebhookDispatcher {
    private readonly queue;
    private running;
    private processing;
    private stopped;
    private readonly _warnedUrls;
    private readonly _warnClearTimer;
    constructor();
    enqueue(target: WebhookTarget, event: string, data: unknown): boolean;
    private _drain;
    private _dispatch;
    stop(): void;
}
//# sourceMappingURL=dispatcher.d.ts.map