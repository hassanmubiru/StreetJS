/**
 * @streetjs/gateway — default HTTP(S) forwarder.
 *
 * The gateway forwards a matched request to a concrete {@link UpstreamTarget}
 * through an injectable {@link Forwarder}. Tests always inject a deterministic,
 * in-memory forwarder (no sockets); this module supplies the real, batteries
 * included implementation used when {@link GatewayConfig.forwarder} is omitted.
 *
 * {@link httpForwarder} issues a single request to `target.url + req.path`,
 * streams the request body when present, honours the supplied {@link AbortSignal}
 * (so {@link withTimeout} can cancel a slow upstream), and resolves the collected
 * status/headers/body as a {@link GatewayResponse}. Transport failures reject so
 * the caller's retry/circuit-breaker logic can react.
 */

import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

import type { Forwarder, GatewayResponse, Headers, UpstreamTarget } from "./types.js";

/** Convert a normalized header bag into the `OutgoingHttpHeaders` node expects. */
function toOutgoingHeaders(headers: Headers): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Collect the lower-cased response headers from a node {@link IncomingMessage}. */
function collectHeaders(res: IncomingMessage): Headers {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

/**
 * The default {@link Forwarder}: issue a single HTTP(S) request to
 * `target.url + req.path`, forwarding method, headers, and body. Resolves the
 * upstream status/headers/body as a {@link GatewayResponse}; rejects on any
 * transport error or when `signal` aborts.
 */
export const httpForwarder: Forwarder = (
  target: UpstreamTarget,
  req,
  signal,
): Promise<GatewayResponse> =>
  new Promise<GatewayResponse>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(req.path, target.url);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const clientReq = requestFn(
      url,
      { method: req.method, headers: toOutgoingHeaders(req.headers), signal },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = chunks.length > 0 ? new Uint8Array(Buffer.concat(chunks)) : undefined;
          resolve({
            status: res.statusCode ?? 502,
            headers: collectHeaders(res),
            body,
          });
        });
      },
    );

    clientReq.once("error", (err) => reject(err));
    if (req.body !== undefined) clientReq.write(req.body);
    clientReq.end();
  });

// ── WebSocket upgrade proxying ──────────────────────────────────────────────────

import type { ClientRequest, IncomingHttpHeaders } from "node:http";
import type { Duplex } from "node:stream";

/** Options controlling a single {@link proxyWebSocketUpgrade} call. */
export interface WebSocketUpgradeOptions {
  /** Aborts the upstream connection attempt / tears down the tunnel when fired. */
  readonly signal?: AbortSignal;
  /** Invoked on any transport error (upstream connect failure, socket error). */
  readonly onError?: (err: Error) => void;
  /** Invoked once the upstream 101 handshake is relayed and piping begins. */
  readonly onEstablished?: () => void;
}

/**
 * Convert node's {@link IncomingHttpHeaders} into a plain outgoing bag, dropping
 * `undefined` values. Kept deliberately consistent with {@link httpForwarder}'s
 * header forwarding: every request header (including the hop-by-hop `connection`
 * and `upgrade` headers required to negotiate the tunnel) is forwarded verbatim.
 */
function toUpgradeHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key.toLowerCase()] = value;
  }
  return out;
}

/** Rebuild the raw HTTP status line + headers of an upstream 101 response. */
function reconstructHandshake(res: IncomingMessage): string {
  const status = res.statusCode ?? 101;
  const message = res.statusMessage ?? "Switching Protocols";
  const lines = [`HTTP/1.1 ${status} ${message}`];
  const raw = res.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    lines.push(`${raw[i]}: ${raw[i + 1]}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

/**
 * Wire a client HTTP `upgrade` (as delivered by node's `http.Server` `"upgrade"`
 * event) to an upstream {@link UpstreamTarget}, establishing a bidirectional
 * byte tunnel between the two sockets.
 *
 * The flow mirrors a real reverse proxy WebSocket bridge:
 *  1. Issue a node `http.request` to `target.url + req.url`, forwarding the
 *     client's method and headers (so `Upgrade`/`Connection`/`Sec-WebSocket-*`
 *     survive) — header handling is consistent with {@link httpForwarder}.
 *  2. When the upstream answers `101` (the request's `"upgrade"` event), relay
 *     the upstream status line + headers back to the client socket, flush any
 *     buffered `head` bytes in both directions, then `pipe` the sockets so all
 *     subsequent frames flow through untouched.
 *  3. Propagate teardown: an error or close on either socket destroys the peer,
 *     and an aborted `signal` tears the whole tunnel down.
 *
 * Returns the upstream {@link ClientRequest} so callers can observe/abort it.
 */
export function proxyWebSocketUpgrade(
  target: UpstreamTarget,
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  options: WebSocketUpgradeOptions = {},
): ClientRequest {
  const url = new URL(req.url ?? "/", target.url);
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;

  const upstreamReq = requestFn(url, {
    method: req.method ?? "GET",
    headers: toUpgradeHeaders(req.headers),
    signal: options.signal,
  });

  const fail = (err: Error): void => {
    options.onError?.(err);
    if (!clientSocket.destroyed) clientSocket.destroy();
  };

  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket: Duplex, upstreamHead: Buffer) => {
    // Relay the upstream handshake (status line + headers) to the client.
    clientSocket.write(reconstructHandshake(upstreamRes));

    // Flush any bytes buffered past the header boundary, in both directions.
    if (upstreamHead && upstreamHead.length > 0) clientSocket.write(upstreamHead);
    if (head && head.length > 0) upstreamSocket.write(head);

    // Tear one side down when the other errors or closes.
    const teardown = (err?: Error): void => {
      if (err) options.onError?.(err);
      if (!upstreamSocket.destroyed) upstreamSocket.destroy();
      if (!clientSocket.destroyed) clientSocket.destroy();
    };
    upstreamSocket.on("error", teardown);
    clientSocket.on("error", teardown);
    upstreamSocket.on("close", () => teardown());
    clientSocket.on("close", () => teardown());

    // The real bidirectional plumbing: every subsequent byte is piped through.
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);

    options.onEstablished?.();
  });

  upstreamReq.on("error", (err: Error) => fail(err));

  // Some upstreams (or errors) may return a normal response instead of 101;
  // treat that as a failed upgrade and close the client tunnel.
  upstreamReq.on("response", () => {
    fail(new Error("upstream did not upgrade the connection"));
  });

  upstreamReq.end();
  return upstreamReq;
}
