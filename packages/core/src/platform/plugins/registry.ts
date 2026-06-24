// src/platform/plugins/registry.ts
// Plugin installer: fetches, verifies (Ed25519 + SHA-256), and extracts plugins.

import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import { Writable } from 'node:stream';
import { z } from 'zod';

import { officialPluginPublicKey } from './official-key.js';
import { pluginManifestSchema, manifestChecksum, verifyManifest } from './host.js';

export interface PluginInstallerOptions {
  registryUrl?: string;
  pluginsDir: string;
  /** Trusted Ed25519 public key (PEM/SPKI) for manifest verification. */
  publicKey?: string;
  /**
   * Explicit, logged escape hatch. When true, signature verification is skipped
   * (dev/unsigned mode). https pinning, schema validation, and PS-1 containment
   * are STILL enforced. Default false.
   */
  allowUnsigned?: boolean;
}

/**
 * Installer manifest schema. Reuses the host `pluginManifestSchema` for the
 * signed body (name/version/capabilities/permissions/dependencies +
 * checksum/signature) and extends it with the registry-transport `tarballUrl`.
 *
 * `tarballUrl`, `checksum`, and `signature` are outside the signed canonical
 * body (see host.ts `canonicalManifest`), so `manifestChecksum`/`verifyManifest`
 * ignore `tarballUrl` and signature semantics are unchanged (strengths S1, S2).
 */
const installerManifestSchema = pluginManifestSchema.extend({
  tarballUrl: z.string().min(1),
});
type InstallerManifest = z.infer<typeof installerManifestSchema>;

/**
 * Returns the safe absolute destination for `entryName` under `destDir`, or
 * `null` if the entry escapes containment. Pure — only `node:path`, no I/O.
 *
 * PS-1 path-containment guard. Strips a single leading "./" and "/"
 * (preserving in-containment normalization, Req 3.2), rejects absolute paths
 * and any ".." path segment, and finally requires that the resolved path is
 * the extraction root itself or a descendant of it (Req 2.1, 2.2, 2.4).
 *
 * Exported as a pure, side-effect-free helper so it can be unit-tested
 * directly (task 4.3); it remains an internal implementation detail of the
 * extractor and is not part of the published public surface.
 */
