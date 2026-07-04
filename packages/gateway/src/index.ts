/**
 * @streetjs/gateway
 *
 * StreetJS Core v2 — API Gateway & Edge Framework. Additive package layered over
 * the `streetjs` core. This base entry re-exports the full public surface. It
 * imports no cloud SDK and no sibling pillar package directly; pillar integration
 * is optional and structural (see the runnable example under `examples/edge`).
 *
 * The `./testing` subpath (see package.json `exports`) exposes the in-process
 * test doubles (`FakeGateway`, `GatewayHarness`, `FakeBackend`) so consumers can
 * exercise a gateway without sockets or external services.
 */

/** Package identity markers. */
export const GATEWAY_PACKAGE_NAME = "@streetjs/gateway" as const;
export const GATEWAY_FRAMEWORK_VERSION = "0.1.0" as const;

// ── Facade ──────────────────────────────────────────────────────────────────────
export { createGateway } from "./gateway.js";
export type { Gateway } from "./gateway.js";

// ── Shared contract types ─────────────────────────────────────────────────────
export type {
  Headers,
  GatewayRequest,
  GatewayResponse,
  RouteMatchKind,
  RouteConfig,
  RouteMatch,
  UpstreamTarget,
  LoadBalancerStrategyName,
  LoadBalancer,
  HealthState,
  HealthRecord,
  HealthChecker,
  RetryPolicy,
  CircuitBreakerPolicy,
  RateLimitScope,
  RateLimitPolicy,
  RoutePolicy,
  AuthKind,
  AuthPolicy,
  Identity,
  AuthorizationKind,
  AuthorizationPolicy,
  FieldRule,
  ValidationSchema,
  ValidationIssue,
  CorsPolicy,
  VersionSource,
  VersioningPolicy,
  CompressionEncoding,
  RequestContext,
  NextFn,
  Middleware,
  AccessLogRecord,
  AccessLogSink,
  ServiceConfig,
  GatewayConfig,
  SecurityPolicy,
  Forwarder,
} from "./types.js";

// ── Error hierarchy ───────────────────────────────────────────────────────────
export {
  GatewayError,
  RouteNotFoundError,
  NoHealthyUpstreamError,
  CircuitOpenError,
  UpstreamTimeoutError,
  RateLimitExceededError,
  UnauthenticatedError,
  ForbiddenError,
  RequestValidationError,
  PayloadTooLargeError,
  GatewayConfigError,
} from "./errors.js";

// ── Routing ───────────────────────────────────────────────────────────────────
export { Router, createRouter, resolveKind, specificity } from "./router.js";

// ── Load balancing ────────────────────────────────────────────────────────────
export {
  RoundRobinBalancer,
  LeastConnectionsBalancer,
  RandomBalancer,
  WeightedRoundRobinBalancer,
  createBalancer,
} from "./balancer.js";

// ── Health checks ─────────────────────────────────────────────────────────────
export {
  HealthRegistry,
  tcpChecker,
  httpChecker,
  customChecker,
} from "./health.js";
export type { Delay, HealthRegistryOptions, TcpCheckerOptions } from "./health.js";

// ── Resilience: circuit breaker + retry/timeout ───────────────────────────────
export { CircuitBreaker } from "./circuit-breaker.js";
export type { CircuitState, CircuitBreakerOptions } from "./circuit-breaker.js";
export {
  defaultDelay,
  computeRetryDelay,
  withTimeout,
  runWithRetry,
} from "./retry.js";
export type { DelayFn, RunWithRetryOptions } from "./retry.js";

// ── Rate limiting ─────────────────────────────────────────────────────────────
export { RateLimiter, keyFor } from "./ratelimit.js";
export type { RateLimitResult, RateLimiterOptions } from "./ratelimit.js";

// ── Auth (authn + authz) ──────────────────────────────────────────────────────
export { authenticate, authorize, isAuthorized } from "./auth.js";
export type { AuthDeps } from "./auth.js";

// ── Request logging ───────────────────────────────────────────────────────────
export { RequestLogger, newRequestId } from "./logging.js";
export type { RequestLoggerOptions } from "./logging.js";

// ── Security ──────────────────────────────────────────────────────────────────
export {
  DEFAULT_SECURITY_HEADERS,
  applySecurityHeaders,
  enforceBodyLimit,
  resolveHeaderTimeoutMs,
} from "./security.js";

// ── Observability ─────────────────────────────────────────────────────────────
export {
  registerGatewayObservability,
  GATEWAY_HEALTH_CHECK_NAME,
  GATEWAY_REQUESTS_TOTAL,
  GATEWAY_ERRORS_TOTAL,
  GATEWAY_LATENCY,
  GATEWAY_ACTIVE_CONNECTIONS,
  GATEWAY_BACKEND_HEALTHY,
} from "./observability.js";
export type {
  GatewayStats,
  GatewayIntrospect,
  GatewayTelemetry,
  GatewayObservabilityOptions,
  GatewayObservabilityHandle,
} from "./observability.js";

// ── CORS / versioning / validation / compression ──────────────────────────────
export { resolveCors } from "./cors.js";
export type { CorsResolution } from "./cors.js";
export { resolveVersion } from "./versioning.js";
export type { ResolvedVersion } from "./versioning.js";
export {
  validateRequest,
  assertValid,
  required,
  isString,
  matches,
  isInteger,
} from "./validation.js";
export type { ValidationInput } from "./validation.js";
export {
  negotiateEncoding,
  compress,
  decompress,
  shouldCompress,
} from "./compression.js";

// ── Middleware pipeline ───────────────────────────────────────────────────────
export { compose, runPipeline } from "./middleware.js";

// ── Reverse proxy: HTTP(S) forwarder + WebSocket upgrade bridge ───────────────
export { httpForwarder, proxyWebSocketUpgrade } from "./proxy.js";
export type { WebSocketUpgradeOptions } from "./proxy.js";

// ── Plugin integration ────────────────────────────────────────────────────────
export { GatewayPlugin } from "./plugin.js";
export type { GatewayPluginOptions } from "./plugin.js";

// ── CLI (generators + commands) ───────────────────────────────────────────────
export { GatewayCommands } from "./cli/commands.js";
export {
  generateGatewayRoute,
  generateProxy,
  isValidGeneratorName,
  assertValidName,
  DEFAULT_ROUTE_DIR,
  DEFAULT_PROXY_DIR,
} from "./cli/generators.js";
export type { GenerateResult } from "./cli/generators.js";
