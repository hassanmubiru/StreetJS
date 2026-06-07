// src/security/mtls.ts
// Mutual TLS (mTLS) support: a client-certificate-requiring HTTPS server helper,
// client-certificate validation (against a trust store + optional CN allow-list),
// and SHA-256 certificate fingerprint pinning. Built on node:tls / node:https
// and node:crypto — no third-party dependencies.

import { createServer as createHttpsServer, type Server as HttpsServer, type ServerOptions } from 'node:https';
import type { TLSSocket, PeerCertificate, SecureContextOptions } from 'node:tls';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '../http/exceptions.js';

// ── Fingerprints & pinning ──────────────────────────────────────────────────────

/** Compute the SHA-256 fingerprint of a DER certificate as lowercase hex (no colons). */
export function certificateFingerprint(der: Buffer): string {
  return createHash('sha256').update(der).digest('hex');
}

/** Normalise a fingerprint to lowercase hex without separators. */
function normalizeFp(fp: string): string {
  return fp.replace(/:/g, '').replace(/\s/g, '').toLowerCase();
}

/** Constant-time check that a certificate's fingerprint is in the pin set. */
export function verifyCertificatePin(der: Buffer, pins: string[]): boolean {
  const actual = certificateFingerprint(der);
  const a = Buffer.from(actual, 'hex');
  for (const pin of pins) {
    const want = Buffer.from(normalizeFp(pin), 'hex');
    if (a.length === want.length && timingSafeEqual(a, want)) return true;
  }
  return false;
}

// ── Client-certificate validation ───────────────────────────────────────────────

export interface ClientCertPolicy {
  /** Require a client certificate; reject if absent. Default true. */
  required?: boolean;
  /** Allowed certificate SHA-256 fingerprints (pinning). When set, the cert must match one. */
  allowedFingerprints?: string[];
  /** Allowed subject Common Names. When set, the cert subject CN must be in this list. */
  allowedCommonNames?: string[];
}

export interface ClientCertResult {
  ok: boolean;
  reason?: string;
  subjectCN?: string;
  fingerprint?: string;
}

/** A structural view of the peer certificate (subset of node:tls PeerCertificate). */
export interface PeerCertLike {
  subject?: { CN?: string };
  fingerprint256?: string;
  raw?: Buffer;
}

/**
 * Validate a peer certificate against a policy. `authorized` is the TLS-layer
 * chain-of-trust result (`TLSSocket.authorized`). Pinning/CN checks are applied
 * on top. Returns a structured result rather than throwing, so it is unit-testable.
 */
export function validateClientCert(
  cert: PeerCertLike | undefined,
  authorized: boolean,
  policy: ClientCertPolicy = {},
): ClientCertResult {
  const required = policy.required ?? true;
  const present = !!cert && !!cert.raw && cert.raw.length > 0;

  if (!present) {
    return required ? { ok: false, reason: 'client_certificate_required' } : { ok: true };
  }

  const fingerprint = cert!.raw ? certificateFingerprint(cert!.raw) : (cert!.fingerprint256 ? normalizeFp(cert!.fingerprint256) : undefined);
  const subjectCN = cert!.subject?.CN;

  // If pinning is configured, a matching pin is sufficient (and bypasses CA trust,
  // enabling self-signed pinned certs). Otherwise the TLS chain must be authorized.
  if (policy.allowedFingerprints && policy.allowedFingerprints.length > 0) {
    if (!cert!.raw || !verifyCertificatePin(cert!.raw, policy.allowedFingerprints)) {
      return { ok: false, reason: 'fingerprint_not_pinned', subjectCN, fingerprint };
    }
  } else if (!authorized) {
    return { ok: false, reason: 'untrusted_client_certificate', subjectCN, fingerprint };
  }

  if (policy.allowedCommonNames && policy.allowedCommonNames.length > 0) {
    if (!subjectCN || !policy.allowedCommonNames.includes(subjectCN)) {
      return { ok: false, reason: 'common_name_not_allowed', subjectCN, fingerprint };
    }
  }

  return { ok: true, subjectCN, fingerprint };
}

// ── Middleware ────────────────────────────────────────────────────────────────

interface MtlsContext {
  req: IncomingMessage;
  state: Record<string, unknown>;
}

/**
 * Middleware enforcing a {@link ClientCertPolicy} on the request's TLS socket.
 * On success, stores `{ subjectCN, fingerprint }` in `ctx.state['clientCert']`.
 * On failure, throws {@link UnauthorizedException}. Requires the server to have
 * been created with `requestCert: true` (see {@link createMutualTlsServer}).
 */
export function clientCertMiddleware(policy: ClientCertPolicy = {}) {
  return async (ctx: MtlsContext, next: () => Promise<void>): Promise<void> => {
    const socket = ctx.req.socket as TLSSocket;
    const authorized = typeof socket.authorized === 'boolean' ? socket.authorized : false;
    const cert = typeof socket.getPeerCertificate === 'function'
      ? socket.getPeerCertificate(true) as PeerCertificate | undefined
      : undefined;
    const result = validateClientCert(cert as PeerCertLike | undefined, authorized, policy);
    if (!result.ok) {
      throw new UnauthorizedException(`mTLS: ${result.reason}`);
    }
    ctx.state['clientCert'] = { subjectCN: result.subjectCN, fingerprint: result.fingerprint };
    await next();
  };
}

// ── Server helper ───────────────────────────────────────────────────────────────

export interface MutualTlsServerOptions {
  /** Server certificate (PEM). */
  cert: string | Buffer;
  /** Server private key (PEM). */
  key: string | Buffer;
  /** Trusted CA certificate(s) used to verify client certs. */
  ca: string | Buffer | Array<string | Buffer>;
  /** Request a client certificate. Default true. */
  requestCert?: boolean;
  /**
   * Reject TLS connections whose client cert fails CA verification at the TLS
   * layer. Set false to defer authorization to `clientCertMiddleware`
   * (e.g. when using fingerprint pinning with self-signed client certs).
   */
  rejectUnauthorized?: boolean;
  /** Minimum TLS version. Default 'TLSv1.2'. */
  minVersion?: 'TLSv1.2' | 'TLSv1.3';
}

/**
 * Create an HTTPS server configured for mutual TLS. The server requests (and,
 * by default, requires CA-verified) client certificates. Pair with
 * `clientCertMiddleware` for fine-grained pinning / CN allow-listing.
 */
export function createMutualTlsServer(
  opts: MutualTlsServerOptions,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): HttpsServer {
  const serverOpts: ServerOptions = {
    cert: opts.cert,
    key: opts.key,
    ca: opts.ca,
    requestCert: opts.requestCert ?? true,
    rejectUnauthorized: opts.rejectUnauthorized ?? true,
    minVersion: opts.minVersion ?? 'TLSv1.2',
  };
  return createHttpsServer(serverOpts, handler);
}
