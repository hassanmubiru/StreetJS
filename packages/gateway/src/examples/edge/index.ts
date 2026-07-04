/**
 * @streetjs/gateway — runnable edge example.
 *
 *   Browser  →  Gateway  →  { users-service, orders-service, auth-service }
 *                               │            │              │
 *                               ▼            ▼              ▼
 *                            Storage      Queue          (issues token)
 *                            + Events   + Events
 *                            + Realtime
 *
 * Everything runs IN-PROCESS over loopback with NO internet access:
 *  - the three backend services are real `node:http` servers (via FakeBackend),
 *  - the downstream pillars (Realtime/Storage/Queue/Events) are small in-process
 *    stand-ins (see `pillars.ts`) so the example has no hard dependency on the
 *    optional pillar packages.
 *
 * The gateway itself is the REAL {@link createGateway} wired to the REAL
 * {@link httpForwarder}, exercising routing, versioning, CORS, compression,
 * security headers, rate limiting, structured logging, and observability.
 *
 * Run with:  npm run example   (from packages/gateway)
 */

import { FakeBackend } from "../../testing/index.js";
import { createGateway } from "../../gateway.js";
import type {
  AccessLogRecord,
  GatewayConfig,
  GatewayRequest,
  GatewayResponse,
} from "../../types.js";

import { EventBus, KeyValueStore, RealtimeHub, WorkQueue } from "./pillars.js";

const decoder = new TextDecoder();
const line = (s = ""): void => console.log(s);

/** Decode a response body (handling the optional gzip/br content-encoding). */
async function readBody(res: GatewayResponse): Promise<string> {
  if (res.body === undefined) return "";
  const encoding = res.headers["content-encoding"];
  if (encoding === "gzip" || encoding === "br") {
    const { gunzipSync, brotliDecompressSync } = await import("node:zlib");
    const buf = Buffer.from(res.body);
    const out = encoding === "gzip" ? gunzipSync(buf) : brotliDecompressSync(buf);
    return out.toString("utf8");
  }
  return decoder.decode(res.body);
}

