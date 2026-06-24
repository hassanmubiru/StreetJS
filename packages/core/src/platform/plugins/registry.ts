// src/platform/plugins/registry.ts
// Plugin installer: fetches, verifies (Ed25519 + SHA-256), and extracts plugins.

import { createHash, verify as cryptoVerify } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import { Writable } from 'node:stream';

export interface PluginInstallerOptions {
  registryUrl?: string;
  pluginsDir: string;
  publicKey?: string;
}

/**
 * Returns the safe absolute destination for `entryName` under `destDir`, or
 * `null` if the entry escapes containment. Pure — only `node:path`, no I/O.
 *
 * PS-1 path-containment guard. Strips a single leading "./" and "/"
 * (preserving in-containment normalization, Req 3.2), rejects absolute paths
 * and any ".." path segment, and finally requires that the resolved path is
 * the extraction root itself or a descendant of it (Req 2.1, 2.2, 2.4).
 */
function resolveContained(destDir: string, entryName: string): string | null {
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

interface PluginManifest {
  name: string;
  version: string;
  checksum: string;
  signature: string;
  tarballUrl: string;
}

export class PluginInstaller {
  private readonly registryUrl: string;
  private readonly pluginsDir: string;
  private readonly publicKey: string | undefined;

  constructor(opts: PluginInstallerOptions) {
    this.registryUrl = opts.registryUrl ?? 'https://registry.streetjs.dev';
    this.pluginsDir = opts.pluginsDir;
    this.publicKey = opts.publicKey;
  }

  /**
   * Installs a plugin by name and version.
   * Steps:
   *   1. Fetch manifest from registry
   *   2. Verify Ed25519 signature (if public key is configured)
   *   3. Download tarball
   *   4. Verify SHA-256 checksum
   *   5. Extract to pluginsDir/<name>@<version>/
   */
  async install(name: string, version: string): Promise<void> {
    // 1. Fetch manifest
    const manifest = await this._fetchManifest(name, version);

    // 2. Verify Ed25519 signature
    if (this.publicKey) {
      const isValid = this._verifySignature(
        manifest.checksum,
        manifest.signature,
        this.publicKey
      );
      if (!isValid) {
        throw new Error(
          `Invalid marketplace signature for ${name}@${version}. ` +
          `Plugin installation aborted.`
        );
      }
    }

    // 3. Download tarball
    const tarballBuffer = await this._downloadBuffer(manifest.tarballUrl);

    // 4. Verify SHA-256 checksum
    const actualChecksum = createHash('sha256').update(tarballBuffer).digest('hex');
    if (actualChecksum !== manifest.checksum) {
      throw new Error(
        `Checksum mismatch for ${name}@${version}.\n` +
        `Expected: ${manifest.checksum}\n` +
        `Actual:   ${actualChecksum}\n` +
        `Plugin installation aborted.`
      );
    }

    // 5. Extract to pluginsDir
    const destDir = join(this.pluginsDir, `${name}@${version}`);
    await fs.mkdir(destDir, { recursive: true });
    await this._extractTarball(tarballBuffer, destDir);
  }

  private async _fetchManifest(name: string, version: string): Promise<PluginManifest> {
    const url = `${this.registryUrl}/plugins/${encodeURIComponent(name)}/${encodeURIComponent(version)}/manifest.json`;
    const body = await this._fetchText(url);
    return JSON.parse(body) as PluginManifest;
  }

  private _verifySignature(
    message: string,
    signature: string,
    publicKeyPem: string
  ): boolean {
    try {
      const sigBuffer = Buffer.from(signature, 'base64');
      const msgBuffer = Buffer.from(message, 'utf8');
      return cryptoVerify(
        null, // use algorithm from key (Ed25519 doesn't need a hash algorithm here)
        msgBuffer,
        {
          key: publicKeyPem,
          format: 'pem',
          type: 'spki',
          dsaEncoding: 'ieee-p1363',
        },
        sigBuffer
      );
    } catch {
      return false;
    }
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
