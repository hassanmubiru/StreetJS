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

import { PluginError, type PluginManifest } from 'streetjs';

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
