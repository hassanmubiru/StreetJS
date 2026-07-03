/**
 * @streetjs/gateway — shared, strongly typed models.
 *
 * Foundational, dependency-light type surface for the gateway. Only the core
 * `Clock` primitive is imported from `streetjs`; every other module imports the
 * shapes defined here, keeping the dependency direction acyclic (leaf modules →
 * types, never the reverse).
 */

import type { Clock } from "streetjs";

// ── HTTP primitives ─────────────────────────────────────────────────────────────

/** A normalized, case-insensitive header bag (lower-cased keys). */
export type Headers = Readonly<Record<string, string | string[] | undefined>>;

/** The subset of an incoming request the gateway routes and forwards on. */
export interface GatewayRequest {
  readonly method: string;
  /** Full request path including query string, e.g. `/users/42?full=1`. */
  readonly url: string;
  /** Path portion only, e.g. `/users/42`. */
  readonly path: string;
  readonly headers: Headers;
  /** Best-effort remote address for per-IP policies. */
  readonly ip?: string;
  /** Opaque body handle; the proxy streams the real body, tests may pass bytes. */
  readonly body?: Uint8Array | undefined;
}

/** The subset of an upstream response the gateway returns to the client. */
export interface GatewayResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body?: Uint8Array | undefined;
}

// ── Routing ─────────────────────────────────────────────────────────────────────

/** How a route's `pattern` is matched against a request path. */
export type RouteMatchKind = "static" | "prefix" | "wildcard" | "regex";

/** A single route mapping a path pattern to an upstream service. */
export interface RouteConfig {
  /** Stable identifier for logs/metrics; defaults to the pattern when omitted. */
  readonly id?: string;
  /** The match pattern; interpretation depends on {@link kind}. */
  readonly pattern: string;
  /** Match strategy; default `prefix` for patterns ending in `/*`, else `static`. */
  readonly kind?: RouteMatchKind;
  /** Higher priority wins when multiple routes match; default 0. */
  readonly priority?: number;
  /** Optional HTTP methods this route accepts (any when omitted). */
  readonly methods?: readonly string[];
  /** The name of the upstream service this route forwards to. */
  readonly service: string;
  /** Per-route load-balancing strategy; default `round-robin`. */
  readonly strategy?: LoadBalancerStrategyName;
  /** Optional per-route policy overrides. */
  readonly policy?: RoutePolicy;
}

/** The outcome of matching a request path against the route table. */
export interface RouteMatch {
  readonly route: RouteConfig;
  /** Captured wildcard/regex segments, positional. */
  readonly params: readonly string[];
}

// ── Upstreams / load balancing ────────────────────────────────────────────────────

/** A single backend instance a route can forward to. */
export interface UpstreamTarget {
  /** Unique id within the service pool. */
  readonly id: string;
  /** Base URL, e.g. `http://127.0.0.1:8081`. */
  readonly url: string;
  /** Relative weight for weighted strategies; default 1, must be >= 1. */
  readonly weight?: number;
}

/** The named load-balancing strategies. */
export type LoadBalancerStrategyName =
  | "round-robin"
  | "least-connections"
  | "random"
  | "weighted-round-robin";

/** A load balancer picks the next target from a set of healthy candidates. */
export interface LoadBalancer {
  readonly name: LoadBalancerStrategyName;
  /**
   * Choose one target from `candidates` (already health-filtered). Returns
   * `undefined` only when `candidates` is empty. `liveConnections` maps target
   * id → in-flight count for least-connections.
   */
  pick(
    candidates: readonly UpstreamTarget[],
    liveConnections?: ReadonlyMap<string, number>,
  ): UpstreamTarget | undefined;
}

// ── Health ─────────────────────────────────────────────────────────────────────────

/** The health of a single upstream target. */
export type HealthState = "healthy" | "unhealthy" | "unknown";

/** A point-in-time health record for a target. */
export interface HealthRecord {
  readonly targetId: string;
  readonly state: HealthState;
  readonly checkedAt: number;
  readonly detail?: string;
}

