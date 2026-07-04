/**
 * @streetjs/gateway/testing — in-process, no-internet testing doubles.
 *
 * Three collaborators that let a test drive the gateway end-to-end over
 * loopback without any external service, mock server framework, or network
 * egress:
 *
 *  - {@link FakeBackend}   — a REAL `node:http` server bound to `127.0.0.1:0`
 *                            that records what it received and can be pointed at
 *                            by a real gateway (through {@link httpForwarder}).
 *  - {@link GatewayHarness}— a real {@link createGateway} wired to
 *                            {@link httpForwarder}, plus registration and
 *                            assertion helpers for named {@link FakeBackend}s.
 *  - {@link FakeGateway}   — a recording double implementing {@link Gateway}
 *                            WITHOUT any real forwarding: it records calls and
 *                            returns canned/queued responses.
 *
 * Everything lives on `127.0.0.1` with ephemeral ports; nothing here reaches the
 * internet, and every server exposes an idempotent `close()` so a test process
 * can exit cleanly.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";

import { createGateway, type Gateway } from "../gateway.js";
import { httpForwarder } from "../proxy.js";
import { HealthRegistry } from "../health.js";
import type {
  GatewayConfig,
  GatewayRequest,
  GatewayResponse,
  Headers,
  Middleware,
  RouteConfig,
  ServiceConfig,
  UpstreamTarget,
} from "../types.js";
import type { GatewayStats } from "../observability.js";

const encoder = new TextEncoder();

/** A single recorded inbound request as observed by a {@link FakeBackend}. */
export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  /** The raw request body, or `undefined` when the request had no body. */
  readonly body?: Uint8Array | undefined;
}

/** A canned response a {@link FakeBackend} should return for every request. */
interface CannedResponse {
  readonly status: number;
  readonly body: Uint8Array;
  readonly headers: Record<string, string>;
}

/** Coerce an arbitrary body argument into raw bytes. */
function toBytes(body: string | Uint8Array | undefined): Uint8Array {
  if (body === undefined) return new Uint8Array(0);
  return typeof body === "string" ? encoder.encode(body) : body;
}

/**
 * A REAL in-process `node:http` server a gateway can forward to over loopback.
 *
 * By default every request is echoed back as `{ method, url }` JSON with a
 * `200` status and recorded in {@link FakeBackend.requests}. A custom `handler`
 * fully replaces the default behaviour, and {@link FakeBackend.respondWith}
 * installs a canned response without writing a handler.
 */
export class FakeBackend {
  /** Every request the server has received, in arrival order. */
  readonly requests: RecordedRequest[] = [];

  readonly #server: Server;
  readonly #id: string;
  #canned: CannedResponse | undefined;
  #address: AddressInfo | undefined;

  private static counter = 0;

  constructor(handler?: (req: IncomingMessage, res: ServerResponse) => void) {
    this.#id = `fake-backend-${++FakeBackend.counter}`;
    this.#server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = chunks.length > 0 ? new Uint8Array(Buffer.concat(chunks)) : undefined;
        this.requests.push({
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers: { ...req.headers } as Headers,
          body,
        });
        if (handler !== undefined) {
          handler(req, res);
          return;
        }
        this.#defaultRespond(req, res);
      });
    });
  }

  /** The bound base URL, e.g. `http://127.0.0.1:54321`. Throws until listening. */
  get url(): string {
    if (this.#address === undefined) {
      throw new Error("FakeBackend is not listening yet; call listen() first.");
    }
    return `http://127.0.0.1:${this.#address.port}`;
  }

  /**
   * Start listening on `127.0.0.1:0` (an ephemeral port) and resolve the
   * concrete {@link UpstreamTarget} pointing at the actual bound port.
   */
  listen(): Promise<UpstreamTarget> {
    return new Promise<UpstreamTarget>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", () => {
        this.#server.removeListener("error", reject);
        this.#address = this.#server.address() as AddressInfo;
        resolve(this.target());
      });
    });
  }

  /** The {@link UpstreamTarget} for this backend. Throws until listening. */
  target(): UpstreamTarget {
    return { id: this.#id, url: this.url };
  }

  /**
   * Install a canned response returned for every subsequent request. The body
   * may be a string or raw bytes; headers default to `application/json` unless
   * overridden.
   */
  respondWith(
    status: number,
    body?: string | Uint8Array,
    headers?: Record<string, string>,
  ): void {
    this.#canned = {
      status,
      body: toBytes(body),
      headers: headers ?? { "content-type": "application/json" },
    };
  }

  /** Stop the server and release its socket. Safe to call more than once. */
  close(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.#address === undefined) {
        resolve();
        return;
      }
      this.#server.close(() => {
        this.#address = undefined;
        resolve();
      });
    });
  }

  #defaultRespond(req: IncomingMessage, res: ServerResponse): void {
    if (this.#canned !== undefined) {
      const canned = this.#canned;
      res.writeHead(canned.status, canned.headers);
      res.end(Buffer.from(canned.body));
      return;
    }
    const payload = JSON.stringify({ method: req.method ?? "GET", url: req.url ?? "/" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(payload);
  }
}

/** A named backend registration accepts either a live backend or a raw target. */
export type BackendLike = FakeBackend | UpstreamTarget;

