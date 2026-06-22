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

import type { PluginManifest } from 'streetjs';

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
