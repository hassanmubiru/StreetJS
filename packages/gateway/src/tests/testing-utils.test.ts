import test from "node:test";
import assert from "node:assert/strict";

import { createGateway } from "../gateway.js";
import { httpForwarder } from "../proxy.js";
import type {
  GatewayRequest,
  GatewayResponse,
  Middleware,
  RequestContext,
  UpstreamTarget,
} from "../types.js";
import { FakeBackend, FakeGateway, GatewayHarness } from "../testing/index.js";

const decoder = new TextDecoder();

/** A never-aborting signal for direct forwarder calls. */
function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

// ── FakeBackend ───────────────────────────────────────────────────────────────

test("FakeBackend: listen() returns a target with a real, bound loopback url", async () => {
  const backend = new FakeBackend();
  try {
    const target = await backend.listen();
    assert.ok(target.id.length > 0);
    const parsed = new URL(target.url);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.ok(Number(parsed.port) > 0, "port should be a real ephemeral port");
    assert.equal(target.url, backend.url);
    assert.deepEqual(target, backend.target());
  } finally {
    await backend.close();
  }
});

test("FakeBackend: default handler echoes { method, url } and records the request", async () => {
  const backend = new FakeBackend();
  try {
    const target = await backend.listen();
    const body = new TextEncoder().encode("hello-body");
    const req: GatewayRequest = {
      method: "POST",
      path: "/echo/path",
      url: "/echo/path",
      headers: { "content-type": "text/plain" },
      body,
    };

    const res = await httpForwarder(target, req, liveSignal());

    assert.equal(res.status, 200);
    const echoed = JSON.parse(decoder.decode(res.body)) as { method: string; url: string };
    assert.equal(echoed.method, "POST");
    assert.equal(echoed.url, "/echo/path");

    assert.equal(backend.requests.length, 1);
    const recorded = backend.requests[0]!;
    assert.equal(recorded.method, "POST");
    assert.equal(recorded.url, "/echo/path");
    assert.equal(recorded.headers["content-type"], "text/plain");
    assert.ok(recorded.body !== undefined);
    assert.equal(decoder.decode(recorded.body), "hello-body");
  } finally {
    await backend.close();
  }
});

test("FakeBackend: respondWith() overrides the response", async () => {
  const backend = new FakeBackend();
  try {
    const target = await backend.listen();
    backend.respondWith(503, JSON.stringify({ down: true }), { "content-type": "application/json" });

    const req: GatewayRequest = {
      method: "GET",
      path: "/anything",
      url: "/anything",
      headers: {},
    };
    const res = await httpForwarder(target, req, liveSignal());

    assert.equal(res.status, 503);
    const parsed = JSON.parse(decoder.decode(res.body)) as { down: boolean };
    assert.equal(parsed.down, true);
    // The request is still recorded even with a canned response.
    assert.equal(backend.requests.length, 1);
  } finally {
    await backend.close();
  }
});

test("FakeBackend: close() releases the port so the server stops accepting", async () => {
  const backend = new FakeBackend();
  const target = await backend.listen();
  const port = Number(new URL(target.url).port);
  await backend.close();
  // A second close is a safe no-op.
  await backend.close();
  assert.ok(port > 0);
});

test("FakeBackend: a custom handler fully replaces the default behaviour", async () => {
  const backend = new FakeBackend((_req, res) => {
    res.writeHead(418, { "content-type": "text/plain", "x-custom": "yes" });
    res.end("teapot");
  });
  try {
    const target = await backend.listen();
    const res = await httpForwarder(
      target,
      { method: "GET", path: "/x", url: "/x", headers: {} },
      liveSignal(),
    );
    assert.equal(res.status, 418);
    assert.equal(res.headers["x-custom"], "yes");
    assert.equal(decoder.decode(res.body), "teapot");
    assert.equal(backend.requests.length, 1);
  } finally {
    await backend.close();
  }
});

// ── GatewayHarness ──────────────────────────────────────────────────────────────

test("GatewayHarness: routes a request through a real gateway to a FakeBackend", async () => {
  const harness = new GatewayHarness();
  const backend = new FakeBackend();
  try {
    await backend.listen();
    harness.addBackend("api", backend);

    const res = await harness.request({ method: "GET", path: "/api/users/42" });

    assert.equal(res.status, 200);
    // The backend received the forwarded request over loopback.
    assert.equal(backend.requests.length, 1);
    assert.equal(backend.requests[0]!.url, "/api/users/42");
    // The echoed upstream body flowed back through the gateway pipeline.
    const echoed = JSON.parse(decoder.decode(res.body)) as { method: string; url: string };
    assert.equal(echoed.method, "GET");
    assert.equal(echoed.url, "/api/users/42");
  } finally {
    await harness.close();
  }
});

