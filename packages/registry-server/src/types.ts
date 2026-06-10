// @streetjs/registry-server — public type surface for the Network Plugin Registry.
//
// All wire types for the REST API (Req 4.1). The signing/manifest primitives are
// re-used from `streetjs` (core): `PluginManifest`, `verifyManifest`,
// `manifestChecksum`, `signManifest`. Pagination bounds come from core's
// `normalizePageSize` (default 25 / max 100 / min 1, Req 4.6).

import type { PluginManifest } from 'streetjs';

/** A stable, machine-readable error code for every rejection path (Req 4.4/4.9/4.10). */
export type RegistryErrorCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'INVALID_MANIFEST'
  | 'DUPLICATE'
  | 'INTEGRITY_FAILED'
  | 'NOT_FOUND';

/** Error indication returned by every endpoint that rejects a request. */
export interface RegistryError {
  code: RegistryErrorCode;
  message: string;
  /** The offending metadata field, when the rejection is field-specific (Req 4.10). */
  field?: string;
}

/**
 * A publish request: the manifest (already signed with `signManifest`), the
 * Ed25519 public key (PEM) used to verify the signature, and the plugin tarball
 * as base64. The signature + checksum live inside the manifest (Req 4.2).
 */
export interface PublishRequest {
  manifest: PluginManifest;
  publicKeyPem: string;
  tarballBase64: string;
}

/** Successful publish acknowledgement. */
export interface PublishResponse {
  name: string;
  version: string;
  /** SHA-256 hex of the stored tarball bytes (integrity anchor). */
  tarballChecksum: string;
  publishedAt: string;
}

/**
 * Download payload: the package plus its recorded Ed25519 signature so the
 * consumer can perform its own integrity validation before installing (Req 4.3).
 */
export interface PackageWithSignature {
  name: string;
  version: string;
  manifest: PluginManifest;
  publicKeyPem: string;
  tarballBase64: string;
  /** Base64 Ed25519 signature recorded at publish time. */
  signature: string;
  tarballChecksum: string;
}

/** On-demand integrity/signature re-check result (Req 4.1). */
export interface VerifyResponse {
  name: string;
  version: string;
  /** Manifest checksum + Ed25519 signature verify against the stored public key. */
  manifestValid: boolean;
  /** Stored tarball bytes still hash to the recorded checksum. */
  tarballValid: boolean;
  /** True only when both manifest and tarball validate. */
  valid: boolean;
}

/** A condensed plugin record returned by search/list (Req 4.1/4.6). */
export interface PluginSummary {
  name: string;
  /** The latest (highest semver) published version. */
  latestVersion: string;
  description?: string;
  categories: string[];
  tags: string[];
  versions: string[];
}

/** A single published version's metadata (version history, Req 4.6). */
export interface PluginVersion {
  name: string;
  version: string;
  capabilities: string[];
  dependencies: Record<string, string>;
  tarballChecksum: string;
  publishedAt: string;
}

/** Pagination + filters for `GET /api/v1/plugins/search`. */
export interface SearchQuery {
  q?: string;
  category?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
}

/** Pagination for `GET /api/v1/plugins`. */
export interface ListQuery {
  page?: number;
  pageSize?: number;
}

/** A page of results with its bounds echoed back (Req 4.6). */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * A publisher identity. Authentication is by bearer token (the raw API key is
 * never stored — only its SHA-256 hash, Req 4.9). Authorization is by owned
 * namespace: a publisher may only publish plugins whose namespace it owns.
 */
export interface Publisher {
  id: string;
  /** SHA-256 hex of the bearer API key presented at publish time. */
  apiKeyHash: string;
  /** Namespaces this publisher is allowed to publish under. */
  namespaces: string[];
}
