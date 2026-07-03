/**
 * @streetjs/storage — the signed URL service.
 *
 * A {@link Signed_URL} authorizes a single object operation (GET, PUT, or
 * DELETE) on a single key until an expiry instant, letting clients act directly
 * against storage without proxying through the application server
 * (Requirement 8). {@link SignedUrlService} provides this capability in a
 * **provider-agnostic** way:
 *
 * - When the backing {@link StorageDriver} implements the optional native
 *   `signedUrl` capability, the service delegates minting and verification to
 *   the driver so a provider with first-class signed-URL support (e.g. S3) is
 *   used directly.
 * - Otherwise the service **simulates** signed URLs with an HMAC computed over
 *   the `(key, op, expiry)` tuple (plus the accepted options) using
 *   `config.signingSecret` (`node:crypto` HMAC-SHA256), mirroring the zero-
 *   dependency scheme described in the design. Verification recomputes the HMAC
 *   and checks the expiry against an injected {@link Clock} (default
 *   `systemClock`), so time is deterministic in tests (Requirement 8.3, 8.4).
 *
 * Semantics (Requirement 8):
 * - {@link SignedUrlService.sign} mints a URL authorizing **exactly** the
 *   requested operation on the given key (Requirement 8.1) and accepts options
 *   for expiration, request headers, content type, maximum size, and custom
 *   metadata (Requirement 8.2).
 * - {@link SignedUrlService.verify} returns a {@link SignedUrlVerification}
 *   whose `valid` flag is `true` only when the URL is well-formed, its signature
 *   matches, its authorized operation matches the operation being attempted, and
 *   it is used strictly before its expiry (Requirements 8.3, 8.4). Otherwise
 *   `valid` is `false` with a `reason` of `'expired'`, `'operation-mismatch'`,
 *   `'signature-mismatch'`, or `'malformed'`.
 *
 * The module depends only on the driver contract, the shared type surface, the
 * error hierarchy, and `node:crypto`, keeping the dependency direction acyclic.
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4_
 */

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

import { systemClock, type Clock } from "streetjs";

import type { SignedUrlCapability, StorageDriver } from "./driver.js";
import { StorageConfigError } from "./errors.js";
import type { SignedOperation, SignedUrlOptions, SignedUrlVerification } from "./types.js";

/**
 * The scheme prefix of a simulated signed URL. The remainder of the URL is
 * `<base64url(payload)>.<hmacHex>`, where neither component can contain a `.`
 * (base64url has no `.`; a hex digest has no `.`), so the last `.` is an
 * unambiguous separator.
 */
const SIGNED_URL_SCHEME = "streetjs-signed://";

/** The HMAC digest algorithm used to sign simulated URLs. */
const HMAC_ALGORITHM = "sha256";

/**
 * The default validity window for a minted URL when `options.expiresInMs` is
 * omitted (15 minutes). Chosen to be short-lived by default so an accidentally
 * leaked URL is only briefly usable.
 */
const DEFAULT_EXPIRES_IN_MS = 15 * 60 * 1000;

/** Options for constructing a {@link SignedUrlService}. */
export interface SignedUrlServiceOptions {
  /**
   * The HMAC key used to sign and verify simulated URLs. Required for the
   * simulated path; minting throws a {@link StorageConfigError} when it is
   * absent and the driver has no native `signedUrl` capability.
   */
  readonly signingSecret?: string;
  /** Injected clock for deterministic expiry checks in tests. Default `systemClock`. */
  readonly clock?: Clock;
  /**
   * The backing driver. When it exposes a native `signedUrl` capability, minting
   * and verification delegate to it instead of using the HMAC simulation.
   */
  readonly driver?: StorageDriver;
}

/**
 * The serialized, signature-covered payload of a simulated signed URL. Signing
 * the whole payload (not just `(key, op, expiry)`) makes the accepted options
 * tamper-evident too, while still binding the core `(key, op, expiry)` tuple the
 * design specifies.
 */
interface SignedPayload {
  /** Payload format version, for forward compatibility. */
  readonly v: 1;
  /** The object key the URL authorizes an operation on. */
  readonly key: string;
  /** The single operation the URL authorizes (Requirement 8.1). */
  readonly op: SignedOperation;
  /** The expiry instant as epoch milliseconds (Requirement 8.3). */
  readonly expiry: number;
  /** Optional request headers the URL was minted with (Requirement 8.2). */
  readonly headers?: Record<string, string>;
  /** Optional content type constraint (Requirement 8.2). */
  readonly contentType?: string;
  /** Optional maximum size constraint in bytes (Requirement 8.2). */
  readonly maxSize?: number;
  /** Optional custom metadata carried with the URL (Requirement 8.2). */
  readonly metadata?: Record<string, string>;
}

/**
 * Provider-agnostic signed URL service built on the driver contract and an HMAC
 * simulation.
 *
 * A single instance is held by the facade and bound to one {@link StorageDriver}
 * for its lifetime, so the native-vs-simulated decision (based on whether the
 * driver exposes a `signedUrl` capability) is stable across every call.
 */
export class SignedUrlService {
  /** The HMAC signing secret for the simulated path, when configured. */
  private readonly signingSecret?: string;

  /** Injected clock used to stamp and check expiry. */
  private readonly clock: Clock;

  /** The driver's native signed-URL capability, when present. */
  private readonly native?: SignedUrlCapability;

  constructor(options: SignedUrlServiceOptions = {}) {
    this.signingSecret = options.signingSecret;
    this.clock = options.clock ?? systemClock;
    this.native = options.driver?.signedUrl;
  }

