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
