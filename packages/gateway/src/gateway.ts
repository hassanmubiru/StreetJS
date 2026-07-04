/**
 * @streetjs/gateway — the request pipeline that wires every leaf module together.
 *
 * {@link createGateway} assembles the routing table, load balancers, health
 * registry, circuit breaker, rate limiters, and observability into a single
 * {@link Gateway} whose {@link Gateway.handle} runs one request end-to-end:
 *
 *   requestId/logging → body limit → CORS → versioning → routing → policy merge
 *   → rate limit → auth/authz → upstream selection (health + balancer) → circuit
 *   breaker → forward (retry + timeout) → response transform (security headers,
 *   CORS, compression) → structured log + telemetry.
 *
 * The terminal forward handler is composed under {@link Gateway.use}-registered
 * middleware via {@link runPipeline}: middleware run in registration order
 * (index 0 outermost), may short-circuit the chain, and may transform the
 * response before it is finalized. All time is read through an injected
 * {@link Clock} and all randomness through an injected `rng`, so a gateway driven
 * by a fake clock and a deterministic forwarder is fully reproducible.
 *
 * Only NEW behaviour lives here; every stage delegates to the existing,
 * separately-tested leaf module. Per-route request validation is intentionally
 * NOT wired into this pipeline — it is supported by registering the
 * `validation` module's checks as a {@link Middleware} via {@link Gateway.use},
 * keeping the core pipeline free of an extra config surface.
 */

import { systemClock, type Clock } from "streetjs";

import type {
  CompressionEncoding,
  Forwarder,
  GatewayConfig,
  GatewayRequest,
  GatewayResponse,
  Headers,
  LoadBalancer,
  LoadBalancerStrategyName,
  Middleware,
  RateLimitPolicy,
  RouteConfig,
  RoutePolicy,
  ServiceConfig,
} from "./types.js";
import type { RequestContext } from "./types.js";

import { createRouter, type Router } from "./router.js";
import { createBalancer } from "./balancer.js";
import { HealthRegistry } from "./health.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { RateLimiter } from "./ratelimit.js";
import { authenticate, authorize } from "./auth.js";
import { resolveCors } from "./cors.js";
import { resolveVersion } from "./versioning.js";
import { negotiateEncoding, compress, shouldCompress } from "./compression.js";
import { applySecurityHeaders, enforceBodyLimit } from "./security.js";
import { RequestLogger, newRequestId } from "./logging.js";
import {
  registerGatewayObservability,
  type GatewayStats,
  type GatewayObservabilityHandle,
} from "./observability.js";
import { runPipeline } from "./middleware.js";
import { withTimeout, runWithRetry } from "./retry.js";
import { httpForwarder } from "./proxy.js";
import {
  GatewayError,
  RouteNotFoundError,
  NoHealthyUpstreamError,
  CircuitOpenError,
  RateLimitExceededError,
  ForbiddenError,
  RequestValidationError,
} from "./errors.js";

/** Default upstream timeout (ms) when a route/default policy sets none. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** A permissive circuit breaker that never opens unless a policy overrides it. */
const PERMISSIVE_BREAKER = { failureThreshold: Number.MAX_SAFE_INTEGER, openMs: 0 } as const;

/** UTF-8 encoder reused for JSON error bodies. */
const ENCODER = new TextEncoder();

/**
 * The public gateway surface. Beyond the documented pipeline members it exposes
 * the constructed {@link HealthRegistry} so operators (and tests) can mark a
 * target healthy/unhealthy without reaching into gateway internals.
 */
export interface Gateway {
  /** Run one request through the full pipeline and resolve the client response. */
  handle(req: GatewayRequest): Promise<GatewayResponse>;
  /** Register a global {@link Middleware}; registration order is preserved. */
  use(mw: Middleware): void;
  /** A live, best-effort metrics snapshot. */
  stats(): GatewayStats;
  /** Release observability resources. Safe to call more than once. */
  close(): Promise<void>;
  /** The health registry backing upstream filtering (exposed for probing/ops). */
  readonly health: HealthRegistry;
}

/** Read a single header value, collapsing an array form to its first entry. */
function headerValue(headers: Headers, name: string): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Assemble a {@link Gateway} from a {@link GatewayConfig}.
 *
 * Construction is eager for the shared, stateful collaborators (router, health
 * registry, one circuit breaker, observability) and lazy for the per-key ones
 * (a balancer per service+strategy, a rate limiter per route) so their internal
 * scheduling/bucket state is created once and reused across requests.
 */