  /**
   * Mint a URL authorizing **exactly** the operation `op` on `key`
   * (Requirement 8.1). The URL carries the accepted options — expiration,
   * request headers, content type, maximum size, and custom metadata
   * (Requirement 8.2) — and, for the simulated path, an HMAC over the whole
   * payload so its `(key, op, expiry)` tuple and options are tamper-evident.
   *
   * The expiry instant is computed from the injected clock plus
   * `options.expiresInMs` (default {@link DEFAULT_EXPIRES_IN_MS}).
   *
   * @throws StorageConfigError when no native capability is available and no
   *   `signingSecret` was configured, since a URL cannot be signed without a key.
   */
  async sign(key: string, op: SignedOperation, options: SignedUrlOptions = {}): Promise<string> {
    if (this.native !== undefined) {
      return this.native.sign(key, op, options);
    }

    const secret = this.requireSigningSecret();
    const expiresInMs = options.expiresInMs ?? DEFAULT_EXPIRES_IN_MS;
    const expiry = this.clock() + expiresInMs;

    const payload: SignedPayload = {
      v: 1,
      key,
      op,
      expiry,
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
      ...(options.contentType !== undefined ? { contentType: options.contentType } : {}),
      ...(options.maxSize !== undefined ? { maxSize: options.maxSize } : {}),
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    };

    const encoded = encodePayload(payload);
    const signature = hmacHex(secret, encoded);
    return `${SIGNED_URL_SCHEME}${encoded}.${signature}`;
  }

  /**
   * Verify a signed `url` for the operation being attempted, returning a
   * {@link SignedUrlVerification}.
   *
   * `valid` is `true` only when the URL is well-formed, its signature matches,
   * its authorized operation equals `expectedOp` (when supplied), and it is used
   * strictly before its expiry relative to `now` (Requirements 8.3, 8.4). When
   * `expectedOp` is omitted the operation check is skipped and only signature and
   * expiry are enforced. `now` defaults to the injected clock so tests can drive
   * expiry deterministically.
   *
   * Failure reasons are reported precisely: `'malformed'` for an unparseable
   * URL, `'signature-mismatch'` for a tampered/incorrectly signed URL,
   * `'operation-mismatch'` when the authorized op differs from `expectedOp`, and
   * `'expired'` when `now` is at or after the expiry.
   */
  verify(url: string, expectedOp?: SignedOperation, now?: number): SignedUrlVerification {
    if (this.native !== undefined) {
      return this.native.verify(url, now ?? this.clock());
    }

    const secret = this.signingSecret;
    if (secret === undefined) {
      // Without a secret no simulated URL could have been minted, so any URL is
      // treated as unverifiable rather than silently valid.
      return { valid: false, reason: "malformed" };
    }

    const parsed = parseSignedUrl(url);
    if (parsed === undefined) {
      return { valid: false, reason: "malformed" };
    }
    const { encoded, signature } = parsed;

    const expected = hmacHex(secret, encoded);
    if (!timingSafeEqualHex(signature, expected)) {
      return { valid: false, reason: "signature-mismatch" };
    }

    const payload = decodePayload(encoded);
    if (payload === undefined) {
      return { valid: false, reason: "malformed" };
    }

    if (expectedOp !== undefined && payload.op !== expectedOp) {
      return {
        valid: false,
        reason: "operation-mismatch",
        key: payload.key,
        op: payload.op,
      };
    }

    const at = now ?? this.clock();
    if (at >= payload.expiry) {
      return { valid: false, reason: "expired", key: payload.key, op: payload.op };
    }

    return { valid: true, key: payload.key, op: payload.op };
  }

  /**
   * Resolve the signing secret or throw a descriptive {@link StorageConfigError}.
   * Used only on the simulated minting path, where a secret is mandatory.
   */
  private requireSigningSecret(): string {
    if (this.signingSecret === undefined || this.signingSecret === "") {
      throw new StorageConfigError(
        "Signed URLs require a non-empty \"signingSecret\" in the storage configuration " +
          "when the driver has no native signed-URL capability.",
      );
    }
    return this.signingSecret;
  }
}

/** Encode a payload as a compact base64url JSON string. */
function encodePayload(payload: SignedPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decode a base64url JSON payload, returning `undefined` when it is malformed. */
function decodePayload(encoded: string): SignedPayload | undefined {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const value = JSON.parse(json) as unknown;
    if (!isSignedPayload(value)) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

/** Structural guard that a decoded value carries the required payload fields. */
function isSignedPayload(value: unknown): value is SignedPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    typeof candidate.key === "string" &&
    (candidate.op === "GET" || candidate.op === "PUT" || candidate.op === "DELETE") &&
    typeof candidate.expiry === "number" &&
    Number.isFinite(candidate.expiry)
  );
}

/**
 * Parse a simulated signed URL into its encoded payload and signature, returning
 * `undefined` when the scheme is wrong or the separator is missing.
 */
function parseSignedUrl(url: string): { encoded: string; signature: string } | undefined {
  if (typeof url !== "string" || !url.startsWith(SIGNED_URL_SCHEME)) {
    return undefined;
  }
  const body = url.slice(SIGNED_URL_SCHEME.length);
  const separator = body.lastIndexOf(".");
  if (separator <= 0 || separator >= body.length - 1) {
    return undefined;
  }
  return { encoded: body.slice(0, separator), signature: body.slice(separator + 1) };
}

/** Compute the lowercase HMAC-SHA256 hex digest of `data` under `secret`. */
function hmacHex(secret: string, data: string): string {
  return createHmac(HMAC_ALGORITHM, secret).update(data).digest("hex");
}

/**
 * Constant-time comparison of two hex signature strings. Falls back to `false`
 * for length mismatches (which `timingSafeEqual` would otherwise throw on).
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
