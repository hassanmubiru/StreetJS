// packages/plugin-marzpay/src/index.ts
// Official StreetJS plugin: MarzPay payments.
//
// Dependency-free: request construction is pure and offline-verifiable; the
// network send uses node:https. Mirrors the audited @streetjs/plugin-paypal
// design. The concrete MarzPay API surface (base address, auth scheme, endpoint
// paths, webhook scheme) is bound from the verify-don't-invent Research_Artifact
// at docs/integrations/marzpay-research.md in later tasks (MarzPaySpec seam).
//
// NOTE: This is the package skeleton (Task 2). Configuration validation, the
// MarzPaySpec binding, the pure request builders, the MarzPayClient transport,
// and the MarzPayPlugin lifecycle are implemented in subsequent tasks
// (3.1, 4.1, 5.x, 6.x, 7.x, 8.x).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';

import { PluginModule, PluginError, type SandboxedApp, type PluginManifest } from 'streetjs';

/** Manifest name, matching manifest.json so the plugin host verifies on load. */
export const MARZPAY_PLUGIN_NAME = 'street-plugin-marzpay';
export const MARZPAY_PLUGIN_VERSION = '1.0.0';

/**
 * The plugin manifest, mirroring the PayPal convention so the Marketplace_Generator
 * categorizes the plugin under `Payments` and `PluginHost` verifies the signed
 * manifest on load.
 */
