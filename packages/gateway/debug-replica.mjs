import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { proxyWebSocketUpgrade } from "./dist/proxy.js";

const log = (...a) => console.error("[rep]", ...a);
const target = (url) => ({ id: "u1", url });

async function main() {
  const upstream = http.createServer();
  upstream.on("upgrade", (_req, socket) => {
    log("upstream upgrade");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.write("upstream-hello");
    socket.on("data", (d) => socket.write(`echo:${d.toString()}`));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;

  const errors = [];
  const sockets = new Set();
  const front = http.createServer();
  front.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  front.on("upgrade", (req, socket, head) => {
    proxyWebSocketUpgrade(target(upstreamUrl), req, socket, head, { onError: (e) => errors.push(e) });
  });
  front.listen(0, "127.0.0.1");
  await once(front, "listening");
  const frontPort = front.address().port;

  try {
    const client = net.connect(frontPort, "127.0.0.1");
    await once(client, "connect");
    client.write(
      "GET /ws HTTP/1.1\r\n" + `Host: 127.0.0.1:${frontPort}\r\n` +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
    const waitFor = (predicate, label) =>
      new Promise((resolve, reject) => {
        let buf = "";
        const timer = setTimeout(() => { client.off("data", onData); reject(new Error(`timeout ${label}: ${JSON.stringify(buf)}`)); }, 3000);
        const onData = (d) => { buf += d.toString(); if (predicate(buf)) { clearTimeout(timer); client.off("data", onData); resolve(buf); } };
        client.on("data", onData);
      });
    log("waiting handshake");
    await waitFor((b) => b.includes("101 Switching Protocols") && b.includes("upstream-hello"), "handshake");
    log("handshake ok, sending ping");
    client.write("ping");
    await waitFor((b) => b.includes("echo:ping"), "echo");
    log("echo ok, errors=", errors.length);
    client.destroy();
  } finally {
    log("closing front, tracked sockets=", sockets.size);
    for (const s of sockets) s.destroy();
    await new Promise((r) => { front.close(() => r()); });
    log("front closed");
    log("closing upstream, conns=", (await new Promise((r)=>upstream.getConnections((e,c)=>r(c)))));
    await new Promise((r) => { upstream.closeAllConnections?.(); upstream.close(() => r()); });
    log("upstream closed");
  }
}
main().then(() => log("DONE")).catch((e) => log("ERR", e.message));