async function main(): Promise<void> {
  // ── Downstream pillar stand-ins (in-process) ────────────────────────────────
  const realtime = new RealtimeHub();
  const storage = new KeyValueStore();
  const queue = new WorkQueue();
  const events = new EventBus();

  // Wire a couple of subscribers so the fan-out is observable.
  realtime.subscribe("users", (m) => line(`   [realtime] users channel ← ${JSON.stringify(m)}`));
  events.on("user.created", (p) => line(`   [events] user.created → ${JSON.stringify(p)}`));
  events.on("order.placed", (p) => line(`   [events] order.placed → ${JSON.stringify(p)}`));

  // ── Three real in-process backend services ──────────────────────────────────
  const users = new FakeBackend((req, res) => {
    if (req.method === "POST") {
      const id = `u_${storage.size + 1}`;
      storage.put(id, { id, path: req.url });
      events.publish("user.created", { id });
      realtime.broadcast("users", { event: "created", id });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, created: true }));
      return;
    }
    // GET: return a padded list so response compression actually engages.
    const list = Array.from({ length: 8 }, (_, i) => ({ id: `u_${i + 1}`, name: `user-${i + 1}` }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ users: list, note: "x".repeat(64) }));
  });

  const orders = new FakeBackend((req, res) => {
    if (req.method === "POST") {
      const orderId = `o_${Date.now()}`;
      queue.enqueue("process-order", { orderId, path: req.url });
      events.publish("order.placed", { orderId });
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ orderId, queued: true }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ orders: [] }));
  });

  const auth = new FakeBackend((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ token: "demo.jwt.token", tokenType: "Bearer" }));
  });

  const usersTarget = await users.listen();
  const ordersTarget = await orders.listen();
  const authTarget = await auth.listen();

  // ── The real gateway ────────────────────────────────────────────────────────
  const logs: AccessLogRecord[] = [];
  const config: GatewayConfig = {
    services: [
      { name: "users-service", targets: [usersTarget], strategy: "round-robin" },
      { name: "orders-service", targets: [ordersTarget] },
      { name: "auth-service", targets: [authTarget] },
    ],
    routes: [
      { pattern: "/users", kind: "prefix", service: "users-service" },
      { pattern: "/orders", kind: "prefix", service: "orders-service" },
      { pattern: "/auth", kind: "prefix", service: "auth-service" },
    ],
    versioning: { versions: ["v1", "v2"], default: "v1", sources: ["path", "x-version"] },
    cors: {
      origins: ["https://app.example.com"],
      methods: ["GET", "POST", "OPTIONS"],
      credentials: true,
      maxAgeSeconds: 600,
    },
    compression: { enabled: true, threshold: 32 },
    security: { maxBodyBytes: 1024 * 1024, headers: { "x-gateway": "streetjs" } },
    defaults: {
      timeoutMs: 5_000,
      retry: { maxAttempts: 2, baseDelayMs: 1 },
      rateLimit: { scope: "global", limit: 100, windowMs: 60_000 },
    },
    logSink: (r) => logs.push(r),
  };

  const gateway = createGateway(config);

  // A tiny middleware that stamps a trace id, demonstrating use()-ordering.
  gateway.use(async (ctx, next) => {
    ctx.state.trace = `trace-${ctx.requestId.slice(0, 8)}`;
    return next();
  });

  // ── Simulate a browser session ──────────────────────────────────────────────
  const browser = (over: Partial<GatewayRequest> & { path: string }): GatewayRequest => ({
    method: over.method ?? "GET",
    path: over.path,
    url: over.url ?? over.path,
    headers: { origin: "https://app.example.com", "accept-encoding": "gzip", ...over.headers },
    ...(over.body !== undefined ? { body: over.body } : {}),
  });

  line("── Browser → Gateway → backends ─────────────────────────────");

  const login = await gateway.handle(
    browser({ method: "POST", path: "/v1/auth/login", body: new TextEncoder().encode("{}") }),
  );
  line(`1) POST /v1/auth/login → ${login.status}  ${await readBody(login)}`);

  const created = await gateway.handle(browser({ method: "POST", path: "/v1/users" }));
  line(`2) POST /v1/users      → ${created.status}  ${await readBody(created)}`);

  const listed = await gateway.handle(browser({ path: "/v1/users" }));
  line(
    `3) GET  /v1/users      → ${listed.status}  content-encoding=${listed.headers["content-encoding"] ?? "identity"}` +
      `  (${(await readBody(listed)).length} bytes decoded)`,
  );

  const order = await gateway.handle(browser({ method: "POST", path: "/v1/orders" }));
  line(`4) POST /v1/orders     → ${order.status}  ${await readBody(order)}`);

  const preflight = await gateway.handle(
    browser({ method: "OPTIONS", path: "/v1/users", headers: { "access-control-request-method": "POST" } }),
  );
  line(`5) OPTIONS /v1/users   → ${preflight.status} (CORS preflight)`);

  const notFound = await gateway.handle(browser({ path: "/v1/nope" }));
  line(`6) GET  /v1/nope       → ${notFound.status} (no route)`);

  // ── Drain the queue (downstream worker) ──────────────────────────────────────
  line();
  line("── Draining work queue ──────────────────────────────────────");
  await queue.drain((job) => line(`   [queue] processed ${job.name} ${JSON.stringify(job.payload)}`));

  // ── Report pillar + gateway state ────────────────────────────────────────────
  line();
  line("── Downstream pillar state ──────────────────────────────────");
  line(`   storage keys : ${storage.size}`);
  line(`   queue jobs   : ${queue.processed.length} processed, ${queue.depth} pending`);
  line(`   events       : ${events.published.length} published`);
  line(`   realtime     : ${realtime.broadcasts.length} broadcast`);

  const stats = gateway.stats();
  line();
  line("── Gateway stats ────────────────────────────────────────────");
  line(`   requestsTotal    : ${stats.requestsTotal}`);
  line(`   errorsTotal      : ${stats.errorsTotal}`);
  line(`   healthyUpstreams : ${stats.healthyUpstreams}`);
  line(`   access logs      : ${logs.length}`);

  // ── Teardown ──────────────────────────────────────────────────────────────────
  await gateway.close();
  await Promise.all([users.close(), orders.close(), auth.close()]);
  line();
  line("Done. (all in-process; no network egress)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
