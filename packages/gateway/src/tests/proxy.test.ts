import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { httpForwarder, proxyWebSocketUpgrade } from "../proxy.js";
import type { GatewayRequest, UpstreamTarget } from "../types.js";

/** Start an in-process http server on an ephemeral 127.0.0.1 port. */
async function startServer(
  handler: http.RequestListener,
): Promise<{ server: http.Server; url: string; port: number }> {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, port };
}

/** Gracefully close a server, resolving once all connections are torn down. */
function closeServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function target(url: string): UpstreamTarget {
  return { id: "u1", url };
}

function gatewayRequest(over: Partial<GatewayRequest>): GatewayRequest {
  return {
    method: "GET",
    url: "/",
    path: "/",
    headers: {},
    ...over,
  };
}

// ── httpForwarder against a REAL in-process upstream ──────────────────────────────

describe("httpForwarder (real node:http upstream)", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    // A single echo upstream that exercises every assertion below.
    const started = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (req.url === "/slow") {
          // Intentionally never respond: used to exercise AbortSignal.
          return;
        }
        if (req.url === "/echo-header") {
          res.statusCode = 200;
          res.setHeader("x-echoed", String(req.headers["x-test"] ?? ""));
          res.end("header-seen");
          return;
        }
        if (req.method === "POST") {
          // Echo the received body bytes back verbatim.
          res.statusCode = 200;
          res.end(Buffer.concat(chunks));
          return;
        }
        res.statusCode = 200;
        res.end("hello-get");
      });
    });
    server = started.server;
    url = started.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("GET returns the upstream status and body", async () => {
    const res = await httpForwarder(
      target(url),
      gatewayRequest({ method: "GET", url: "/", path: "/" }),
      new AbortController().signal,
    );
    assert.equal(res.status, 200);
    assert.ok(res.body, "expected a body");
    assert.equal(Buffer.from(res.body!).toString(), "hello-get");
  });

  it("POST echoes the request body back unchanged", async () => {
    const payload = Buffer.from(JSON.stringify({ hello: "world", n: 42 }));
    const res = await httpForwarder(
      target(url),
      gatewayRequest({
        method: "POST",
        url: "/submit",
        path: "/submit",
        headers: { "content-type": "application/json" },
        body: new Uint8Array(payload),
      }),
      new AbortController().signal,
    );
    assert.equal(res.status, 200);
    assert.ok(res.body, "expected an echoed body");
    assert.deepEqual(Buffer.from(res.body!), payload);
  });

  it("forwards a request header through to the upstream", async () => {
    const res = await httpForwarder(
      target(url),
      gatewayRequest({
        method: "GET",
        url: "/echo-header",
        path: "/echo-header",
        headers: { "x-test": "reached-upstream" },
      }),
      new AbortController().signal,
    );
    assert.equal(res.status, 200);
    // The upstream reflected the header it received back to us.
    assert.equal(res.headers["x-echoed"], "reached-upstream");
    assert.equal(Buffer.from(res.body!).toString(), "header-seen");
  });

  // Note: httpForwarder does not add an x-forwarded-for header (it forwards
  // headers verbatim), so there is no x-forwarded-for behavior to assert here.

  it("rejects the forward when the AbortSignal fires", async () => {
    const controller = new AbortController();
    const pending = httpForwarder(
      target(url),
      gatewayRequest({ method: "GET", url: "/slow", path: "/slow" }),
      controller.signal,
    );
    // Give the request a tick to attach to the (never-responding) upstream.
    setImmediate(() => controller.abort());
    await assert.rejects(pending);
  });
});

// ── proxyWebSocketUpgrade: real in-process upgrade + byte piping ───────────────────

describe("proxyWebSocketUpgrade (real in-process upgrade)", () => {
  it("is an exported, callable helper taking (target, req, socket, head, opts)", () => {
    // Construct/smoke assertion: the plumbing entrypoint exists and is callable.
    assert.equal(typeof proxyWebSocketUpgrade, "function");
    // (target, req, clientSocket, head[, options]) → 4 required params.
    assert.equal(proxyWebSocketUpgrade.length, 4);
  });

  it("pipes bytes upstream→client and client→upstream across a live 101 handshake", async () => {
    // 1) A real upstream that speaks a minimal 101 handshake, greets the client,
    //    then echoes anything it receives — no WebSocket library required.
    const upstream = http.createServer();
    upstream.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
      socket.write("upstream-hello");
      socket.on("data", (d: Buffer) => socket.write(`echo:${d.toString()}`));
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;

    // Track every accepted socket on both servers. Once a connection is
    // *upgraded*, node detaches it from the server's own tracking, so neither
    // `server.close()` nor `server.closeAllConnections()` will tear it down —
    // we must destroy these sockets ourselves to let the servers close and the
    // process exit deterministically.
    const openSockets = new Set<net.Socket>();
    const trackConnections = (server: http.Server): void => {
      server.on("connection", (s: net.Socket) => {
        openSockets.add(s);
        s.on("close", () => openSockets.delete(s));
      });
    };

    // 2) A front server whose upgrade event is bridged to the upstream by the
    //    helper under test.
    const errors: Error[] = [];
    const front = http.createServer();
    trackConnections(front);
    trackConnections(upstream);
    front.on("upgrade", (req, socket, head) => {
      proxyWebSocketUpgrade(target(upstreamUrl), req, socket, head, {
        onError: (err) => errors.push(err),
      });
    });
    front.listen(0, "127.0.0.1");
    await once(front, "listening");
    const frontPort = (front.address() as AddressInfo).port;

    try {
      // 3) A raw TCP client issues an HTTP upgrade against the front server.
      const client = net.connect(frontPort, "127.0.0.1");
      await once(client, "connect");

      client.write(
        "GET /ws HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${frontPort}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );

      const waitFor = (predicate: (buf: string) => boolean, label: string): Promise<string> =>
        new Promise<string>((resolve, reject) => {
          let buf = "";
          const timer = setTimeout(() => {
            client.off("data", onData);
            reject(new Error(`timeout waiting for ${label}; received so far: ${JSON.stringify(buf)}`));
          }, 3000);
          const onData = (d: Buffer): void => {
            buf += d.toString();
            if (predicate(buf)) {
              clearTimeout(timer);
              client.off("data", onData);
              resolve(buf);
            }
          };
          client.on("data", onData);
        });

      // upstream→client direction: handshake + greeting flow through the tunnel.
      const handshake = await waitFor(
        (b) => b.includes("101 Switching Protocols") && b.includes("upstream-hello"),
        "upstream handshake + greeting",
      );
      assert.match(handshake, /101 Switching Protocols/);
      assert.match(handshake, /upstream-hello/);

      // client→upstream direction: bytes we send are echoed back through the tunnel.
      client.write("ping");
      const echoed = await waitFor((b) => b.includes("echo:ping"), "echoed client bytes");
      assert.match(echoed, /echo:ping/);

      assert.deepEqual(errors, [], "no proxy transport errors expected");
      client.destroy();
    } finally {
      await closeServer(front);
      await closeServer(upstream);
    }
  });
});
