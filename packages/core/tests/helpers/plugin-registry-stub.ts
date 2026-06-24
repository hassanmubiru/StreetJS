// packages/core/tests/helpers/plugin-registry-stub.ts
// TEST-ONLY helper (excluded from the published `dist` via tsconfig.lib.json).
//
// Signing helpers + a controllable fake for the installer's network layer used
// by the plugin-installer-hardening test suite (PS-2). It reuses host.ts's
// `signManifest` so the signed body matches host.ts's `canonicalManifest`
// exactly (strengths S1, S2), and records whether the download/extract stages
// were reached so a test can assert that an aborted install performed no
// network/filesystem side effects.
//
// Built only on node:crypto/node:fs/node:os/node:path + host.ts — no new
// runtime dependency.

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { signManifest, type PluginManifest } from '../../src/platform/plugins/host.js';

// ── Signing helpers ──────────────────────────────────────────────────────────

/** An Ed25519 keypair as node:crypto KeyObjects. */
export interface Keypair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

/** Generate a fresh Ed25519 keypair (`node:crypto.generateKeyPairSync`). */
export function generateKeypair(): Keypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey };
}

/** Export an Ed25519 public key as an SPKI PEM string (installer option shape). */
export function exportPublicKeyPem(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString();
}

/** The installer manifest shape: the host manifest plus the transport URL. */
export interface InstallerManifest extends PluginManifest {
  tarballUrl: string;
}

/**
 * Sign an installer manifest by reusing host.ts's `signManifest` to set the
 * canonical `checksum` + Ed25519 `signature`, then attaching `tarballUrl`.
 *
 * Because `tarballUrl` is added AFTER signing, the signed body remains exactly
 * host.ts's `canonicalManifest` (name/version/capabilities/permissions/
 * dependencies) — `tarballUrl`/`checksum`/`signature` are outside the signed
 * body, preserving strengths S1 and S2.
 */
export function signInstallerManifest(
  body: PluginManifest,
  privateKey: KeyObject,
  tarballUrl = 'https://registry.streetjs.dev/tarball.tgz',
): InstallerManifest {
  const signed = signManifest(body, privateKey);
  return { ...signed, tarballUrl };
}

// ── Registry stub (fake network layer + spies) ───────────────────────────────

export interface RegistryStubOptions {
  /** Registry base URL handed to the installer (scheme is configurable). */
  registryUrl?: string;
  /** Tarball URL advertised in the manifest (scheme is configurable). */
  tarballUrl?: string;
  /** Manifest object (JSON-stringified) OR a raw body string for malformed cases. */
  manifest?: unknown;
  /** Raw manifest body override (takes precedence over `manifest`). */
  manifestBody?: string;
  /** Tarball bytes returned by the download stage. */
  tarball?: Buffer;
}

/**
 * A controllable fake for the installer's network layer. Holds the manifest
 * body, tarball bytes, and URLs, and records whether the manifest fetch,
 * tarball download, and extract stages were reached — so tests can assert that
 * an aborted install never downloaded or extracted anything.
 */
export class RegistryStub {
  registryUrl: string;
  tarballUrl: string;
  manifestBody: string;
  tarball: Buffer;

  // Spies.
  fetchTextCount = 0;
  downloadCount = 0;
  extractCount = 0;
  lastFetchUrl: string | undefined;
  lastDownloadUrl: string | undefined;

  constructor(opts: RegistryStubOptions = {}) {
    this.registryUrl = opts.registryUrl ?? 'https://registry.streetjs.dev';
    this.tarballUrl = opts.tarballUrl ?? 'https://registry.streetjs.dev/tarball.tgz';
    this.tarball = opts.tarball ?? Buffer.alloc(0);
    if (opts.manifestBody !== undefined) {
      this.manifestBody = opts.manifestBody;
    } else if (typeof opts.manifest === 'string') {
      this.manifestBody = opts.manifest;
    } else {
      this.manifestBody = JSON.stringify(opts.manifest ?? {});
    }
  }

  /** True once the tarball download stage was reached (should be false on abort). */
  get downloadReached(): boolean {
    return this.downloadCount > 0;
  }

  /** True once the extract stage was reached (should be false on abort). */
  get extractReached(): boolean {
    return this.extractCount > 0;
  }

  /**
   * Wire this stub into a `PluginInstaller` by overriding its private network
   * (`_fetchText`, `_downloadBuffer`) and `_extractTarball` methods so the
   * install flow runs entirely offline while the spies record which stages were
   * reached. The real `_extractTarball` (if present) still runs so PS-1
   * containment behavior is exercised.
   */
  attachTo<T extends object>(installer: T): T {
    const inst = installer as unknown as Record<string, unknown>;

    inst._fetchText = async (url: string): Promise<string> => {
      this.fetchTextCount += 1;
      this.lastFetchUrl = url;
      return this.manifestBody;
    };

    inst._downloadBuffer = async (url: string): Promise<Buffer> => {
      this.downloadCount += 1;
      this.lastDownloadUrl = url;
      return this.tarball;
    };

    const originalExtract = inst._extractTarball;
    if (typeof originalExtract === 'function') {
      const extractFn = originalExtract as (buf: Buffer, destDir: string) => Promise<void>;
      inst._extractTarball = async (buf: Buffer, destDir: string): Promise<void> => {
        this.extractCount += 1;
        return extractFn.call(installer, buf, destDir);
      };
    }

    return installer;
  }
}

// ── Temp-dir + filesystem assertion helpers ──────────────────────────────────

/** Create a fresh temp directory under `os.tmpdir()` for an extraction root. */
export async function makeTempDir(prefix = 'streetjs-plugin-test-'): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), prefix));
}

/** Recursively remove a temp directory (idempotent). */
export async function removeTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/** Create a temp dir and return it alongside a cleanup function. */
export async function withTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await makeTempDir();
  return { dir, cleanup: () => removeTempDir(dir) };
}

/**
 * Resolve `p` against the filesystem and report whether it both lies OUTSIDE
 * `root` (the extraction containment root) and actually exists on disk — i.e.
 * whether a traversal artifact escaped the extraction root.
 */
export async function pathExistsOutside(root: string, p: string): Promise<boolean> {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(p);
  const isInside = resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
  if (isInside) return false;
  try {
    await fs.access(resolved);
    return true;
  } catch {
    return false;
  }
}