export function marzPayPluginManifest(): PluginManifest {
  return {
    name: MARZPAY_PLUGIN_NAME,
    version: MARZPAY_PLUGIN_VERSION,
    capabilities: ['payments', 'marzpay'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

// ---------------------------------------------------------------------------
// Configuration schema
// ---------------------------------------------------------------------------
//
// The runtime validator (`validateMarzPayConfig`) is authored in a later task
// (4.1). The interface is declared here because `MarzPaySpec.authHeaders` reads
// the verified credential fields (`apiKey`/`secretKey`) from it.

/** Configuration schema for the MarzPay plugin. */
export interface MarzPayPluginConfig {
  /** MarzPay API key (dashboard API Keys section). Maps to the Basic-auth user. */
  apiKey: string;
  /** MarzPay API secret. Maps to the Basic-auth password. */
  secretKey: string;
  /**
   * Selected environment. Defaults to `'sandbox'`. NOTE (from Research_Artifact
   * V8/V9): MarzPay exposes a SINGLE base URL for both sandbox and production;
   * the active mode is auto-detected from the account/key, not from the host.
   */
  environment?: 'sandbox' | 'production';
  /** State key under which the client is injected. Default `'marzpay'`. */
  stateKey?: string;
  /** Request timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
}

/** Default request timeout, in milliseconds, when `timeoutMs` is omitted. */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Default app-state key under which the client is injected. */
const DEFAULT_STATE_KEY = 'marzpay';

/**
 * Validate and normalize raw MarzPay plugin configuration.
 *
 * Mirrors `validatePayPalConfig` (@streetjs/plugin-paypal): throws a
 * `PluginError` naming the offending field when `apiKey`/`secretKey` are
 * missing/empty/whitespace-only or when `environment` is neither `'sandbox'`
 * nor `'production'`. On success it returns a normalized config with
 * `environment` defaulted to `'sandbox'`, `stateKey` to `'marzpay'`, and
 * `timeoutMs` to `30_000`. A thrown config never yields an injected client
 * (Requirements 2.3, 2.4, 2.6, 2.7).
 */
export function validateMarzPayConfig(input: unknown): MarzPayPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('MarzPay plugin config must be an object');
  }
  const o = input as Record<string, unknown>;

  if (typeof o['apiKey'] !== 'string' || (o['apiKey'] as string).trim() === '') {
    throw new PluginError('MarzPay plugin config: "apiKey" is required and must be a non-empty string');
  }
  if (typeof o['secretKey'] !== 'string' || (o['secretKey'] as string).trim() === '') {
    throw new PluginError('MarzPay plugin config: "secretKey" is required and must be a non-empty string');
  }
  if (o['environment'] !== undefined && o['environment'] !== 'sandbox' && o['environment'] !== 'production') {
    throw new PluginError('MarzPay plugin config: "environment" must be "sandbox" or "production"');
  }
  if (o['stateKey'] !== undefined && (typeof o['stateKey'] !== 'string' || (o['stateKey'] as string).trim() === '')) {
    throw new PluginError('MarzPay plugin config: "stateKey" must be a non-empty string');
  }
  if (
    o['timeoutMs'] !== undefined &&
    (typeof o['timeoutMs'] !== 'number' || !Number.isFinite(o['timeoutMs']) || (o['timeoutMs'] as number) <= 0)
  ) {
    throw new PluginError('MarzPay plugin config: "timeoutMs" must be a positive number');
  }

  return {
    apiKey: o['apiKey'] as string,
    secretKey: o['secretKey'] as string,
    environment: (o['environment'] as 'sandbox' | 'production' | undefined) ?? 'sandbox',
    stateKey: (o['stateKey'] as string | undefined) ?? DEFAULT_STATE_KEY,
    timeoutMs: (o['timeoutMs'] as number | undefined) ?? DEFAULT_TIMEOUT_MS,
  };
}

// ---------------------------------------------------------------------------
// Verify-don't-invent spec seam (Task 3.1)
// ---------------------------------------------------------------------------
//
// `MarzPaySpec` names every API-shaped decision the plugin makes. Its concrete
// value (`MARZPAY_SPEC`) is authored ONLY from values recorded as a
// Verified_Capability in docs/integrations/marzpay-research.md. Any topic the
// Research_Artifact records as a limitation leaves its seam ABSENT so the
// dependent operation cannot be exported — enforcing verify-don't-invent at the
// type level (Requirements 1.6, 1.7).

/**
 * Endpoint paths bound from the Research_Artifact.
 *
 * Verified paths (Appendix A) are REQUIRED. The `refund` path is recorded as an
 * undocumented limitation (Research_Artifact §L5) and is therefore OPTIONAL:
 * it is left absent in `MARZPAY_SPEC` so no refund operation can be built from
 * an invented endpoint (Requirement 1.7).
 */
export interface MarzPayPaths {
  /** Verified: `POST /collect-money` (mobile money or `method:"card"`). */
  readonly initializePayment: string;
  /** Verified: `GET /transactions/{id}` (id = reference or uuid). */
  readonly verifyPayment: (reference: string) => string;
  /** Verified: `GET /transactions/{uuid}`. */
  readonly getTransaction: (id: string) => string;
  /** Verified: `GET /transactions`. */
  readonly listTransactions: string;
  /**
   * UNVERIFIED — no refund creation endpoint is documented (§L5). Left absent in
   * `MARZPAY_SPEC`; optional so the refund seam stays unbound and unimplemented.
   */
  readonly refund?: string;
}

/**
 * Verified webhook signature scheme (algorithm + header name + encoding).
 *
 * MarzPay_Documentation documents webhook delivery and payload (V4) but NO
 * signature header, algorithm, encoding, or signing secret (§L4). This entire
 * seam is therefore OPTIONAL and is left ABSENT in `MARZPAY_SPEC`; do not invent
 * an HMAC scheme (Requirement 1.7).
 */
export interface MarzPayWebhookScheme {
  readonly signatureHeader: string;
  readonly algorithm: 'sha256' | 'sha512';
  readonly encoding: 'hex' | 'base64';
}

/** Concrete API decisions, each traceable to a Verified_Capability. */
export interface MarzPaySpec {
  /**
   * Base address per environment. Per Research_Artifact V8/V9/R2 there is a
   * SINGLE base URL for both `sandbox` and `production` (sandbox is
   * auto-detected by the account/key, not a different host).
   */
  readonly baseAddress: Readonly<Record<'sandbox' | 'production', string>>;
  /**
   * Build auth headers from credentials per the verified auth scheme (V1):
   * HTTP Basic `Authorization: Basic base64(apiKey:secretKey)` plus
   * `Content-Type: application/json`.
   */
  readonly authHeaders: (cfg: MarzPayPluginConfig) => Record<string, string>;
  /** Verified endpoint paths (refund left absent — see `MarzPayPaths`). */
  readonly paths: MarzPayPaths;
  /**
   * Verified webhook signature scheme. ABSENT here because no scheme is
   * documented (§L4); the `validateWebhook` operation must instead rely on the
   * documented, verifiable trust path (server-side re-verification).
   */
  readonly webhook?: MarzPayWebhookScheme;
}

/**
 * The single, verified base URL shared by sandbox and production.
 * Source: Research_Artifact Appendix A; `/documentation/api`, `/documentation/sandbox`.
 */
const MARZPAY_BASE_URL = 'https://wallet.wearemarz.com/api/v1';

/**
 * Authored ONLY from values recorded as a Verified_Capability in
 * docs/integrations/marzpay-research.md. Unverified topics (refund path,
 * webhook signature scheme) are intentionally left absent.
 */
export const MARZPAY_SPEC: MarzPaySpec = {
  // V8/V9/R2: one base URL bound to BOTH environment selections; environment is
  // determined by the account/key, not by a distinct host.
  baseAddress: {
    sandbox: MARZPAY_BASE_URL,
    production: MARZPAY_BASE_URL,
  },
  // V1: HTTP Basic over base64(apiKey:secretKey) + JSON content type.
  authHeaders: (cfg: MarzPayPluginConfig): Record<string, string> => {
    const credentials = Buffer.from(`${cfg.apiKey}:${cfg.secretKey}`, 'utf8').toString('base64');
    return {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    };
  },
  paths: {
    // V2: Collect Money endpoint (mobile money or card).
    initializePayment: '/collect-money',
    // V3: transaction lookup accepts reference or uuid.
    verifyPayment: (reference: string): string => `/transactions/${reference}`,
    getTransaction: (id: string): string => `/transactions/${id}`,
    // V3: list with documented filters.
    listTransactions: '/transactions',
    // refund: ABSENT — undocumented (§L5). Do not bind.
  },
  // webhook: ABSENT — no signature scheme documented (§L4). Do not bind.
};

// ---------------------------------------------------------------------------
// Verify-don't-invent unsupported-operation seam (Task 1.1)
// ---------------------------------------------------------------------------
//
// A single error type and guard centralize the verify-don't-invent error path so
// every operation backed by an UNBOUND MarzPaySpec seam behaves identically and
// never touches the network. An operation whose endpoint is not recorded as a
// Verified_Capability in the Research_Artifact MUST surface this error and issue
// no request (Requirements 1.3, 3.6, 5.3, 10.5, 12.7).

/**
 * Thrown when an operation requires an endpoint that is not (yet) recorded as a
 * Verified_Capability in the Research_Artifact (docs/integrations/marzpay-research.md).
 *
 * The message NAMES the offending capability and references the Research_Artifact
 * so the verify-don't-invent boundary is explicit at the call site. Extends
 * `PluginError` so existing `instanceof PluginError` handling continues to apply.
 */
export class UnsupportedOperationError extends PluginError {
  constructor(capability: string) {
    super(
      `MarzPay ${capability}: unsupported — no endpoint is recorded as a ` +
        `Verified_Capability in the Research_Artifact; operation unavailable`,
    );
    this.name = 'UnsupportedOperationError';
  }
}

/**
 * Guard a capability behind a possibly-unbound MarzPaySpec seam.
 *
 * Throws `UnsupportedOperationError` (no network I/O) when `seam` is `undefined`,
 * naming `capability`; otherwise returns the bound seam value unchanged. This
 * keeps verify-don't-invent enforced at every unverified call site (Req 1.3).
 *
 * Exported (like the pure request builders) so it is unit-testable in isolation;
 * it remains an internal verify-don't-invent guard, not part of the namespaced
 * client surface.
 */
export function requireBoundSeam(seam: string | undefined, capability: string): string {
  if (seam === undefined) {
    throw new UnsupportedOperationError(capability);
  }
  return seam;
}

// ---------------------------------------------------------------------------
// Pure request builders and argument guards (Task 5.1)
// ---------------------------------------------------------------------------
//
// Mirrors @streetjs/plugin-paypal's `buildCreateOrderRequest` style: request
// construction is PURE and offline-verifiable; nothing here touches the network
// (the `MarzPayClient.send` transport is authored in Task 7.1). Every field and
// endpoint is bound from a Verified_Capability in
// docs/integrations/marzpay-research.md — unverified topics (refunds, §L5) are
// guarded so no request is ever sent to an invented endpoint.

/** A fully-described outbound HTTPS request (pure, offline-verifiable). */
export interface MarzPayHttpRequest {
  /** HTTP verb (e.g. `'POST'`, `'GET'`). */
  method: string;
  /** Absolute request URL (`spec.baseAddress[environment]` + verified path). */
  url: string;
  /** Request headers (from `spec.authHeaders(cfg)`). */
  headers: Record<string, string>;
  /** Serialized JSON request body (empty string when there is no body). */
  body: string;
}

/**
 * A payment-initialization request for the verified `POST /collect-money`
 * endpoint (Research_Artifact V2). MarzPay-required fields are `amount`,
 * `country`, a unique `reference`, and a payment channel — either `phone_number`
 * (mobile money) OR `method: 'card'`. The remaining fields are optional
 * pass-throughs documented for the same endpoint.
 */
export interface PaymentRequest {
  /** Required: collection amount (UGX). */
  amount: number;
  /** Required: ISO country code (e.g. `'UG'`). */
  country: string;
  /** Required: unique client reference (UUID v4 per V2). */
  reference: string;
  /** Mobile money channel: customer MSISDN (`+256xxxxxxxxx`). */
  phone_number?: string;
  /** Card channel selector; set to `'card'` for a card collection. */
  method?: 'card';
  /** Optional collection currency (defaults to UGX per region). */
  currency?: string;
  /** Optional human-readable description (max 255). */
  description?: string;
  /** Optional callback URL for the asynchronous webhook (max 255). */
  callback_url?: string;
}

/**
 * A refund request. NOTE: MarzPay documents NO refund creation endpoint
 * (Research_Artifact §L5); the `refund` seam is intentionally left unbound, so
 * `buildRefundRequest` rejects with an unsupported-operation error and never
 * builds a request. The shape is declared so the operation has a typed argument
 * if/when MarzPay publishes a refund API.
 */
export interface RefundRequest {
  /** Identifier of the transaction to refund. */
  transactionId: string;
  /** Optional partial-refund amount; full refund when omitted. */
  amount?: number;
}

/** Resolve the verified base address for the config's environment (default sandbox). */
function resolveBaseAddress(cfg: MarzPayPluginConfig, spec: MarzPaySpec): string {
  return spec.baseAddress[cfg.environment ?? 'sandbox'];
}

/** True when `value` is a non-empty, non-whitespace-only string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Build the verified `POST /collect-money` payment-initialization request
 * (Research_Artifact V2) from `cfg`/`spec`/`req`.
 *
 * Reject (throwing a `PluginError` that NAMES the offending field, sending
 * nothing) when any MarzPay-required field is missing/empty:
 * - `amount` must be a finite, positive number;
 * - `country` must be a non-empty string;
 * - `reference` must be a non-empty string;
 * - a payment channel must be present: either `method: 'card'` OR a non-empty
 *   `phone_number` (mobile money).
 *
 * On success it builds a `MarzPayHttpRequest` with the verified method/url
 * (`spec.baseAddress[environment]` + `spec.paths.initializePayment`), the
 * verified auth headers (`spec.authHeaders(cfg)`), and a JSON body carrying the
 * required fields plus any provided optional pass-throughs (Requirements 3.1,
 * 3.9, 2.8).
 */
export function buildInitializePaymentRequest(
  cfg: MarzPayPluginConfig,
  spec: MarzPaySpec,
  req: PaymentRequest,
): MarzPayHttpRequest {
  if (typeof req !== 'object' || req === null) {
    throw new PluginError('MarzPay initializePayment: request must be an object');
  }
  if (typeof req.amount !== 'number' || !Number.isFinite(req.amount) || req.amount <= 0) {
    throw new PluginError('MarzPay initializePayment: "amount" is required and must be a positive number');
  }
  if (!isNonEmptyString(req.country)) {
    throw new PluginError('MarzPay initializePayment: "country" is required and must be a non-empty string');
  }
  if (!isNonEmptyString(req.reference)) {
    throw new PluginError('MarzPay initializePayment: "reference" is required and must be a non-empty string');
  }
  // Verified channel rule (V2): card collection OR mobile money via phone_number.
  const isCard = req.method === 'card';
  if (!isCard && !isNonEmptyString(req.phone_number)) {
    throw new PluginError(
      'MarzPay initializePayment: a payment channel is required — provide "phone_number" (mobile money) or set "method" to "card"',
    );
  }

  const payload: Record<string, unknown> = {
    amount: req.amount,
    country: req.country,
    reference: req.reference,
  };
  if (isCard) {
    payload['method'] = 'card';
  } else {
    payload['phone_number'] = req.phone_number;
  }
  if (isNonEmptyString(req.currency)) payload['currency'] = req.currency;
  if (isNonEmptyString(req.description)) payload['description'] = req.description;
  if (isNonEmptyString(req.callback_url)) payload['callback_url'] = req.callback_url;

  return {
    method: 'POST',
    url: `${resolveBaseAddress(cfg, spec)}${spec.paths.initializePayment}`,
    headers: spec.authHeaders(cfg),
    body: JSON.stringify(payload),
  };
}

/**
 * Build a refund request — UNSUPPORTED.
 *
 * MarzPay documents NO refund creation endpoint (Research_Artifact §L5), so
 * `spec.paths.refund` is intentionally left ABSENT in `MARZPAY_SPEC`. This
 * builder guards on that absence: when the refund path is unbound it throws a
 * clear "refunds not supported by MarzPay" error and sends nothing — it never
 * calls an invented endpoint (verify-don't-invent, Requirement 3.5).
 *
 * The required-field guard below is retained for the day MarzPay publishes a
 * refund API and the seam becomes bound; until then it is unreachable because
 * the unsupported-operation guard returns first.
 */
export function buildRefundRequest(
  cfg: MarzPayPluginConfig,
  spec: MarzPaySpec,
  req: RefundRequest,
): MarzPayHttpRequest {
  const refundPath = spec.paths.refund;
  if (refundPath === undefined) {
    throw new PluginError(
      'MarzPay refund: refunds are not supported by MarzPay (no refund endpoint is documented); operation unavailable',
    );
  }
  if (typeof req !== 'object' || req === null) {
    throw new PluginError('MarzPay refund: request must be an object');
  }
  if (!isNonEmptyString(req.transactionId)) {
    throw new PluginError('MarzPay refund: "transactionId" is required and must be a non-empty string');
  }

  const payload: Record<string, unknown> = { transaction_id: req.transactionId };
  if (typeof req.amount === 'number' && Number.isFinite(req.amount)) {
    payload['amount'] = req.amount;
  }

  return {
    method: 'POST',
    url: `${resolveBaseAddress(cfg, spec)}${refundPath}`,
    headers: spec.authHeaders(cfg),
    body: JSON.stringify(payload),
  };
}

// ---------------------------------------------------------------------------
// Lookup request builders and argument guards (Task 5.3)
// ---------------------------------------------------------------------------
//
// Mirrors the PayPal builder style: request construction is PURE and
// offline-verifiable; nothing here touches the network (the transport is
// authored in Task 7.1). Each builds a verified GET request — GET requests
// carry an empty-string body. Reference/identifier arguments are trimmed and
// length-guarded before any request is constructed (Requirements 3.2, 3.3,
// 3.4, 3.10, 2.8).

/** Maximum accepted length (after trimming) for a reference/transaction id. */
const MAX_IDENTIFIER_LENGTH = 256;

/**
 * Trim and validate a reference/identifier argument, returning the trimmed
 * value. Throws a `PluginError` that NAMES the offending argument — and so no
 * request is built/sent — when the value is not a string, is empty or
 * whitespace-only, or exceeds `MAX_IDENTIFIER_LENGTH` characters after trimming
 * (Requirements 3.2, 3.3, 3.10).
 */
function guardIdentifierArgument(value: unknown, argName: string, operation: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PluginError(
      `MarzPay ${operation}: "${argName}" is required and must be a non-empty string`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    throw new PluginError(
      `MarzPay ${operation}: "${argName}" must be at most ${MAX_IDENTIFIER_LENGTH} characters`,
    );
  }
  return trimmed;
}

/**
 * Build the verified `GET /transactions/{reference}` payment-verification
 * request (Research_Artifact V3) from `cfg`/`spec`/`reference`.
 *
 * The `reference` argument is trimmed and length-guarded first: an empty,
 * whitespace-only, or `>256`-char reference throws a `PluginError` naming the
 * `"reference"` argument and NO request is built. On success it builds a
 * `MarzPayHttpRequest` with the verified method/url
 * (`spec.baseAddress[environment]` + `spec.paths.verifyPayment(trimmedReference)`),
 * the verified auth headers (`spec.authHeaders(cfg)`), and an empty-string body
 * (Requirements 3.2, 3.3, 3.10, 2.8).
 */
export function buildVerifyPaymentRequest(
  cfg: MarzPayPluginConfig,
  spec: MarzPaySpec,
  reference: string,
): MarzPayHttpRequest {
  const trimmedReference = guardIdentifierArgument(reference, 'reference', 'verifyPayment');
  return {
    method: 'GET',
    url: `${resolveBaseAddress(cfg, spec)}${spec.paths.verifyPayment(trimmedReference)}`,
    headers: spec.authHeaders(cfg),
    body: '',
  };
}

/**
 * Build the verified `GET /transactions/{id}` transaction-detail request
 * (Research_Artifact V3) from `cfg`/`spec`/`id`.
 *
 * The `id` argument is trimmed and length-guarded first: an empty,
 * whitespace-only, or `>256`-char id throws a `PluginError` naming the `"id"`
 * argument and NO request is built. On success it builds a `MarzPayHttpRequest`
 * with the verified method/url (`spec.baseAddress[environment]` +
 * `spec.paths.getTransaction(trimmedId)`), the verified auth headers
 * (`spec.authHeaders(cfg)`), and an empty-string body (Requirements 3.4, 3.10,
 * 2.8).
 */
export function buildGetTransactionRequest(
  cfg: MarzPayPluginConfig,
  spec: MarzPaySpec,
  id: string,
): MarzPayHttpRequest {
  const trimmedId = guardIdentifierArgument(id, 'id', 'getTransaction');
  return {
    method: 'GET',
    url: `${resolveBaseAddress(cfg, spec)}${spec.paths.getTransaction(trimmedId)}`,
    headers: spec.authHeaders(cfg),
    body: '',
  };
}

/**
 * Documented query filters for `GET /transactions` (Research_Artifact V3,
 * Appendix A). All fields are OPTIONAL; only the provided filters are appended
 * to the query string. `type` is constrained to the documented filter values
 * (`collection`, `withdrawal`, `charge`, `refund`).
 */
export interface ListTransactionsQuery {
  /** 1-based page number. */
  page?: number;
  /** Page size (documented range 1–100). */
  per_page?: number;
  /** Transaction type filter. */
  type?: 'collection' | 'withdrawal' | 'charge' | 'refund';
  /** Transaction status filter. */
  status?: string;
  /** Provider filter (e.g. MTN/Airtel/card). */
  provider?: string;
  /** Inclusive start date filter. */
  start_date?: string;
  /** Inclusive end date filter. */
  end_date?: string;
  /** Client reference filter. */
  reference?: string;
}

/**
 * Build the verified `GET /transactions` list request (Research_Artifact V3)
 * from `cfg`/`spec` and an optional `query`.
 *
 * `listTransactions` has NO required arguments. When `query` is provided, only
 * the documented filters that are present are appended as a query string:
 * numeric filters (`page`, `per_page`) when finite, and the string-valued
 * filters (`type`, `status`, `provider`, `start_date`, `end_date`,
 * `reference`) when non-empty after trimming. It builds a `MarzPayHttpRequest`
 * with the verified method/url, the verified auth headers
 * (`spec.authHeaders(cfg)`), and an empty-string body (Requirements 3.4, 2.8).
 */
export function buildListTransactionsRequest(
  cfg: MarzPayPluginConfig,
  spec: MarzPaySpec,
  query?: ListTransactionsQuery,
): MarzPayHttpRequest {
  const params = new URLSearchParams();
  if (query !== undefined && query !== null) {
    if (typeof query.page === 'number' && Number.isFinite(query.page)) {
      params.set('page', String(query.page));
    }
    if (typeof query.per_page === 'number' && Number.isFinite(query.per_page)) {
      params.set('per_page', String(query.per_page));
    }
    if (isNonEmptyString(query.type)) params.set('type', query.type.trim());
    if (isNonEmptyString(query.status)) params.set('status', query.status.trim());
    if (isNonEmptyString(query.provider)) params.set('provider', query.provider.trim());
    if (isNonEmptyString(query.start_date)) params.set('start_date', query.start_date.trim());
    if (isNonEmptyString(query.end_date)) params.set('end_date', query.end_date.trim());
    if (isNonEmptyString(query.reference)) params.set('reference', query.reference.trim());
  }

  const queryString = params.toString();
  const url = `${resolveBaseAddress(cfg, spec)}${spec.paths.listTransactions}${
    queryString === '' ? '' : `?${queryString}`
  }`;

  return {
    method: 'GET',
    url,
    headers: spec.authHeaders(cfg),
    body: '',
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification (Task 6.1)
// ---------------------------------------------------------------------------
//
// PURE, scheme-parameterized HMAC primitive built on node:crypto only. This is
// generic cryptography, NOT a claim about MarzPay's behavior: MarzPay publishes
// NO webhook signature scheme (Research_Artifact §L4, Risk R1), so
// `MARZPAY_SPEC.webhook` is intentionally left UNBOUND (undefined). When the
// scheme is undefined this primitive returns `false` — there is no verified
// positive path via signature against an undocumented scheme. The live
// `validateWebhook` (Task 7.1) calls this with `MARZPAY_SPEC.webhook` and, with
// the unbound scheme, falls back to documented server-side re-verification.
//
// When a scheme IS supplied (e.g. Property 7 passing an explicit scheme to
// exercise the round-trip/tamper cases), it computes the HMAC of the raw
// payload using `scheme.algorithm`, encodes per `scheme.encoding`, and compares
// against the provided signature using a constant-time comparison with an
// equal-length guard. It returns `false` for absent/empty/malformed/mismatched
// signature material and `true` only on an exact match (Requirements 3.6, 3.7).

/**
 * Verify a webhook signature against a scheme-parameterized HMAC of the raw
 * payload (pure; `node:crypto` only).
 *
 * @param scheme    The verified webhook signature scheme, or `undefined` when
 *                  the scheme is unbound (the current `MARZPAY_SPEC.webhook`
 *                  state). An `undefined` scheme always yields `false` — an
 *                  undocumented scheme has no verified positive path.
 * @param secretKey The shared signing secret used as the HMAC key.
 * @param rawBody   The exact raw request payload bytes (as received).
 * @param signature The signature material extracted from the request, or
 *                  `undefined`/empty when absent.
 * @returns `true` only when `scheme` is bound and the computed HMAC exactly
 *          matches `signature`; `false` for an unbound scheme or for
 *          absent/empty/malformed/mismatched signature material.
 */
export function verifyWebhookSignature(
  scheme: MarzPayWebhookScheme | undefined,
  secretKey: string,
  rawBody: string,
  signature: string | undefined,
): boolean {
  // Unbound scheme (current MARZPAY_SPEC state): cannot verify against an
  // undocumented scheme — there is no verified positive path via signature.
  if (scheme === undefined) {
    return false;
  }
  // Absent/empty signature material → negative result.
  if (typeof signature !== 'string' || signature.trim() === '') {
    return false;
  }
  // A missing/empty signing secret cannot authenticate anything → negative.
  if (typeof secretKey !== 'string' || secretKey === '') {
    return false;
  }
  // Raw body must be a string to compute a deterministic HMAC.
  if (typeof rawBody !== 'string') {
    return false;
  }

  // Compute the expected HMAC. A malformed scheme (unsupported algorithm or
  // encoding) throws inside node:crypto → treat as malformed → negative.
  let expected: string;
  try {
    expected = createHmac(scheme.algorithm, secretKey).update(rawBody, 'utf8').digest(scheme.encoding);
  } catch {
    return false;
  }

  // Constant-time comparison with an equal-length guard (timingSafeEqual throws
  // on unequal lengths, which also distinguishes malformed signature material).
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

// ---------------------------------------------------------------------------
// Result / data-model types (design.md → Data Models)
// ---------------------------------------------------------------------------
//
// Shapes refined from the verified `POST /collect-money` response (V2) and the
// verified transaction-detail / webhook-callback response (V3, identical). All
// fields are parsed defensively from untrusted JSON (no `any`).

/** Result of `initializePayment` (parsed from the V2 collection-create response). */
export interface PaymentInitResult {
  /** Client `reference` echoed by MarzPay (`data.transaction.reference`). */
  reference: string;
  /** Card-flow redirect (`data.redirect_url`); absent for mobile money. */
  redirectUrl?: string;
  /** Transaction status (`data.transaction.status`, e.g. `processing`/`pending`). */
  status: string;
}

/** Result of `verifyPayment` (parsed from the V3 transaction-detail response). */
export interface PaymentStatus {
  /** Transaction reference (`transaction.reference`). */
  reference: string;
  /** Verified status (`transaction.status`, e.g. `completed`/`failed`). */
  status: string;
}

/** A single transaction record (parsed from the V3 transaction object). */
export interface Transaction {
  /** Transaction uuid (`transaction.uuid`). */
  id: string;
  /** Client reference (`transaction.reference`). */
  reference: string;
  /** Raw numeric amount (`transaction.amount.raw`). */
  amount: number;
  /** ISO currency (`transaction.amount.currency`, e.g. `UGX`). */
  currency: string;
  /** Transaction status (`transaction.status`). */
  status: string;
}

/** Result of `listTransactions` (parsed from `data.transactions` + `data.pagination`). */
export interface TransactionList {
  /** Parsed transaction items. */
  items: Transaction[];
  /** Opaque pagination cursor (next-page URL) when MarzPay reports one. */
  cursor?: string;
}

/**
 * Result of `refund`. NOTE: MarzPay documents no refund endpoint
 * (Research_Artifact §L5); `refund` rejects with an unsupported-operation error
 * and never reaches a parse step while the seam is unbound. The shape is
 * declared so the operation is typed for the day MarzPay publishes a refund API.
 */
export interface RefundResult {
  /** Refund identifier. */
  id: string;
  /** Refund status. */
  status: string;
}

// ---------------------------------------------------------------------------
// Phone validation / normalization (Task 4.1)
// ---------------------------------------------------------------------------
//
// SINGLE source of truth for phone validation/normalization (Requirement 11.3).
// The `utils` namespace (Task 4.2) exposes `isValidPhoneNumber`/`formatPhoneNumber`
// by delegating to these helpers; no other phone-validation implementation may be
// introduced. Scope is Uganda/UGX MSISDNs (Research_Artifact V2 examples, R3).

/**
 * Normalize a value to the canonical Uganda MSISDN form `+2567XXXXXXXX`.
 *
 * Whitespace, dashes, and parentheses are stripped first, then the following
 * input shapes are accepted (all carrying the 9-digit national significant
 * number `7XXXXXXXX`):
 *  - `+2567XXXXXXXX` (E.164 with country code)
 *  - `2567XXXXXXXX`  (country code without `+`)
 *  - `07XXXXXXXX`    (national trunk prefix `0`)
 *  - `7XXXXXXXX`     (bare national significant number)
 *
 * @param value Untrusted input of unknown type.
 * @returns The canonical `+2567XXXXXXXX` string, or `null` when `value` is not a
 *          valid Uganda MSISDN (wrong type, wrong length, non-digit characters,
 *          or a national number not starting with `7`).
 */
function normalizeUgandaMsisdn(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\s\-()]/g, '');
  if (cleaned === '') return null;

  // Reduce each accepted shape to the 9-digit national significant number.
  let national: string;
  if (cleaned.startsWith('+256')) {
    national = cleaned.slice(4);
  } else if (cleaned.startsWith('256')) {
    national = cleaned.slice(3);
  } else if (cleaned.startsWith('0')) {
    national = cleaned.slice(1);
  } else {
    national = cleaned;
  }

  // The national significant number must be exactly 9 digits starting with `7`.
  if (!/^7\d{8}$/.test(national)) return null;

  return `+256${national}`;
}

/**
 * Return `true` when `value` is a valid Uganda MSISDN (i.e. it normalizes to the
 * canonical form), `false` otherwise. Delegates to {@link normalizeUgandaMsisdn}
 * so there is a single validation implementation (Requirement 11.3).
 */
export function isValidUgandaMsisdn(value: unknown): boolean {
  return normalizeUgandaMsisdn(value) !== null;
}

/**
 * Return the canonical Uganda MSISDN form (`+2567XXXXXXXX`) for `value`, or throw
 * a `PluginError` when `value` is not a valid phone number. Delegates to
 * {@link normalizeUgandaMsisdn} so validation is never duplicated (Requirement
 * 11.3); round-trip consistent with {@link isValidUgandaMsisdn} (Requirement 11.4).
 */
export function formatUgandaMsisdn(value: string): string {
  const normalized = normalizeUgandaMsisdn(value);
  if (normalized === null) {
    throw new PluginError('MarzPay utils.formatPhoneNumber: value is not a valid phone number');
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Transport seam (Task 7.1)
// ---------------------------------------------------------------------------
//
// All network I/O is funneled through a single injectable transport seam so the
// client's status/timeout logic is testable without real sockets (Properties
// 5 & 6 pass a mocked transport). The default transport uses `node:https`
// `request` ONLY (no third-party HTTP client — Requirement 4.3) and enforces the
// configurable timeout with `setTimeout` + `req.destroy()`.

/** The minimal response surface the client needs from a transport. */
export interface MarzPayTransportResponse {
  /** HTTP status code (0 when none was received). */
  status: number;
  /** Raw response body text. */
  body: string;
}

/**
 * A transport seam: given a fully-described request and a timeout budget,
 * resolve with the status + body, or reject on timeout/socket error. Injectable
 * for testability; defaults to {@link defaultMarzPayTransport}.
 */
export type MarzPayTransport = (
  req: MarzPayHttpRequest,
  timeoutMs: number,
) => Promise<MarzPayTransportResponse>;

/**
 * Default `node:https`-only transport. Wraps the request in a `timeoutMs` budget
 * using `setTimeout` + `req.destroy()`; on timeout or socket error it rejects
 * with a `PluginError` indicating timeout/unavailability and yields no partial
 * result (Requirement 3.11). Uses no third-party HTTP client (Requirement 4.3).
 */
export function defaultMarzPayTransport(
  req: MarzPayHttpRequest,
  timeoutMs: number,
): Promise<MarzPayTransportResponse> {
  const u = new URL(req.url);
  return new Promise<MarzPayTransportResponse>((resolve, reject) => {
    let settled = false;
    const r = httpsRequest(
      {
        method: req.method,
        hostname: u.hostname,
        ...(u.port !== '' ? { port: Number(u.port) } : {}),
        path: u.pathname + u.search,
        headers: req.headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          data += c;
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, body: data });
        });
      },
    );
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      r.destroy();
      reject(new PluginError(`MarzPay request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    r.on('error', (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PluginError(`MarzPay request failed (endpoint unreachable): ${e.message}`));
    });
    if (req.body !== '') {
      r.write(req.body);
    }
    r.end();
  });
}

// ---------------------------------------------------------------------------
// Defensive JSON parsing helpers (untrusted responses; no `any`)
// ---------------------------------------------------------------------------

/** Parse a response body as JSON, raising a `PluginError` on malformed JSON. */
function parseJsonBody(body: string, operation: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new PluginError(`MarzPay ${operation}: response body was not valid JSON`);
  }
}

/** Narrow an unknown value to a plain record (empty record when not an object). */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Narrow an unknown value to a string, or `undefined`. */
function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Narrow an unknown value to a finite number, or `undefined`. */
function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse one transaction object into the {@link Transaction} model. Handles both
 * the nested `amount{raw,currency}` shape (V2/V3) and a flat numeric `amount`.
 */
function parseTransactionRecord(value: unknown): Transaction {
  const t = asRecord(value);
  const amountObj = asRecord(t['amount']);
  return {
    id: asOptionalString(t['uuid']) ?? asOptionalString(t['id']) ?? '',
    reference: asOptionalString(t['reference']) ?? '',
    amount: asOptionalNumber(amountObj['raw']) ?? asOptionalNumber(t['amount']) ?? 0,
    currency: asOptionalString(amountObj['currency']) ?? asOptionalString(t['currency']) ?? '',
    status: asOptionalString(t['status']) ?? '',
  };
}

// ---------------------------------------------------------------------------
// MarzPayClient (Task 7.1)
// ---------------------------------------------------------------------------

/**
 * Dependency-free MarzPay client over `node:https`.
 *
 * Request construction is delegated to the pure builders/guards above; only the
 * injected transport touches the network. Every operation:
 *  - raises a `PluginError` INCLUDING the HTTP status on a non-2xx response and
 *    returns no partial result (Requirement 3.8);
 *  - raises a timeout/unavailability `PluginError` on timeout or socket error
 *    and returns no partial result (Requirement 3.11).
 *
 * `refund` is unsupported (Research_Artifact §L5): `buildRefundRequest` throws
 * before any network call while `MARZPAY_SPEC.paths.refund` is unbound, so the
 * operation rejects without sending. `validateWebhook` delegates to
 * `verifyWebhookSignature(spec.webhook, …)`; with `spec.webhook` unbound (§L4)
 * it returns `false` for absent/empty/malformed material — the documented
 * server-side re-verification path is composed by the scaffolded
 * `WebhookController` (later task), not here.
 */
export class MarzPayClient {
  private readonly config: MarzPayPluginConfig;
  private readonly spec: MarzPaySpec;
  private readonly transport: MarzPayTransport;
  private readonly timeoutMs: number;

  constructor(
    config: MarzPayPluginConfig,
    spec: MarzPaySpec = MARZPAY_SPEC,
    transport: MarzPayTransport = defaultMarzPayTransport,
  ) {
    this.config = config;
    this.spec = spec;
    this.transport = transport;
    this.timeoutMs =
      typeof config.timeoutMs === 'number' && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
        ? config.timeoutMs
        : DEFAULT_TIMEOUT_MS;
  }

  /** Send a request through the injected transport with the configured timeout. */
  private send(req: MarzPayHttpRequest): Promise<MarzPayTransportResponse> {
    return this.transport(req, this.timeoutMs);
  }

  /**
   * Raise a `PluginError` that INCLUDES the returned HTTP status for any
   * non-2xx response, ensuring no partial result is returned (Requirement 3.8).
   */
  private ensureSuccessStatus(status: number, operation: string): void {
    if (status < 200 || status >= 300) {
      throw new PluginError(`MarzPay ${operation}: request returned non-success HTTP status ${status}`);
    }
  }

  /**
   * Initialize a payment via the verified `POST /collect-money` endpoint (V2).
   * Required-field validation happens in `buildInitializePaymentRequest` before
   * anything is sent (Requirements 3.1, 3.9).
   */
  async initializePayment(req: PaymentRequest): Promise<PaymentInitResult> {
    const built = buildInitializePaymentRequest(this.config, this.spec, req);
    const { status, body } = await this.send(built);
    this.ensureSuccessStatus(status, 'initializePayment');
    const root = asRecord(parseJsonBody(body, 'initializePayment'));
    const data = asRecord(root['data']);
    const txn = asRecord(data['transaction']);
    const reference = asOptionalString(txn['reference']) ?? '';
    const txnStatus = asOptionalString(txn['status']) ?? asOptionalString(root['status']) ?? '';
    const redirectUrl = asOptionalString(data['redirect_url']);
    return {
      reference,
      status: txnStatus,
      ...(redirectUrl !== undefined ? { redirectUrl } : {}),
    };
  }

  /**
   * Verify a payment via the verified `GET /transactions/{reference}` endpoint
   * (V3). Argument trimming/length validation happens in
   * `buildVerifyPaymentRequest` before sending (Requirements 3.2, 3.10).
   */
  async verifyPayment(reference: string): Promise<PaymentStatus> {
    const built = buildVerifyPaymentRequest(this.config, this.spec, reference);
    const { status, body } = await this.send(built);
    this.ensureSuccessStatus(status, 'verifyPayment');
    const root = asRecord(parseJsonBody(body, 'verifyPayment'));
    const txn = asRecord(root['transaction']);
    return {
      reference: asOptionalString(txn['reference']) ?? '',
      status: asOptionalString(txn['status']) ?? '',
    };
  }

  /**
   * Fetch a transaction via the verified `GET /transactions/{id}` endpoint (V3).
   * Argument validation happens in `buildGetTransactionRequest` before sending
   * (Requirements 3.3, 3.10).
   */
  async getTransaction(id: string): Promise<Transaction> {
    const built = buildGetTransactionRequest(this.config, this.spec, id);
    const { status, body } = await this.send(built);
    this.ensureSuccessStatus(status, 'getTransaction');
    const root = asRecord(parseJsonBody(body, 'getTransaction'));
    return parseTransactionRecord(root['transaction']);
  }

  /**
   * List transactions via the verified `GET /transactions` endpoint (V3).
   * Parses `data.transactions` into {@link Transaction} items and surfaces a
   * pagination cursor when MarzPay reports one (Requirement 3.4).
   */
  async listTransactions(query?: ListTransactionsQuery): Promise<TransactionList> {
    const built = buildListTransactionsRequest(this.config, this.spec, query);
    const { status, body } = await this.send(built);
    this.ensureSuccessStatus(status, 'listTransactions');
    const root = asRecord(parseJsonBody(body, 'listTransactions'));
    const data = asRecord(root['data']);
    const rawItems = Array.isArray(data['transactions']) ? data['transactions'] : [];
    const items = rawItems.map((item) => parseTransactionRecord(item));
    const pagination = asRecord(data['pagination']);
    const cursor = asOptionalString(pagination['next_page_url']);
    return {
      items,
      ...(cursor !== undefined ? { cursor } : {}),
    };
  }

  /**
   * Refund a transaction — UNSUPPORTED.
   *
   * MarzPay documents no refund endpoint (Research_Artifact §L5), so
   * `MARZPAY_SPEC.paths.refund` is unbound and `buildRefundRequest` throws a
   * clear "refunds not supported" `PluginError` BEFORE any network call. The
   * operation is kept on the client so the interface is complete; it simply
   * rejects. The send/parse below is retained for the day MarzPay publishes a
   * refund API and the seam becomes bound (it is unreachable until then).
   */
  async refund(req: RefundRequest): Promise<RefundResult> {
    const built = buildRefundRequest(this.config, this.spec, req);
    const { status, body } = await this.send(built);
    this.ensureSuccessStatus(status, 'refund');
    const root = asRecord(parseJsonBody(body, 'refund'));
    return {
      id: asOptionalString(root['id']) ?? '',
      status: asOptionalString(root['status']) ?? '',
    };
  }

  /**
   * Validate an inbound webhook's signature against the verified scheme.
   *
   * Delegates to `verifyWebhookSignature(spec.webhook, secretKey, rawBody,
   * signature)`. With `spec.webhook` unbound (§L4) it returns `false` for
   * absent/empty/malformed signature material; the documented server-side
   * re-verification trust path is composed by the scaffolded `WebhookController`
   * (later task), not here (Requirements 3.6, 3.7).
   */
  validateWebhook(rawBody: string, signature: string | undefined): boolean {
    return verifyWebhookSignature(this.spec.webhook, this.config.secretKey, rawBody, signature);
  }
}

// ---------------------------------------------------------------------------
// Plugin lifecycle (Task 8.1)
// ---------------------------------------------------------------------------
//
// Mirrors @streetjs/plugin-paypal's `PayPalPlugin` lifecycle EXACTLY: the class
// stores the raw config; `onInstall()` validates it (throwing a `PluginError`
// BEFORE any registration, so a bad config never yields an injected client);
// `onLoad(app)` constructs exactly ONE `MarzPayClient` and registers a single
// middleware that assigns the client to `ctx.state[stateKey]`. In addition,
// `onUnload(app)` releases the client reference. The plugin is consumed through
// the `MarzPayPlugin(config)` factory wrapper (`app.use(MarzPayPlugin({...}))`),
// matching the documented MarzPay convention (Requirements 2.2, 2.3, 2.4, 2.5,
// 2.7, 2.8).

/**
 * The MarzPay plugin module.
 *
 * Stores the raw (unvalidated) config until `onInstall()`; on install it runs
 * `validateMarzPayConfig`, which throws a `PluginError` naming the offending
 * field on bad input BEFORE any middleware registration — so an invalid config
 * never injects a `MarzPayClient` (Requirements 2.3, 2.4, 2.7). `onLoad(app)`
 * constructs exactly one `MarzPayClient` from the validated config and
 * `MARZPAY_SPEC`, then registers a single middleware assigning that client to
 * `ctx.state[validatedConfig.stateKey]` (Requirements 2.2, 2.5, 2.8).
 * `onUnload(app)` releases the client reference.
 *
 * Most consumers use the {@link MarzPayPlugin} factory instead of constructing
 * this class directly.
 */
export class MarzPayPluginModule extends PluginModule {
  readonly name = MARZPAY_PLUGIN_NAME;
  readonly version = MARZPAY_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: MarzPayPluginConfig | null = null;
  private client: MarzPayClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    // Validate BEFORE registration: a thrown PluginError here means the plugin
    // never reaches onLoad, so no client is ever injected on bad config.
    this.config = validateMarzPayConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    // Construct exactly ONE MarzPayClient bound to the verified MARZPAY_SPEC.
    this.client = new MarzPayClient(cfg, MARZPAY_SPEC);
    const stateKey = cfg.stateKey ?? DEFAULT_STATE_KEY;
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  override async onUnload(_app: SandboxedApp): Promise<void> {
    // Release the client reference held by the plugin instance.
    this.client = null;
  }

  /** The injected MarzPay client. Throws if accessed before the plugin loads. */
  get payments(): MarzPayClient {
    if (!this.client) throw new PluginError('MarzPay plugin is not loaded');
    return this.client;
  }

  private _config(): MarzPayPluginConfig {
    if (!this.config) this.config = validateMarzPayConfig(this.raw);
    return this.config;
  }
}

/**
 * Factory wrapper for the MarzPay plugin, usable as
 * `app.use(MarzPayPlugin({ apiKey, secretKey }))` per the documented MarzPay
 * convention. Returns a fresh {@link MarzPayPluginModule}; validation is
 * deferred to `onInstall()` so a bad config raises during installation (naming
 * the offending field) without injecting a client (Requirements 2.2, 2.3, 2.4,
 * 2.7).
 */
export function MarzPayPlugin(config: unknown): MarzPayPluginModule {
  return new MarzPayPluginModule(config);
}
