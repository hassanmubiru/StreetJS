// src/platform/plugins/local-registry.ts
// A local, dependency-free plugin registry. Stores signed manifests + their
// publisher public key + metadata, verifies signatures on publish and on
// demand, supports discovery (list/search), and integrates with PluginHost so
// a signed plugin can be published and installed through the registry. No
// network, no external services — purely in-process (with JSON (de)serialization
// for persistence by the caller).

import { createPublicKey, type KeyObject } from 'node:crypto';
import {
  verifyManifest, PluginError, PluginSignatureError, PluginStateError, PluginManifestError,
  type PluginManifest, type PluginHost, type PluginPermission,
} from './host.js';
import type { PluginModule } from './sdk.js';

/** A stored registry record: the signed manifest, publisher key, and metadata. */
export interface RegistryRecord {
  manifest: PluginManifest;  // includes checksum + signature
  /** Publisher public key (PEM, SPKI) used to verify the manifest signature. */
  publicKey: string;
  metadata: Record<string, unknown>;
  publishedAt: string;
}

function idOf(name: string, version: string): string {
  return `${name}@${version}`;
}

/**
 * In-process signed plugin registry. Every published plugin must carry a valid
 * Ed25519-signed manifest; the signature is verified against the publisher's
 * public key at publish time and re-checked on `verify()`/`fetch()`.
 */
export class LocalPluginRegistry {
  private readonly store = new Map<string, RegistryRecord>();

  /**
   * Publish a signed plugin. Verifies manifest integrity (checksum) and
   * authenticity (Ed25519 signature) against `publicKeyPem`. Rejects unsigned,
   * tampered, or wrong-key manifests, and duplicate name@version.
   */
  publish(manifest: PluginManifest, publicKeyPem: string, metadata: Record<string, unknown> = {}): RegistryRecord {
    if (!manifest.signature || !manifest.checksum) {
      throw new PluginError('Cannot publish: manifest is not signed (missing checksum/signature)');
    }
    let key: KeyObject;
    try {
      key = createPublicKey(publicKeyPem);
    } catch {
      throw new PluginError('Cannot publish: invalid public key (not a valid PEM/SPKI key)');
    }
    if (!verifyManifest(manifest, key)) {
      throw new PluginSignatureError(`Cannot publish "${manifest.name}@${manifest.version}": signature verification failed`);
    }
    const id = idOf(manifest.name, manifest.version);
    if (this.store.has(id)) {
      throw new PluginStateError(`Plugin "${id}" is already published`);
    }
    const record: RegistryRecord = {
      manifest, publicKey: publicKeyPem, metadata, publishedAt: new Date().toISOString(),
    };
    this.store.set(id, record);
    return record;
  }

  /** Fetch a published record, re-verifying its signature. Throws if missing or invalid. */
  fetch(name: string, version: string): RegistryRecord {
    const rec = this.store.get(idOf(name, version));
    if (!rec) throw new PluginError(`Plugin "${idOf(name, version)}" not found in registry`);
    if (!this._verifyRecord(rec)) {
      throw new PluginSignatureError(`Stored plugin "${idOf(name, version)}" failed signature re-verification`);
    }
    return rec;
  }

  /** All published plugin ids (name@version). */
  list(): string[] {
    return [...this.store.keys()];
  }

  /** Published records exposing a given capability tag. */
  search(capability: string): RegistryRecord[] {
    return [...this.store.values()].filter((r) => (r.manifest.capabilities ?? []).includes(capability));
  }

  /** Re-verify a stored plugin's signature against its stored public key. */
  verify(name: string, version: string): boolean {
    const rec = this.store.get(idOf(name, version));
    if (!rec) return false;
    return this._verifyRecord(rec);
  }

  private _verifyRecord(rec: RegistryRecord): boolean {
    try {
      return verifyManifest(rec.manifest, createPublicKey(rec.publicKey));
    } catch {
      return false;
    }
  }

  /** Serialize the registry (for persistence by the caller). */
  toJSON(): RegistryRecord[] {
    return [...this.store.values()];
  }

  /** Rehydrate a registry from serialized records, re-verifying each signature. */
  static fromJSON(records: RegistryRecord[]): LocalPluginRegistry {
    const reg = new LocalPluginRegistry();
    for (const r of records) {
      if (!reg._verifyRecord(r)) {
        throw new PluginSignatureError(`Refusing to load tampered registry record "${idOf(r.manifest.name, r.manifest.version)}"`);
      }
      reg.store.set(idOf(r.manifest.name, r.manifest.version), r);
    }
    return reg;
  }
}

/**
 * Install a plugin through the registry into a {@link PluginHost}: fetch the
 * signed manifest (re-verified), register the supplied plugin instance against
 * it, and (by default) enable it. The plugin's identity must match the
 * registered manifest. Returns the registry record.
 */
