import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { HealthRegistry, httpChecker, tcpChecker } from "../health.js";
import type { UpstreamTarget } from "../types.js";

/**
 * LIVE probe coverage for the built-in health checkers, exercised against REAL
 * in-process servers bound to 127.0.0.1 on ephemeral ports. No internet access
 * is involved — this mirrors the loopback approach used by the integration
 * tests, and lets us assert genuine healthy/unhealthy outcomes (previously this
 * was a skipped placeholder).
 */

/** A signal that is never aborted, for direct checker invocations. */
const liveSignal = (): AbortSignal => new AbortController().signal;

function target(id: string, url: string): UpstreamTarget {
  return { id, url };
}

/** A closed 127.0.0.1 port: bind, read the port, then close before probing. */
async function unusedPort(): Promise<number> {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe("health (live loopback probes)", () => {
  let server: http.Server;
  let baseUrl: string;
  let deadUrl: string;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.statusCode = 200;
        res.end("ok");
        return;
      }
      if (req.url === "/bad") {
        res.statusCode = 500;
        res.end("nope");
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    deadUrl = `http://127.0.0.1:${await unusedPort()}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── httpChecker ────────────────────────────────────────────────────────────

  it("httpChecker resolves true for a 200 on the expected path", async () => {
    const ok = await httpChecker("/health", 200)(target("t", baseUrl), liveSignal());
    assert.equal(ok, true);
  });

  it("httpChecker resolves false when the status does not match", async () => {
    const ok = await httpChecker("/bad", 200)(target("t", baseUrl), liveSignal());
    assert.equal(ok, false);
  });

  it("httpChecker resolves false against a dead port (connection refused)", async () => {
    const ok = await httpChecker("/health", 200)(target("t", deadUrl), liveSignal());
    assert.equal(ok, false);
  });

  // ── tcpChecker ─────────────────────────────────────────────────────────────

  it("tcpChecker resolves true when the port accepts a connection", async () => {
    const ok = await tcpChecker()(target("t", baseUrl), liveSignal());
    assert.equal(ok, true);
  });

  it("tcpChecker resolves false against a dead port", async () => {
    const ok = await tcpChecker({ connectTimeoutMs: 500 })(target("t", deadUrl), liveSignal());
    assert.equal(ok, false);
  });

  // ── through HealthRegistry.probe ─────────────────────────────────────────────

  it("probe marks a live upstream healthy and a dead one unhealthy", async () => {
    const registry = new HealthRegistry();
    const live = target("live", baseUrl);
    const dead = target("dead", deadUrl);

    await registry.probe([live, dead], httpChecker("/health", 200), 2_000);

    assert.equal(registry.get("live")?.state, "healthy");
    assert.equal(registry.get("dead")?.state, "unhealthy");

    // Only the live target is eligible for traffic after the probe.
    const eligible = registry.filterHealthy([live, dead]).map((t) => t.id);
    assert.deepEqual(eligible, ["live"]);
  });
});
