/**
 * @streetjs/gateway — response compression negotiation and codecs.
 *
 * Small, dependency-light helpers the proxy uses to negotiate and apply
 * response compression:
 *
 *  - {@link negotiateEncoding} — parses an `Accept-Encoding` header (honouring
 *    q-values) and picks the best supported, allowed encoding.
 *  - {@link compress} / {@link decompress} — apply/undo a codec so a
 *    compress→decompress round-trip returns the original bytes.
 *  - {@link shouldCompress} — a byte-length threshold gate.
 *
 * The codecs wrap `node:zlib` callbacks with `node:util.promisify` so callers
 * work purely with promises and `Uint8Array` payloads.
 */

import { promisify } from "node:util";
import {
  gzip as gzipCb,
  gunzip as gunzipCb,
  brotliCompress as brotliCompressCb,
  brotliDecompress as brotliDecompressCb,
} from "node:zlib";

import type { CompressionEncoding } from "./types.js";

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);
const brotliCompress = promisify(brotliCompressCb);
const brotliDecompress = promisify(brotliDecompressCb);

/** The default set of encodings the gateway is willing to serve, most-preferred first. */
const DEFAULT_ALLOW: readonly CompressionEncoding[] = ["br", "gzip"];

/** A single parsed `Accept-Encoding` entry: a token and its q-value. */
interface AcceptEntry {
  readonly token: string;
  readonly q: number;
}

/**
 * Parse an `Accept-Encoding` header value into `{ token, q }` entries.
 *
 * Tokens are lower-cased; a missing `q` parameter defaults to `1`. Malformed or
 * empty segments are dropped. The original ordering is preserved so ties can be
 * broken by the caller's preference list rather than header position.
 */
function parseAcceptEncoding(header: string): AcceptEntry[] {
  const entries: AcceptEntry[] = [];
  for (const segment of header.split(",")) {
    const parts = segment.trim().split(";");
    const token = parts[0]?.trim().toLowerCase();
    if (!token) continue;
    let q = 1;
    for (const param of parts.slice(1)) {
      const [key, value] = param.split("=").map((s) => s.trim().toLowerCase());
      if (key === "q") {
        const parsed = Number.parseFloat(value ?? "");
        q = Number.isFinite(parsed) ? parsed : 1;
      }
    }
    entries.push({ token, q });
  }
  return entries;
}

/**
 * Choose the best response encoding for an `Accept-Encoding` header.
 *
 * Given the client's header and the encodings the gateway is willing to serve
 * (`options.allow`, default `["br", "gzip"]`, most-preferred first), returns the
 * acceptable encoding with the highest q-value. Ties are broken by the order of
 * `allow`, so `br` beats `gzip` when both are acceptable and allowed. An entry
 * with `q=0` is treated as explicitly unacceptable.
 *
 * Falls back to `"identity"` when the header is absent, empty, requests only
 * unsupported encodings, or explicitly forbids everything allowed. `"identity"`
 * is always acceptable unless the client sets `identity;q=0`.
 */
export function negotiateEncoding(
  acceptEncoding: string | undefined,
  options?: { allow?: CompressionEncoding[] },
): CompressionEncoding {
  const allow = options?.allow ?? DEFAULT_ALLOW;
  if (acceptEncoding === undefined) return "identity";

  const entries = parseAcceptEncoding(acceptEncoding);
  if (entries.length === 0) return "identity";

  /** The effective q-value the client assigns to `token`, honouring `*`. */
  const qFor = (token: string): number | undefined => {
    const direct = entries.find((e) => e.token === token);
    if (direct) return direct.q;
    const wildcard = entries.find((e) => e.token === "*");
    return wildcard?.q;
  };

  let best: { encoding: CompressionEncoding; q: number } | undefined;
  for (const encoding of allow) {
    const q = qFor(encoding);
    if (q === undefined || q <= 0) continue;
    // `allow` is ordered by preference, so only a strictly higher q wins —
    // ties keep the earlier (more-preferred) encoding.
    if (best === undefined || q > best.q) {
      best = { encoding, q };
    }
  }

  if (best) return best.encoding;

  // No allowed codec is acceptable — identity is the only safe fallback (even
  // if the client set `identity;q=0`, we have nothing compressed to offer).
  return "identity";
}

/**
 * Compress `body` with `encoding`.
 *
 * `"gzip"` uses `zlib.gzip`, `"br"` uses `zlib.brotliCompress`, and
 * `"identity"` returns `body` unchanged. The result is a `Uint8Array` (Buffers
 * returned by zlib are already `Uint8Array` instances).
 */
export async function compress(
  body: Uint8Array,
  encoding: CompressionEncoding,
): Promise<Uint8Array> {
  switch (encoding) {
    case "gzip":
      return gzip(body);
    case "br":
      return brotliCompress(body);
    case "identity":
      return body;
  }
}

/**
 * Decompress `body` that was produced with `encoding` — the inverse of
 * {@link compress}, so a compress→decompress round-trip recovers the original
 * bytes. `"identity"` returns `body` unchanged.
 */
export async function decompress(
  body: Uint8Array,
  encoding: CompressionEncoding,
): Promise<Uint8Array> {
  switch (encoding) {
    case "gzip":
      return gunzip(body);
    case "br":
      return brotliDecompress(body);
    case "identity":
      return body;
  }
}

/**
 * Decide whether a payload of `byteLength` bytes is worth compressing.
 *
 * Returns `true` when `byteLength >= threshold` (default `1024`). Small bodies
 * skip compression, where the header/CPU overhead outweighs the savings.
 */
export function shouldCompress(byteLength: number, threshold = 1024): boolean {
  return byteLength >= threshold;
}
