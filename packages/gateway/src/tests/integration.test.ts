import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { FakeBackend, GatewayHarness } from "../testing/index.js";
import { createGateway } from "../gateway.js";
import { httpForwarder } from "../proxy.js";
import type { GatewayConfig, GatewayRequest } from "../types.js";

/**
 * Integration tests exercising the REAL gateway + REAL httpForwarder against
 * REAL in-process `node:http` backends (FakeBackend). Nothing here touches the
 * internet — every server is bound to 127.0.0.1 on an ephemeral port.
 */

const decoder = new TextDecoder();
const text = (body?: Uint8Array): string => (body ? decoder.decode(body) : "");

function req(over: Partial<GatewayRequest> & { path: string }): GatewayRequest {
  return {
    method: over.method ?? "GET",
    path: over.path,
    url: over.url ?? over.path,
    headers: over.headers ?? {},
    ...(over.body !== undefined ? { body: over.body } : {}),
  };
}

describe("integration: multi-service routing over loopback", () => {
  let harness: GatewayHarness;

  beforeEach(() => {
    harness = new GatewayHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("routes each prefix to its own real backend and forwards the path", async () => {
    const users = new FakeBackend();
    const orders = new FakeBackend();
    await users.listen();
    await orders.listen();
    harness.addBackend("users", users);
    harness.addBackend("orders", orders);

    const uRes = await harness.request({ path: "/users/42" });
    const oRes = await harness.request({ path: "/orders/7" });

    assert.equal(uRes.status, 200);
    assert.equal(oRes.status, 200);
    // Default FakeBackend echoes { method, url } — proves the path reached it.
    assert.match(text(uRes.body), /"url":"\/users\/42"/);
    assert.match(text(oRes.body), /"url":"\/orders\/7"/);
    assert.equal(users.requests.length, 1);
    assert.equal(orders.requests.length, 1);
  });

  it("forwards a POST body unchanged to the backend", async () => {
    const api = new FakeBackend();
    await api.listen();
    harness.addBackend("api", api);

    const payload = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
    const res = await harness.request({
      method: "POST",
      path: "/api/things",
      headers: { "content-type": "application/json" },
      body: payload,
    });

    assert.equal(res.status, 200);
    assert.equal(api.requests.length, 1);
    assert.deepEqual(api.requests[0]!.body, payload);
  });

  it("returns a consistent 404 JSON error when no route matches", async () => {
    const api = new FakeBackend();
    await api.listen();
    harness.addBackend("api", api);

    const res = await harness.request({ path: "/missing" });
    assert.equal(res.status, 404);
    assert.match(text(res.body), /RouteNotFoundError/);
    assert.equal(api.requests.length, 0, "no backend should be hit for an unmatched route");
  });
});

describe("integration: load balancing across two real backends", () => {
  it("round-robins requests across a service's two targets", async () => {
    const a = new FakeBackend();
    const b = new FakeBackend();
    const ta = await a.listen();
    const tb = await b.listen();

    const config: GatewayConfig = {
      services: [{ name: "svc", targets: [ta, tb], strategy: "round-robin" }],
      routes: [{ pattern: "/svc", kind: "prefix", service: "svc" }],
      forwarder: httpForwarder,
    };
    const gateway = createGateway(config);

    try {
      // 4 requests → round-robin should split 2/2 across the two backends.
      for (let i = 0; i < 4; i++) await gateway.handle(req({ path: "/svc" }));
      assert.equal(a.requests.length + b.requests.length, 4);
      assert.equal(a.requests.length, 2);
      assert.equal(b.requests.length, 2);
    } finally {
      await gateway.close();
      await Promise.all([a.close(), b.close()]);
    }
  });

  it("routes only to healthy targets after one is marked unhealthy", async () => {
    const good = new FakeBackend();
    const bad = new FakeBackend();
    const tg = await good.listen();
    const tb = await bad.listen();

    const config: GatewayConfig = {
      services: [{ name: "svc", targets: [tg, tb], strategy: "round-robin" }],
      routes: [{ pattern: "/svc", kind: "prefix", service: "svc" }],
      forwarder: httpForwarder,
    };
    const gateway = createGateway(config);

    try {
      // Mark the "bad" target unhealthy; all traffic must land on "good".
      gateway.health.setState(tb.id, "unhealthy");
      for (let i = 0; i < 5; i++) await gateway.handle(req({ path: "/svc" }));
      assert.equal(good.requests.length, 5);
      assert.equal(bad.requests.length, 0);
    } finally {
      await gateway.close();
      await Promise.all([good.close(), bad.close()]);
    }
  });
});

describe("integration: retry against a flaky real backend", () => {
  it("retries a transient 500 and succeeds on the second attempt", async () => {
    let hits = 0;
    const flaky = new FakeBackend((_req, res) => {
      hits++;
      if (hits === 1) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("boom");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, attempt: hits }));
    });
    await flaky.listen();

    // httpForwarder resolves any HTTP status (incl. 500), so drive retries with a
    // forwarder wrapper that rejects on a 5xx, letting runWithRetry re-attempt.
    const target = flaky.target();
    const config: GatewayConfig = {
      services: [{ name: "svc", targets: [target] }],
      routes: [{ pattern: "/svc", kind: "prefix", service: "svc" }],
      defaults: { retry: { maxAttempts: 3, baseDelayMs: 1, retryMethods: ["GET"] } },
      forwarder: async (t, r, signal) => {
        const res = await httpForwarder(t, r, signal);
        if (res.status >= 500) throw new Error(`upstream ${res.status}`);
        return res;
      },
    };
    const gateway = createGateway(config);

    try {
      const res = await gateway.handle(req({ path: "/svc" }));
      assert.equal(res.status, 200);
      assert.match(text(res.body), /"attempt":2/);
      assert.equal(hits, 2, "backend should have been hit exactly twice");
    } finally {
      await gateway.close();
      await flaky.close();
    }
  });
});
