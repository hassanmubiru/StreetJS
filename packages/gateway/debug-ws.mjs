import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { proxyWebSocketUpgrade } from "./dist/proxy.js";

const log = (...a) => console.error("[dbg]", ...a);

const upstream = http.createServer();
upstream.on("upgrade", (_req, socket) => {
  log("upstream got upgrade");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
  );
  socket.write("upstream-hello");
  socket.on("data", (d) => socket.write(`echo:${d.toString()}`));
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const upstreamPort = upstream.address().port;
const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;
log("upstream listening", upstreamPort);

const front = http.createServer();
front.on("upgrade", (req, socket, head) => {
  log("front got upgrade, bridging");
  proxyWebSocketUpgrade({ id: "u1", url: upstreamUrl }, req, socket, head, {
    onError: (err) => log("proxy onError:", err.message),
    onEstablished: () => log("proxy established"),
  });
});
front.listen(0, "127.0.0.1");
await once(front, "listening");
const frontPort = front.address().port;
log("front listening", frontPort);

const client = net.connect(frontPort, "127.0.0.1");
await once(client, "connect");
log("client connected");
client.on("data", (d) => log("client recv:", JSON.stringify(d.toString())));

client.write(
  "GET /ws HTTP/1.1\r\n" +
    `Host: 127.0.0.1:${frontPort}\r\n` +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
);
log("client wrote upgrade request");

setTimeout(() => {
  log("sending ping");
  client.write("ping");
}, 500);

setTimeout(() => {
  log("done, tearing down");
  client.destroy();
  front.close();
  upstream.close();
  process.exit(0);
}, 2000);
