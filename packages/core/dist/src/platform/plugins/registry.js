// src/platform/plugins/registry.ts
// Plugin installer: fetches, verifies (Ed25519 + SHA-256), and extracts plugins.
import { createHash, verify as cryptoVerify } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
export class PluginInstaller {
    registryUrl;
    pluginsDir;
    publicKey;
    constructor(opts) {
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
    async install(name, version) {
        // 1. Fetch manifest
        const manifest = await this._fetchManifest(name, version);
        // 2. Verify Ed25519 signature
        if (this.publicKey) {
            const isValid = this._verifySignature(manifest.checksum, manifest.signature, this.publicKey);
            if (!isValid) {
                throw new Error(`Invalid marketplace signature for ${name}@${version}. ` +
                    `Plugin installation aborted.`);
            }
        }
        // 3. Download tarball
        const tarballBuffer = await this._downloadBuffer(manifest.tarballUrl);
        // 4. Verify SHA-256 checksum
        const actualChecksum = createHash('sha256').update(tarballBuffer).digest('hex');
        if (actualChecksum !== manifest.checksum) {
            throw new Error(`Checksum mismatch for ${name}@${version}.\n` +
                `Expected: ${manifest.checksum}\n` +
                `Actual:   ${actualChecksum}\n` +
                `Plugin installation aborted.`);
        }
        // 5. Extract to pluginsDir
        const destDir = join(this.pluginsDir, `${name}@${version}`);
        await fs.mkdir(destDir, { recursive: true });
        await this._extractTarball(tarballBuffer, destDir);
    }
    async _fetchManifest(name, version) {
        const url = `${this.registryUrl}/plugins/${encodeURIComponent(name)}/${encodeURIComponent(version)}/manifest.json`;
        const body = await this._fetchText(url);
        return JSON.parse(body);
    }
    _verifySignature(message, signature, publicKeyPem) {
        try {
            const sigBuffer = Buffer.from(signature, 'base64');
            const msgBuffer = Buffer.from(message, 'utf8');
            return cryptoVerify(null, // use algorithm from key (Ed25519 doesn't need a hash algorithm here)
            msgBuffer, {
                key: publicKeyPem,
                format: 'pem',
                type: 'spki',
                dsaEncoding: 'ieee-p1363',
            }, sigBuffer);
        }
        catch {
            return false;
        }
    }
    _fetchText(url) {
        return new Promise((resolve, reject) => {
            httpsRequest(url, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                res.on('error', reject);
            })
                .on('error', reject)
                .end();
        });
    }
    _downloadBuffer(url) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            httpsRequest(url, (res) => {
                res.on('data', (c) => chunks.push(c));
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
     */
    async _extractTarball(buffer, destDir) {
        const zlib = await import('node:zlib');
        const path = await import('node:path');
        // Try to decompress as gzip
        let tarBuffer;
        try {
            tarBuffer = await new Promise((resolve, reject) => {
                const gunzip = zlib.createGunzip();
                const chunks = [];
                const writable = new Writable({
                    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
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
        }
        catch {
            tarBuffer = buffer;
        }
        // Parse tar format
        let offset = 0;
        while (offset + 512 <= tarBuffer.length) {
            const header = tarBuffer.slice(offset, offset + 512);
            // Check for end-of-archive (two 512-byte blocks of zeros)
            if (header.every((b) => b === 0))
                break;
            const nameBytes = header.slice(0, 100);
            const name = nameBytes.toString('utf8').replace(/\0/g, '');
            if (!name) {
                offset += 512;
                continue;
            }
            const sizeStr = header.slice(124, 136).toString('utf8').replace(/\0/g, '').trim();
            const size = parseInt(sizeStr, 8) || 0;
            const typeFlag = String.fromCharCode(header[156] ?? 0);
            offset += 512;
            if (typeFlag === '0' || typeFlag === '\0') {
                // Regular file
                const fileData = tarBuffer.slice(offset, offset + size);
                const filePath = path.join(destDir, name.replace(/^\.\//, '').replace(/^\//, ''));
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, fileData);
            }
            else if (typeFlag === '5') {
                // Directory
                const dirPath = path.join(destDir, name.replace(/^\.\//, '').replace(/^\//, ''));
                await fs.mkdir(dirPath, { recursive: true });
            }
            // Advance past file data (round up to 512-byte boundary)
            offset += Math.ceil(size / 512) * 512;
        }
    }
}
//# sourceMappingURL=registry.js.map