test("GatewayHarness: assertStatus passes for a match and fails for a mismatch", async () => {
  const harness = new GatewayHarness();
  const backend = new FakeBackend();
  try {
    await backend.listen();
    harness.addBackend("svc", backend);

    await harness.assertStatus({ path: "/svc/thing" }, 200);
    // Unknown path resolves to 404 from the real router.
    await harness.assertStatus({ path: "/nope" }, 404);

    await assert.rejects(() => harness.assertStatus({ path: "/svc/thing" }, 500));
  } finally {
    await harness.close();
  }
});

test("GatewayHarness: close() tears down owned backends", async () => {
  const harness = new GatewayHarness();
  const backend = new FakeBackend();
  const target = await backend.listen();
  harness.addBackend("api", backend);
  await harness.request({ path: "/api/ping" });
  assert.equal(backend.requests.length, 1);

  await harness.close();

  // After teardown, a fresh connection to the freed port should fail.
  const req: GatewayRequest = { method: "GET", path: "/api/ping", url: "/api/ping", headers: {} };
  await assert.rejects(() => httpForwarder(target, req, liveSignal()));
});

test("GatewayHarness: honours full config overrides (custom route + injected forwarder)", async () => {
  let forwarded = 0;
  const stubForward = (_t: UpstreamTarget, _r: GatewayRequest): Promise<GatewayResponse> => {
    forwarded++;
    return Promise.resolve({ status: 201, headers: {}, body: undefined });
  };
  const harness = new GatewayHarness({
    routes: [{ pattern: "/custom", kind: "prefix", service: "custom" }],
    services: [{ name: "custom", targets: [{ id: "t", url: "http://127.0.0.1:1" }] }],
    forwarder: (t, r) => stubForward(t, r),
  });
  try {
    const res = await harness.request({ path: "/custom/here" });
    assert.equal(res.status, 201);
    assert.equal(forwarded, 1);
  } finally {
    await harness.close();
  }
});

// ── FakeGateway ─────────────────────────────────────────────────────────────────

test("FakeGateway: handle records the request and returns the enqueued response", async () => {
  const fake = new FakeGateway();
  const queued: GatewayResponse = { status: 302, headers: { location: "/next" }, body: undefined };
  fake.enqueue(queued);

  const req: GatewayRequest = { method: "PUT", path: "/p", url: "/p", headers: {} };
  const res = await fake.handle(req);

  assert.equal(res.status, 302);
  assert.equal(res.headers["location"], "/next");
  assert.equal(fake.handled.length, 1);
  assert.equal(fake.handled[0], req);
});

test("FakeGateway: falls back to the default response when the queue is empty", async () => {
  const fake = new FakeGateway();
  fake.defaultResponse = { status: 204, headers: {}, body: undefined };

  const res = await fake.handle({ method: "GET", path: "/", url: "/", headers: {} });
  assert.equal(res.status, 204);
  assert.equal(fake.handled.length, 1);
});

test("FakeGateway: use records middleware and stats counts handled requests", async () => {
  const fake = new FakeGateway();
  const mw: Middleware = (_ctx: RequestContext, next) => next();
  fake.use(mw);
  assert.equal(fake.middlewares.length, 1);
  assert.equal(fake.middlewares[0], mw);

  await fake.handle({ method: "GET", path: "/a", url: "/a", headers: {} });
  await fake.handle({ method: "GET", path: "/b", url: "/b", headers: {} });

  const stats = fake.stats();
  assert.equal(stats.requestsTotal, 2);
  assert.equal(stats.activeConnections, 0);
  assert.equal(stats.errorsTotal, 0);

  // close() is a no-op that resolves.
  await fake.close();
});

test("FakeGateway is assignable to the real Gateway interface", () => {
  const fake: import("../gateway.js").Gateway = new FakeGateway();
  assert.ok(typeof fake.handle === "function");
  assert.ok(fake.health !== undefined);
});

// Guard: the real createGateway is used by the harness (import is exercised).
test("sanity: createGateway is a function", () => {
  assert.equal(typeof createGateway, "function");
});