export function resolveContained(destDir: string, entryName: string): string | null {
  // Strip the existing leading "./" and "/" normalization (preserve Req 3.2).
  const sanitized = entryName.replace(/^\.\//, '').replace(/^\//, '');
  // Reject obvious traversal/absolute forms early.
  if (path.isAbsolute(sanitized)) return null;
  if (sanitized.split(/[\\/]/).includes('..')) return null;

  const destRoot = path.resolve(destDir);
  const resolved = path.resolve(destDir, sanitized);
  if (resolved === destRoot || resolved.startsWith(destRoot + path.sep)) {
    return resolved;
  }
  return null;
}

export class PluginInstaller {
  private readonly registryUrl: string;
  private readonly pluginsDir: string;
  private readonly allowUnsigned: boolean;
  /**
   * The resolved trust anchor. Defaults to the pinned official key unless the
   * caller supplies their own `publicKey` or explicitly opts into `allowUnsigned`
   * (in which case it is left undefined and signature verification is skipped).
   */
  private readonly trustedKey: KeyObject | undefined;

  constructor(opts: PluginInstallerOptions) {
    this.registryUrl = opts.registryUrl ?? 'https://registry.streetjs.dev';
    this.pluginsDir = opts.pluginsDir;
    // Default the trusted key to the pinned official key unless the caller
    // explicitly opted into unsigned mode (Req 2.5 / 3.6).
    this.allowUnsigned = opts.allowUnsigned === true;
    this.trustedKey = opts.publicKey
      ? createPublicKey(opts.publicKey)
      : (this.allowUnsigned ? undefined : officialPluginPublicKey());
    if (this.allowUnsigned) {
      // Visible, logged escape hatch (Req 2.5 / 3.6).
      console.warn(
        '[PluginInstaller] allowUnsigned=true: signature verification is DISABLED. ' +
        'https pinning, manifest schema validation, and path containment remain enforced.'
      );
    }
  }

  /**
   * Installs a plugin by name and version. Secure-by-default and front-loaded:
   * every authenticity/integrity/transport precondition is checked and the
   * install aborts (throws) BEFORE any tarball is downloaded or extracted
   * (Property 2 / Req 2.5–2.9). Ordering follows the design pseudocode (a)–(h):
   *
   *   (a) pin https on the registry transport            (Req 2.8)
   *   (b) fetch the manifest
   *   (c) schema-validate the manifest + require a signature (Req 2.7)
   *   (d) pin https on the tarball transport             (Req 2.8)
   *   (e) verify the Ed25519 signature over the *recomputed* canonical checksum
   *       against the trusted key (unless allowUnsigned); the signed checksum is
   *       the integrity root for the tarball (Req 2.5, 2.6 — strength S2)
   *   (f) download the tarball (only after all gates pass)
   *   (g) bind the tarball SHA-256 to the signed checksum (Req 2.6)
   *   (h) mkdir + extract under PS-1 containment          (Req 2.1–2.4)
   */
  async install(name: string, version: string): Promise<void> {
    // (a) Reject non-https registry transport before any network fetch.
    this.assertHttps(this.registryUrl);

    // (b)+(c) Fetch + schema-validate the manifest (also requires a signature).
    const manifest = await this._fetchManifest(name, version);

    // (d) Reject non-https tarball transport before any download.
    this.assertHttps(manifest.tarballUrl);

    // (e) Verify the signature over the recomputed canonical checksum (S2).
    //     In allowUnsigned mode there is no trust anchor and this is skipped.
    let signedChecksum: string | undefined;
    if (!this.allowUnsigned) {
      if (!this.trustedKey) {
        throw new Error(
          `No trusted public key configured for ${name}@${version}; ` +
          `refusing to install. Set allowUnsigned to override.`
        );
      }
      if (!verifyManifest(manifest, this.trustedKey)) {
        throw new Error(
          `Invalid marketplace signature for ${name}@${version}. ` +
          `Plugin installation aborted.`
        );
      }
      // The signed integrity root is the RECOMPUTED canonical checksum, never
      // the attacker-supplied `manifest.checksum`.
      signedChecksum = manifestChecksum(manifest);
    }

    // (f) Only now do we touch the network for tarball bytes.
    const tarballBuffer = await this._downloadBuffer(manifest.tarballUrl);

    // (g) Bind the tarball to the signed checksum. In allowUnsigned mode we fall
    //     back to the supplied `manifest.checksum` (documented as integrity-only,
    //     NOT authenticity — no trust anchor was established).
    const actualChecksum = createHash('sha256').update(tarballBuffer).digest('hex');
    const compareTarget = this.allowUnsigned ? manifest.checksum : signedChecksum;
    if (actualChecksum !== compareTarget) {
      throw new Error(
        `Checksum mismatch for ${name}@${version}.\n` +
        `Expected: ${compareTarget ?? '(none)'}\n` +
        `Actual:   ${actualChecksum}\n` +
        `Plugin installation aborted.`
      );
    }

    // (h) Extract to pluginsDir under PS-1 containment.
    const destDir = join(this.pluginsDir, `${name}@${version}`);
    await fs.mkdir(destDir, { recursive: true });
    await this._extractTarball(tarballBuffer, destDir);
  }

  /**
   * Parse, validate, and return the manifest. Replaces the unchecked
   * `JSON.parse(body) as PluginManifest` with a zod `safeParse` against
   * `installerManifestSchema` and rejects responses that fail validation or
   * that lack a signature (Req 2.7).
   */
  private async _fetchManifest(name: string, version: string): Promise<InstallerManifest> {
    const url = `${this.registryUrl}/plugins/${encodeURIComponent(name)}/${encodeURIComponent(version)}/manifest.json`;
    const body = await this._fetchText(url);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`Malformed manifest JSON for ${name}@${version}.`);
    }

    const result = installerManifestSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Manifest for ${name}@${version} failed schema validation: ${result.error.message}`
      );
    }
    const manifest = result.data;
    if (!manifest.signature) {
      throw new Error(
        `Manifest for ${name}@${version} is missing a signature. ` +
        `Plugin installation aborted.`
      );
    }
    return manifest;
  }

  /**
   * Reject non-`https:` transport. Parses `rawUrl` with `new URL` (throwing on a
   * parse failure) and throws unless the protocol is exactly `https:` (Req 2.8).
   * Returns the parsed URL for convenience.
   */
  private assertHttps(rawUrl: string): URL {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid URL: ${rawUrl}`);
    }
    if (u.protocol !== 'https:') {
      throw new Error(
        `Refusing non-https plugin transport: ${u.protocol}// (https required)`
      );
    }
    return u;
  }

  private _fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      httpsRequest(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      })
        .on('error', reject)
        .end();
    });
  }

  private _downloadBuffer(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      httpsRequest(url, (res) => {
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
        .on('error', reject)
        .end();
    });
  }

  /**
   * Minimal tar.gz extraction using Node.js built-ins.
   * Supports uncompressed and gzip-compressed archives.
   *
   * Restructured into three passes (PS-1 hardening):
   *   1. Parse pass      — gunzip-or-raw decompress, then parse the tar into an
   *                        in-memory entry list. No writes (Req 3.3 preserved).
   *   2. Validation pass — reject link type-flags ('1'/'2') and any entry that
   *                        escapes containment, BEFORE any byte is written
   *                        (Req 2.1–2.4). Aborts the whole archive on the first
   *                        offending entry, guaranteeing zero out-of-containment
   *                        (and zero in-containment partial) artifacts.
   *   3. Write pass      — only reached if every entry validated; writes files
   *                        ('0'/'\0') and creates dirs ('5') at the precomputed
   *                        contained safe path.
   */
  private async _extractTarball(buffer: Buffer, destDir: string): Promise<void> {
    const zlib = await import('node:zlib');

    // --- Decompress: try gzip, fall back to raw (unchanged, Req 3.3) ---
    let tarBuffer: Buffer;
    try {
      tarBuffer = await new Promise<Buffer>((resolve, reject) => {
        const gunzip = zlib.createGunzip();
        const chunks: Buffer[] = [];
        const writable = new Writable({
          write(chunk: Buffer, _enc, cb) { chunks.push(chunk); cb(); },
          final(cb) { resolve(Buffer.concat(chunks)); cb(); },
        });
        gunzip.on('error', () => {
          // Not gzip — use raw buffer as tar
          resolve(buffer);
        });
        gunzip.pipe(writable);
        gunzip.write(buffer);
        gunzip.end();
        void reject; // for type safety
      });
    } catch {
      tarBuffer = buffer;
    }

    // --- Pass 1: parse tar into an in-memory entry list (no writes) ---
    interface TarEntry {
      name: string;
      typeFlag: string;
      size: number;
      dataOffset: number;
    }
    const entries: TarEntry[] = [];

    let offset = 0;
    while (offset + 512 <= tarBuffer.length) {
      const header = tarBuffer.slice(offset, offset + 512);

      // Check for end-of-archive (two 512-byte blocks of zeros)
      if (header.every((b) => b === 0)) break;

      const nameBytes = header.slice(0, 100);
      const name = nameBytes.toString('utf8').replace(/\0/g, '');

      const sizeStr = header.slice(124, 136).toString('utf8').replace(/\0/g, '').trim();
      const size = parseInt(sizeStr, 8) || 0;
      const typeFlag = String.fromCharCode(header[156] ?? 0);

      offset += 512;

      if (name) {
        entries.push({ name, typeFlag, size, dataOffset: offset });
      }

      // Advance past file data (round up to 512-byte boundary)
      offset += Math.ceil(size / 512) * 512;
    }

    // --- Pass 2: validation pre-pass (runs before ANY byte is written) ---
    const safePaths: string[] = [];
    for (const entry of entries) {
      // Reject symlink ('2') and hardlink ('1') type-flags (Req 2.3).
      if (entry.typeFlag === '1' || entry.typeFlag === '2') {
        throw new Error(
          `Refusing link entry "${entry.name}" (type ${entry.typeFlag}) in plugin archive`
        );
      }
      // Reject any entry that escapes containment (Req 2.1, 2.2, 2.4).
      const safe = resolveContained(destDir, entry.name);
      if (safe === null) {
        throw new Error(
          `Refusing path-traversal entry "${entry.name}" outside plugin directory`
        );
      }
      safePaths.push(safe);
    }

    // --- Pass 3: write pass (only reached once every entry validated) ---
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const safePath = safePaths[i]!;

      if (entry.typeFlag === '0' || entry.typeFlag === '\0') {
        // Regular file
        const fileData = tarBuffer.slice(entry.dataOffset, entry.dataOffset + entry.size);
        await fs.mkdir(path.dirname(safePath), { recursive: true });
        await fs.writeFile(safePath, fileData);
      } else if (entry.typeFlag === '5') {
        // Directory
        await fs.mkdir(safePath, { recursive: true });
      }
    }
  }
}