export function createGateway(config: GatewayConfig): Gateway {
  const clock: Clock = config.clock ?? systemClock;
  const rng: () => number = config.rng ?? Math.random;
  const forwarder: Forwarder = config.forwarder ?? httpForwarder;

  const router: Router = createRouter(config.routes);
  const health = new HealthRegistry({ clock });
  const breaker = new CircuitBreaker({
    policy: config.defaults?.circuitBreaker ?? PERMISSIVE_BREAKER,
    clock,
  });
  const logger = new RequestLogger({ sink: config.logSink, clock });
  const observability: GatewayObservabilityHandle = registerGatewayObservability();

  const services = new Map<string, ServiceConfig>();
  for (const svc of config.services) services.set(svc.name, svc);

  const balancers = new Map<string, LoadBalancer>();
  const limiters = new Map<string, RateLimiter>();
  const liveConnections = new Map<string, number>();
  const middlewares: Middleware[] = [];

  let requestsTotal = 0;
  let errorsTotal = 0;
  let activeConnections = 0;

  /** Resolve (or lazily create) the balancer for a route's effective strategy. */
  function balancerFor(service: ServiceConfig, route: RouteConfig): LoadBalancer {
    const strategy: LoadBalancerStrategyName =
      route.strategy ?? service.strategy ?? "round-robin";
    const key = `${service.name}::${strategy}`;
    let balancer = balancers.get(key);
    if (balancer === undefined) {
      balancer = createBalancer(strategy, { rng });
      balancers.set(key, balancer);
    }
    return balancer;
  }

  /** Resolve (or lazily create) the rate limiter guarding a route. */
  function limiterFor(routeKey: string, policy: RateLimitPolicy): RateLimiter {
    let limiter = limiters.get(routeKey);
    if (limiter === undefined) {
      limiter = new RateLimiter({ policy, clock });
      limiters.set(routeKey, limiter);
    }
    return limiter;
  }

  /** Count of currently in-flight connections against a target id. */
  function bump(targetId: string, delta: number): void {
    const next = Math.max(0, (liveConnections.get(targetId) ?? 0) + delta);
    liveConnections.set(targetId, next);
  }

  const stats = (): GatewayStats => {
    let total = 0;
    let healthy = 0;
    for (const svc of config.services) {
      total += svc.targets.length;
      healthy += health.filterHealthy(svc.targets).length;
    }
    return {
      activeConnections,
      requestsTotal,
      errorsTotal,
      healthyUpstreams: healthy,
      unhealthyUpstreams: total - healthy,
    };
  };

  observability.attach({ stats });

  /** Merge the security headers + CORS headers onto a response header bag. */
  function decorate(base: Headers, cors: Record<string, string>): Headers {
    const merged: Record<string, string | string[] | undefined> = { ...base, ...cors };
    return applySecurityHeaders(merged, config.security);
  }

  /** Build the JSON error response for a caught pipeline error. */
  function errorResponse(err: unknown, cors: Record<string, string>): GatewayResponse {
    const gateway = err instanceof GatewayError;
    const status = gateway ? err.status : 502;
    const name = gateway ? err.name : "BadGateway";
    const message = gateway ? err.message : "Bad Gateway";
    const payload: Record<string, unknown> = { error: name, message };
    if (err instanceof RequestValidationError) payload.issues = err.issues;
    const body = ENCODER.encode(JSON.stringify(payload));
    const headers = decorate({ "content-type": "application/json" }, cors);
    return { status, headers, body };
  }

  /** Apply security headers, CORS, and (optionally) compression to a success. */
  async function finalizeSuccess(
    response: GatewayResponse,
    cors: Record<string, string>,
    req: GatewayRequest,
  ): Promise<GatewayResponse> {
    let headers = decorate(response.headers, cors);
    let body = response.body;

    const compression = config.compression;
    if (compression?.enabled && body !== undefined && shouldCompress(body.byteLength, compression.threshold)) {
      const encoding: CompressionEncoding = negotiateEncoding(headerValue(req.headers, "accept-encoding"));
      if (encoding !== "identity") {
        body = await compress(body, encoding);
        headers = { ...headers, "content-encoding": encoding };
      }
    }

    return { status: response.status, headers, body };
  }

  async function handle(req: GatewayRequest): Promise<GatewayResponse> {
    const startedAt = logger.start();
    const requestId = newRequestId(rng);
    const ctx: RequestContext = { request: req, requestId, identity: null, state: {} };

    activeConnections++;

    let cors: Record<string, string> = {};
    let service: string | undefined;
    let targetId: string | undefined;
    let version: string | undefined;
    let response: GatewayResponse;

    try {
      // 2 ── request body size limit.
      enforceBodyLimit(req.body, config.security);

      // 3 ── CORS: reject disallowed origins, answer genuine preflights early.
      if (config.cors) {
        const resolution = resolveCors(config.cors, req);
        cors = resolution.headers;
        if (!resolution.allowed) throw new ForbiddenError("CORS origin not allowed.");
        if (resolution.isPreflight) {
          response = { status: 204, headers: decorate({}, cors), body: undefined };
          return response;
        }
      }

      // 4 ── versioning: resolve the version and the path to route on.
      let routingPath = req.path;
      if (config.versioning) {
        const resolved = resolveVersion(config.versioning, req);
        ctx.version = resolved.version;
        version = resolved.version;
        routingPath = resolved.strippedPath;
      }

      // 5 ── routing.
      const match = router.match(routingPath, req.method);
      if (match === null) throw new RouteNotFoundError(routingPath);
      ctx.match = match;
      const route = match.route;
      service = route.service;

      // 6 ── effective policy = defaults overlaid with per-route overrides.
      const policy: RoutePolicy = { ...(config.defaults ?? {}), ...(route.policy ?? {}) };
      const routeKey = route.id ?? route.pattern;

      // The terminal handler performs rate limiting, auth, upstream selection,
      // circuit breaking, and the forward. It sits at the core of the middleware
      // onion so use()-registered middleware wrap it (outermost first).
      const terminal = async (): Promise<GatewayResponse> => {
        // 7 ── rate limiting (identity not yet resolved; user/api-key scopes
        // fall back to their anonymous bucket, matching the pipeline order).
        if (policy.rateLimit) {
          const result = limiterFor(routeKey, policy.rateLimit).check(req, ctx.identity);
          if (!result.allowed) throw new RateLimitExceededError(result.retryAfterMs);
        }

        // 8 ── authentication then authorization.
        if (policy.auth) {
          ctx.identity = await authenticate(policy.auth, req);
        }
        if (policy.authorization) {
          await authorize(policy.authorization, ctx.identity, req);
        }

        // 9 ── upstream selection: health filter then load balance.
        const svc = services.get(route.service);
        if (svc === undefined) {
          throw new NoHealthyUpstreamError(route.service, `Service "${route.service}" is not configured.`);
        }
        const healthy = health.filterHealthy(svc.targets);
        const target = balancerFor(svc, route).pick(healthy, liveConnections);
        if (target === undefined) throw new NoHealthyUpstreamError(route.service);
        targetId = target.id;

        // 10 ── circuit breaker keyed by service + target.
        const breakerKey = `${route.service}::${target.id}`;
        if (!breaker.canRequest(breakerKey)) throw new CircuitOpenError(breakerKey);

        // 11 ── forward with retry + per-attempt timeout, on the stripped path.
        const forwardReq: GatewayRequest = { ...req, path: routingPath, url: routingPath };
        const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const retryPolicy = policy.retry ?? { maxAttempts: 1 };

        bump(target.id, +1);
        try {
          const upstream = await runWithRetry(
            () => withTimeout((signal) => forwarder(target, forwardReq, signal), timeoutMs),
            retryPolicy,
            { method: req.method },
          );
          breaker.onSuccess(breakerKey);
          return upstream;
        } catch (err) {
          breaker.onFailure(breakerKey);
          throw err;
        } finally {
          bump(target.id, -1);
        }
      };

      // Run the middleware onion around the terminal handler.
      const piped = await runPipeline(ctx, middlewares.slice(), terminal);

      // 12 ── response transform: security headers, CORS, compression.
      response = await finalizeSuccess(piped, cors, req);
      return response;
    } catch (err) {
      response = errorResponse(err, cors);
      return response;
    } finally {
      // 13 ── structured log + telemetry (always, on every exit path).
      activeConnections = Math.max(0, activeConnections - 1);
      requestsTotal++;
      const status = response!.status;
      const isError = status >= 500;
      if (isError) errorsTotal++;

      const record = {
        requestId,
        method: req.method,
        path: req.path,
        status,
        ...(service !== undefined ? { service } : {}),
        ...(targetId !== undefined ? { targetId } : {}),
        ...(version !== undefined ? { version } : {}),
      };
      logger.finish(record, startedAt);
      observability.telemetry.onRequest?.(clock() - startedAt, isError);
      observability.refresh();
    }
  }

  return {
    handle,
    use: (mw: Middleware): void => {
      middlewares.push(mw);
    },
    stats,
    close: async (): Promise<void> => {
      observability.close();
    },
    health,
  };
}