/** Performs one health probe of a target, resolving to healthy/unhealthy. */
export type HealthChecker = (
  target: UpstreamTarget,
  signal: AbortSignal,
) => Promise<boolean> | boolean;

// ── Resilience policies ─────────────────────────────────────────────────────────

/** Retry configuration for a forwarded request. */
export interface RetryPolicy {
  /** Total attempts, initial + retries; default 1 (no retry). */
  readonly maxAttempts: number;
  /** Base delay in ms between attempts. */
  readonly baseDelayMs?: number;
  /** Exponential multiplier; default 2. */
  readonly multiplier?: number;
  /** Cap on the computed delay in ms. */
  readonly maxDelayMs?: number;
  /** Only these idempotent methods are retried by default. */
  readonly retryMethods?: readonly string[];
}

/** Circuit breaker configuration. */
export interface CircuitBreakerPolicy {
  /** Consecutive failures before the circuit opens. */
  readonly failureThreshold: number;
  /** How long the circuit stays open before probing (half-open), in ms. */
  readonly openMs: number;
  /** Successes in half-open needed to close again; default 1. */
  readonly halfOpenSuccesses?: number;
}

/** Rate-limit scope for a policy. */
export type RateLimitScope = "global" | "ip" | "user" | "api-key";

/** Token-bucket-style rate limit configuration. */
export interface RateLimitPolicy {
  readonly scope: RateLimitScope;
  /** Maximum requests allowed within the window. */
  readonly limit: number;
  /** Window length in ms. */
  readonly windowMs: number;
}

/** Per-route policy overrides composed on top of gateway defaults. */
export interface RoutePolicy {
  readonly timeoutMs?: number;
  readonly retry?: RetryPolicy;
  readonly circuitBreaker?: CircuitBreakerPolicy;
  readonly rateLimit?: RateLimitPolicy;
  readonly auth?: AuthPolicy;
  readonly authorization?: AuthorizationPolicy;
  readonly cors?: CorsPolicy;
}

// ── Auth / authorization ──────────────────────────────────────────────────────────

/** Supported authentication mechanisms. */
export type AuthKind = "none" | "jwt" | "api-key" | "session" | "custom";

/** Authentication configuration. */
export interface AuthPolicy {
  readonly kind: AuthKind;
  /** For `custom`: a verifier resolving to an identity or `null` (unauthenticated). */
  readonly verify?: (req: GatewayRequest) => Promise<Identity | null> | Identity | null;
}

/** An authenticated principal. */
export interface Identity {
  readonly subject: string;
  readonly roles?: readonly string[];
  readonly permissions?: readonly string[];
  readonly [claim: string]: unknown;
}

/** Authorization rule kinds. */
export type AuthorizationKind = "public" | "authenticated" | "role" | "permission" | "custom";

/** Authorization configuration. */
export interface AuthorizationPolicy {
  readonly kind: AuthorizationKind;
  /** Required role(s) for `role`. */
  readonly roles?: readonly string[];
  /** Required permission(s) for `permission`. */
  readonly permissions?: readonly string[];
  /** For `custom`: decide access given the (possibly null) identity. */
  readonly decide?: (identity: Identity | null, req: GatewayRequest) => boolean | Promise<boolean>;
}

// ── Validation ─────────────────────────────────────────────────────────────────────

/** A single field validation rule evaluated against a value. */
export type FieldRule = (value: unknown) => true | string;

/** Request validation schema across the four request locations. */
export interface ValidationSchema {
  readonly headers?: Readonly<Record<string, FieldRule>>;
  readonly query?: Readonly<Record<string, FieldRule>>;
  readonly params?: Readonly<Record<string, FieldRule>>;
  readonly body?: (body: unknown) => true | string;
}

/** A single validation problem in the consistent error shape. */
export interface ValidationIssue {
  readonly location: "headers" | "query" | "params" | "body";
  readonly field: string;
  readonly message: string;
}

