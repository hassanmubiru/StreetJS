/**
 * Public types for @streetjs/webhooks.
 *
 * Interface-first: the delivery transport, the clock, and the sleep function are
 * injectable so delivery is fully testable without network access.
 */

/** Options controlling signature generation. */
export interface SignOptions {
  /** Unix timestamp (seconds) to sign with. Default: now. */
  readonly timestamp?: number;
}

/** The result of signing a payload. */
export interface SignatureResult {
  /** The timestamp (seconds) bound into the signature. */
  readonly timestamp: number;
  /** The hex HMAC-SHA256 signature over `${timestamp}.${payload}`. */
  readonly signature: string;
  /** The full header value: `t=<timestamp>,v1=<signature>`. */
  readonly header: string;
}

/** Options controlling signature verification. */
export interface VerifyOptions {
  /** Allowed clock skew / replay window in seconds. Default `300`. */
  readonly toleranceSec?: number;
  /** Current time (seconds) for the tolerance check. Default: now. */
  readonly now?: number;
}

/** The outcome of verifying a signature. */
export interface VerifyResult {
  readonly valid: boolean;
  /** Present when `valid` is false: why verification failed. */
  readonly reason?: string;
}

/** A destination for webhook delivery. */
export interface WebhookEndpoint {
  readonly url: string;
  /** Shared secret used to sign the payload. */
  readonly secret: string;
  /** Extra headers merged into the delivery request. */
  readonly headers?: Record<string, string>;
}

/** An event to deliver. */
export interface WebhookEvent {
  /** Unique event id. Generated (UUID) when omitted. */
  readonly id?: string;
  /** Event type, e.g. `user.created`. */
  readonly type: string;
  /** Arbitrary JSON-serializable payload. */
  readonly data: unknown;
  /** Creation time (seconds). Default: now. Also used as the signature timestamp. */
  readonly created?: number;
}

/** A single delivery request handed to the transport. */
export interface DeliveryRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** The transport's response. */
export interface DeliveryResponse {
  readonly status: number;
}

/** Sends a signed webhook. Injectable; a fetch-based transport is provided. */
export interface WebhookTransport {
  send(request: DeliveryRequest): Promise<DeliveryResponse>;
}

/** The result of a dispatch attempt (across retries). */
export interface DispatchResult {
  readonly delivered: boolean;
  /** The event id that was sent. */
  readonly id: string;
  /** Total attempts made. */
  readonly attempts: number;
  /** Final HTTP status, when a response was received. */
  readonly status?: number;
  /** Error message, when delivery failed without a usable response. */
  readonly error?: string;
}

/** Injectable delay (default a real timer). */
export type SleepFn = (ms: number) => Promise<void>;

/** Injectable clock returning epoch milliseconds. */
export type Clock = () => number;