/**
 * Bundles a real {@link createGateway} (wired to {@link httpForwarder} so
 * requests flow over loopback to {@link FakeBackend}s) with registration and
 * assertion helpers.
 *
 * Register named backends with {@link GatewayHarness.addBackend}; each becomes a
 * service with a matching prefix route (`/<name>`). Any explicit `routes`,
 * `services`, or other {@link GatewayConfig} fields supplied to the constructor
 * override the derived defaults, so a test can hand-build a full configuration
 * when it needs finer control.
 */
export class GatewayHarness {
  readonly #overrides: Partial<GatewayConfig>;
  readonly #targets = new Map<string, UpstreamTarget>();
  readonly #ownedBackends: FakeBackend[] = [];
  #gateway: Gateway | undefined;

  constructor(configOverrides: Partial<GatewayConfig> = {}) {
    this.#overrides = configOverrides;
  }

  /**
   * Register a backend under `name`. Passing a {@link FakeBackend} also enrolls
   * it for teardown by {@link GatewayHarness.close}. Rebuilds the gateway on the
   * next access so late registrations are picked up.
   */
  addBackend(name: string, backend: BackendLike): void {
    if (backend instanceof FakeBackend) {
      this.#ownedBackends.push(backend);
      this.#targets.set(name, backend.target());
    } else {
      this.#targets.set(name, backend);
    }
    this.#gateway = undefined;
  }

  /** The real gateway, lazily built from the registered backends + overrides. */
  get gateway(): Gateway {
    if (this.#gateway === undefined) {
      this.#gateway = createGateway(this.#buildConfig());
    }
    return this.#gateway;
  }

  /**
   * Send a request through {@link GatewayHarness.gateway}. Only `path` is
   * required; `method` defaults to `GET`, `url` defaults to `path`, and
   * `headers` default to an empty bag.
   */
  request(req: Partial<GatewayRequest> & { path: string }): Promise<GatewayResponse> {
    const full: GatewayRequest = {
      method: req.method ?? "GET",
      path: req.path,
      url: req.url ?? req.path,
      headers: req.headers ?? {},
      ...(req.ip !== undefined ? { ip: req.ip } : {}),
      ...(req.body !== undefined ? { body: req.body } : {}),
    };
    return this.gateway.handle(full);
  }

  /** Assert the response status for `req` equals `expected`. */
  async assertStatus(
    req: Partial<GatewayRequest> & { path: string },
    expected: number,
  ): Promise<void> {
    const res = await this.request(req);
    assert.equal(
      res.status,
      expected,
      `expected status ${expected} for ${req.method ?? "GET"} ${req.path}, got ${res.status}`,
    );
  }

  /** Tear down the gateway and every owned {@link FakeBackend}. Idempotent. */
  async close(): Promise<void> {
    if (this.#gateway !== undefined) await this.#gateway.close();
    await Promise.all(this.#ownedBackends.map((backend) => backend.close()));
  }

  #buildConfig(): GatewayConfig {
    const services: ServiceConfig[] = [];
    const routes: RouteConfig[] = [];
    for (const [name, target] of this.#targets) {
      services.push({ name, targets: [target] });
      routes.push({ pattern: `/${name}`, kind: "prefix", service: name });
    }
    return {
      routes,
      services,
      forwarder: httpForwarder,
      ...this.#overrides,
    };
  }
}

/**
 * A recording double implementing the {@link Gateway} interface WITHOUT any real
 * forwarding.
 *
 * `handle` records the request in {@link FakeGateway.handled} and returns the
 * next queued response (see {@link FakeGateway.enqueue}) or a default response.
 * `use` records middleware in {@link FakeGateway.middlewares}. `stats` returns a
 * counting snapshot, and `close` is a no-op.
 */
export class FakeGateway implements Gateway {
  /** Every request passed to {@link FakeGateway.handle}, in call order. */
  readonly handled: GatewayRequest[] = [];
  /** Every middleware registered via {@link FakeGateway.use}, in call order. */
  readonly middlewares: Middleware[] = [];
  /** The health registry the {@link Gateway} interface requires. */
  readonly health = new HealthRegistry();

  /** Returned by {@link FakeGateway.handle} when the response queue is empty. */
  defaultResponse: GatewayResponse = { status: 200, headers: {}, body: undefined };

  readonly #queue: GatewayResponse[] = [];

  /** Queue a response to be returned by a future {@link FakeGateway.handle}. */
  enqueue(response: GatewayResponse): this {
    this.#queue.push(response);
    return this;
  }

  /** Record the request and resolve the next queued (or default) response. */
  handle(req: GatewayRequest): Promise<GatewayResponse> {
    this.handled.push(req);
    const next = this.#queue.shift();
    return Promise.resolve(next ?? this.defaultResponse);
  }

  /** Record a middleware registration. */
  use(mw: Middleware): void {
    this.middlewares.push(mw);
  }

  /** A counting snapshot: `requestsTotal` tracks recorded calls. */
  stats(): GatewayStats {
    return {
      activeConnections: 0,
      requestsTotal: this.handled.length,
      errorsTotal: 0,
      healthyUpstreams: 0,
      unhealthyUpstreams: 0,
    };
  }

  /** No-op: the double owns no resources. */
  close(): Promise<void> {
    return Promise.resolve();
  }
}
