import test from "node:test";
import assert from "node:assert/strict";

import { createGateway, type Gateway } from "../gateway.js";
import { decompress } from "../compression.js";
import type {
  Forwarder,
  GatewayConfig,
  GatewayRequest,
  GatewayResponse,
  Middleware,
  UpstreamTarget,
} from "../types.js";

// ── Test doubles ────────────────────────────────────────────────────────────

/** A mutable fake clock: `advance` moves time, `clock` reads it. */
function makeClock(start = 0): { clock: () => number; advance: (ms: number) => void } {
  let now = start;
  return { clock: () => now, advance: (ms: number) => void (now += ms) };
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Deterministic forwarder: echoes the target it hit (id + url) and the path. */
function echoForwarder(bodyText?: string): Forwarder {
  return (target: UpstreamTarget, req): Promise<GatewayResponse> =>
    Promise.resolve({
      status: 200,
      headers: { "content-type": "text/plain", "x-target": target.id },
      body: encoder.encode(bodyText ?? `${target.id}:${target.url}:${req.path}`),
    });
}

/** A forwarder that always rejects, to exercise failure/circuit paths. */
const failingForwarder: Forwarder = () => Promise.reject(new Error("upstream boom"));

function makeReq(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    method: "GET",
    url: "/api/thing",
    path: "/api/thing",
    headers: {},
    ...overrides,
  };
}

/** Parse a JSON error body. */
function parseBody(res: GatewayResponse): { error: string; message: string; issues?: unknown } {
  return JSON.parse(decoder.decode(res.body)) as { error: string; message: string; issues?: unknown };
}