// ── CORS / versioning / compression ────────────────────────────────────────────────

/** CORS policy. */
export interface CorsPolicy {
  /** Allowed origins; `"*"` allows any. */
  readonly origins: readonly string[] | "*";
  readonly methods?: readonly string[];
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly credentials?: boolean;
  readonly maxAgeSeconds?: number;
}

/** Where the API version is read from. */
export type VersionSource = "path" | "accept-version" | "x-version";

/** API versioning configuration. */
export interface VersioningPolicy {
  /** Ordered sources to consult; first hit wins. Default: path, x-version, accept-version. */
  readonly sources?: readonly VersionSource[];
  /** Known versions, e.g. `["v1", "v2"]`. */
  readonly versions: readonly string[];
  /** Version used when none is supplied. */
  readonly default: string;
}

/** Supported response compression encodings. */
export type CompressionEncoding = "gzip" | "br" | "identity";

// ── Middleware ─────────────────────────────────────────────────────────────────────

/** Mutable per-request state threaded through the middleware pipeline. */
export interface RequestContext {
  readonly request: GatewayRequest;
  /** Correlation id assigned at ingress. */
  readonly requestId: string;
  /** Set once authentication resolves (or null when unauthenticated). */
  identity: Identity | null;
  /** Resolved API version, when versioning is configured. */
  version?: string;
  /** Resolved route match, when routing has run. */
  match?: RouteMatch;
  /** Arbitrary per-request scratch space for middleware. */
  readonly state: Record<string, unknown>;
}

/** The terminal handler invoked at the end of the middleware chain. */
export type NextFn = () => Promise<GatewayResponse>;

/** A gateway middleware wraps the downstream chain. */
export type Middleware = (ctx: RequestContext, next: NextFn) => Promise<GatewayResponse>;

// ── Structured logging ─────────────────────────────────────────────────────────────

/** A structured access-log record emitted per request. */
export interface AccessLogRecord {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly latencyMs: number;
  readonly service?: string;
  readonly targetId?: string;
  readonly version?: string;
}

/** A sink the gateway writes structured access logs to. */
export type AccessLogSink = (record: AccessLogRecord) => void;

// ── Gateway configuration ───────────────────────────────────────────────────────────

/** A named upstream service pool. */
export interface ServiceConfig {
  readonly name: string;
  readonly targets: readonly UpstreamTarget[];
  readonly strategy?: LoadBalancerStrategyName;
  readonly healthCheck?: HealthChecker;
}

/** Top-level gateway configuration. */
export interface GatewayConfig {
  readonly routes: readonly RouteConfig[];
  readonly services: readonly ServiceConfig[];
  /** Default resilience/security policy applied to routes without overrides. */
  readonly defaults?: RoutePolicy;
  readonly cors?: CorsPolicy;
  readonly versioning?: VersioningPolicy;
  readonly compression?: { readonly enabled: boolean; readonly threshold?: number };
  readonly security?: SecurityPolicy;
  /** Injected clock for deterministic timers/backoff; default `systemClock`. */
  readonly clock?: Clock;
  /** Injectable RNG for random balancing/jitter; default `Math.random`. */
  readonly rng?: () => number;
  /** Structured access-log sink; default a no-op. */
  readonly logSink?: AccessLogSink;
  /** The forwarder that actually performs an upstream request (injectable for tests). */
  readonly forwarder?: Forwarder;
}

/** Security-header + limit policy. */
export interface SecurityPolicy {
  /** Maximum request body size in bytes; larger requests are rejected. */
  readonly maxBodyBytes?: number;
  /** Header-completion timeout in ms (slowloris protection). */
  readonly headerTimeoutMs?: number;
  /** Extra/override security headers to set on responses. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Performs a single upstream forward to a concrete target. */
export type Forwarder = (
  target: UpstreamTarget,
  req: GatewayRequest,
  signal: AbortSignal,
) => Promise<GatewayResponse>;