export async function installFromRegistry(
  registry: LocalPluginRegistry,
  host: PluginHost,
  plugin: PluginModule,
  opts: { enable?: boolean } = {},
): Promise<RegistryRecord> {
  const rec = registry.fetch(plugin.name, plugin.version); // throws on missing / bad signature
  host.register(plugin, rec.manifest);
  if (opts.enable !== false) await host.enable(plugin.name);
  return rec;
}

const KNOWN_PERMISSIONS: readonly PluginPermission[] = ['middleware', 'events', 'net', 'fs', 'db', 'secrets'];

/**
 * Validate that a plugin manifest is structurally well-formed for installation.
 * Throws {@link PluginManifestError} with a message identifying the offending
 * field when the manifest is missing or malformed (Req 5.8).
 */
export function assertWellFormedManifest(manifest: PluginManifest | null | undefined): void {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object') {
    throw new PluginManifestError('Plugin manifest is missing');
  }
  const m = manifest as Partial<PluginManifest>;
  if (typeof m.name !== 'string' || m.name.trim() === '') {
    throw new PluginManifestError('Plugin manifest is malformed: "name" is required and must be a non-empty string');
  }
  if (typeof m.version !== 'string' || m.version.trim() === '') {
    throw new PluginManifestError(`Plugin manifest for "${m.name}" is malformed: "version" is required and must be a non-empty string`);
  }
  if (m.capabilities !== undefined
    && (!Array.isArray(m.capabilities) || m.capabilities.some((c) => typeof c !== 'string'))) {
    throw new PluginManifestError(`Plugin manifest for "${m.name}" is malformed: "capabilities" must be an array of strings`);
  }
  if (m.permissions !== undefined
    && (!Array.isArray(m.permissions) || m.permissions.some((p) => !KNOWN_PERMISSIONS.includes(p as PluginPermission)))) {
    throw new PluginManifestError(`Plugin manifest for "${m.name}" is malformed: "permissions" must be an array of known permissions`);
  }
  if (m.dependencies !== undefined
    && (typeof m.dependencies !== 'object' || m.dependencies === null || Array.isArray(m.dependencies))) {
    throw new PluginManifestError(`Plugin manifest for "${m.name}" is malformed: "dependencies" must be an object mapping plugin names to version ranges`);
  }
}

/** Options for {@link installThroughRegistry}. */
export interface InstallThroughRegistryOptions {
  /** Enable the plugin after registering it (default true). */
  enable?: boolean;
  /** Maximum wall-clock install budget in milliseconds (default 60_000 — Req 5.6). */
  timeoutMs?: number;
}

/** Result of {@link installThroughRegistry}. */
export interface InstallThroughRegistryResult {
  /** The fetched registry record. */
  record: RegistryRecord;
  /** Wall-clock install duration in milliseconds. */
  durationMs: number;
}

/**
 * Install an official plugin THROUGH the registry with signature verification
 * ENFORCED by the {@link PluginHost} (Req 5.6 / 5.7 / 5.8).
 *
 * The supplied host MUST be configured with a trusted public key so that
 * `register()` enforces signature verification. The flow is:
 *
 *   1. Reject up front if the host does not enforce signatures.
 *   2. Fetch the signed record from the registry (re-verifies the publisher
 *      signature; throws on a missing entry or a tampered stored signature).
 *   3. Reject a missing or malformed manifest with an identifying
 *      {@link PluginManifestError} (Req 5.8).
 *   4. `register()` through the host, which verifies the manifest signature
 *      against the host's trusted key. On a bad signature the host throws
 *      {@link PluginSignatureError} BEFORE recording the plugin, so the
 *      installed set is left unchanged and the plugin is never registered
 *      (Req 5.7).
 *   5. Enable the plugin (unless `enable: false`).
 *
 * A valid signed plugin installs within the time budget and registers (Req 5.6).
 */
export async function installThroughRegistry(
  registry: LocalPluginRegistry,
  host: PluginHost,
  plugin: PluginModule,
  opts: InstallThroughRegistryOptions = {},
): Promise<InstallThroughRegistryResult> {
  if (!host.verifiesSignatures()) {
    throw new PluginError(
      'Refusing to install through the registry: the PluginHost must be configured with a trusted public key to enforce signature verification',
    );
  }
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const start = Date.now();

  // Fetch the signed record (re-verifies the publisher signature; throws
  // PluginError when missing, PluginSignatureError on a bad stored signature).
  const rec = registry.fetch(plugin.name, plugin.version);

  // Reject a missing/malformed manifest with an identifying error (Req 5.8).
  assertWellFormedManifest(rec.manifest);

  // Register through the host, which ENFORCES signature verification against
  // its trusted public key. A bad signature throws PluginSignatureError before
  // the entry is recorded, leaving the installed set unchanged (Req 5.7).
  host.register(plugin, rec.manifest);
  if (opts.enable !== false) await host.enable(plugin.name);

  const durationMs = Date.now() - start;
  if (durationMs > timeoutMs) {
    throw new PluginError(
      `Plugin "${plugin.name}@${plugin.version}" install exceeded the ${timeoutMs}ms budget (took ${durationMs}ms)`,
    );
  }
  return { record: rec, durationMs };
}