/** A base config with one service/route and an injected clock + forwarder. */
function baseConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  const { clock } = makeClock();
  return {
    routes: [{ pattern: "/api", kind: "prefix", service: "api" }],
    services: [{ name: "api", targets: [{ id: "t1", url: "http://a.local" }] }],
    clock,
    forwarder: echoForwarder(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("routes to the matching service/target and returns the upstream response", async () => {
  const gw: Gateway = createGateway(baseConfig());
  const res = await gw.handle(makeReq());

  assert.equal(res.status, 200);
  assert.equal(res.headers["x-target"], "t1");
  assert.equal(decoder.decode(res.body), "t1:http://a.local:/api/thing");
  // Security headers are applied to successful responses.
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("unknown path resolves to 404 RouteNotFoundError", async () => {
  const gw = createGateway(baseConfig());
  const res = await gw.handle(makeReq({ path: "/nope", url: "/nope" }));

  assert.equal(res.status, 404);
  assert.equal(parseBody(res).error, "RouteNotFoundError");
});

test("exceeding the rate limit yields 429", async () => {
  const gw = createGateway(
    baseConfig({
      routes: [
        {
          pattern: "/api",
          kind: "prefix",
          service: "api",
          policy: { rateLimit: { scope: "global", limit: 1, windowMs: 1000 } },
        },
      ],
    }),
  );

  const first = await gw.handle(makeReq());
  assert.equal(first.status, 200);

  const second = await gw.handle(makeReq());
  assert.equal(second.status, 429);
  assert.equal(parseBody(second).error, "RateLimitExceededError");
});

test("an authenticated authorization with no identity yields 401", async () => {
  const gw = createGateway(
    baseConfig({
      routes: [
        {
          pattern: "/api",
          kind: "prefix",
          service: "api",
          policy: {
            auth: { kind: "custom", verify: () => null },
            authorization: { kind: "authenticated" },
          },
        },
      ],
    }),
  );

  const res = await gw.handle(makeReq());
  assert.equal(res.status, 401);
  assert.equal(parseBody(res).error, "UnauthenticatedError");
});

test("a missing required role yields 403", async () => {
  const gw = createGateway(
    baseConfig({
      routes: [
        {
          pattern: "/api",
          kind: "prefix",
          service: "api",
          policy: {
            auth: { kind: "custom", verify: () => ({ subject: "u1", roles: ["user"] }) },
            authorization: { kind: "role", roles: ["admin"] },
          },
        },
      ],
    }),
  );

  const res = await gw.handle(makeReq());
  assert.equal(res.status, 403);
  assert.equal(parseBody(res).error, "ForbiddenError");
});

test("a CORS preflight is answered with 204 and Access-Control-Allow-Origin", async () => {
  const gw = createGateway(baseConfig({ cors: { origins: "*" } }));

  const res = await gw.handle(
    makeReq({
      method: "OPTIONS",
      headers: {
        origin: "https://client.example",
        "access-control-request-method": "GET",
      },
    }),
  );

  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "*");
});

test("a pool whose only target is unhealthy yields 503", async () => {
  const gw = createGateway(baseConfig());
  gw.health.setState("t1", "unhealthy");

  const res = await gw.handle(makeReq());
  assert.equal(res.status, 503);
  assert.equal(parseBody(res).error, "NoHealthyUpstreamError");
});

test("an open circuit sheds subsequent requests with 503", async () => {
  const gw = createGateway(
    baseConfig({
      forwarder: failingForwarder,
      defaults: { circuitBreaker: { failureThreshold: 1, openMs: 100_000 } },
    }),
  );

  // First request fails at the upstream (non-gateway error → 502) and trips the breaker.
  const first = await gw.handle(makeReq());
  assert.equal(first.status, 502);

  // The breaker is now open: the next request is shed with a CircuitOpenError.
  const second = await gw.handle(makeReq());
  assert.equal(second.status, 503);
  assert.equal(parseBody(second).error, "CircuitOpenError");
});

test("middleware can short-circuit the pipeline", async () => {
  const gw = createGateway(baseConfig());
  let terminalReached = false;
  const shortCircuit: Middleware = async () => ({ status: 299, headers: { "x-short": "1" } });
  gw.use(shortCircuit);
  gw.use(async (_ctx, next) => {
    terminalReached = true;
    return next();
  });

  const res = await gw.handle(makeReq());
  assert.equal(res.status, 299);
  assert.equal(res.headers["x-short"], "1");
  assert.equal(terminalReached, false, "downstream middleware/terminal must not run");
});

test("middleware can transform the response", async () => {
  const gw = createGateway(baseConfig());
  gw.use(async (_ctx, next) => {
    const res = await next();
    return { ...res, headers: { ...res.headers, "x-transformed": "yes" } };
  });

  const res = await gw.handle(makeReq());
  assert.equal(res.status, 200);
  assert.equal(res.headers["x-transformed"], "yes");
});

test("compression is applied when enabled and the body exceeds the threshold", async () => {
  const payload = "x".repeat(2048);
  const gw = createGateway(
    baseConfig({
      forwarder: echoForwarder(payload),
      compression: { enabled: true, threshold: 16 },
    }),
  );

  const res = await gw.handle(makeReq({ headers: { "accept-encoding": "gzip" } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-encoding"], "gzip");

  const restored = await decompress(res.body!, "gzip");
  assert.equal(decoder.decode(restored), payload);
});

test("small bodies are not compressed even when compression is enabled", async () => {
  const gw = createGateway(
    baseConfig({
      forwarder: echoForwarder("tiny"),
      compression: { enabled: true, threshold: 1024 },
    }),
  );

  const res = await gw.handle(makeReq({ headers: { "accept-encoding": "gzip" } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-encoding"], undefined);
  assert.equal(decoder.decode(res.body), "tiny");
});

test("stats track requests, errors, and healthy upstream counts", async () => {
  const gw = createGateway(baseConfig());
  await gw.handle(makeReq());
  await gw.handle(makeReq({ path: "/nope", url: "/nope" })); // 404, client error (not 5xx)

  const s = gw.stats();
  assert.equal(s.requestsTotal, 2);
  assert.equal(s.errorsTotal, 0, "4xx is not counted as a server error");
  assert.equal(s.healthyUpstreams, 1);
  assert.equal(s.unhealthyUpstreams, 0);
  assert.equal(s.activeConnections, 0);
});
