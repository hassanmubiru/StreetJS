// packages/storage/src/index.ts
// Official Street Framework storage module: @streetjs/storage.
//
// A unified file-storage API with pluggable providers, plus cross-cutting
// concerns implemented once at the service layer:
//   * Upload limits      — reject objects over a configured byte cap.
//   * Malware/scan hooks  — async predicate run before an object is stored.
//   * Transform hooks     — e.g. image optimization, applied before storing.
//   * Signed URLs         — HMAC-signed, time-limited URLs with verification.
//
// Providers shipped: InMemoryStorageProvider (default; tests/examples) and
// LocalStorageProvider (filesystem, path-traversal-safe). S3, Cloudflare R2,
// Azure Blob, and GCS implement the same StorageProvider interface as adapters
// (the repo already ships plugin-s3 / plugin-r2).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { validateKey } from './internal.js';

// ── Types (defined in ./internal.js to avoid a barrel import cycle) ─────────────

export type { PutOptions, StoredObject, ObjectInfo, StorageProvider } from './internal.js';
export { validateKey } from './internal.js';

import type { PutOptions, ObjectInfo, StoredObject, StorageProvider } from './internal.js';

// ── In-memory provider (default) ───────────────────────────────────────────────

export class InMemoryStorageProvider implements StorageProvider {
  readonly name = 'memory';
  private readonly objects = new Map<string, StoredObject>();

  async put(key: string, data: Buffer, options: PutOptions = {}): Promise<ObjectInfo> {
    const obj: StoredObject = {
      key,
      data: Buffer.from(data),
      contentType: options.contentType ?? 'application/octet-stream',
      size: data.byteLength,
      metadata: { ...(options.metadata ?? {}) },
    };
    this.objects.set(key, obj);
    return { key, size: obj.size, contentType: obj.contentType };
  }

  async get(key: string): Promise<StoredObject | undefined> {
    const o = this.objects.get(key);
    return o ? { ...o, data: Buffer.from(o.data), metadata: { ...o.metadata } } : undefined;
  }

  async delete(key: string): Promise<boolean> {
    return this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async list(prefix = ''): Promise<ObjectInfo[]> {
    return [...this.objects.values()]
      .filter((o) => o.key.startsWith(prefix))
      .map((o) => ({ key: o.key, size: o.size, contentType: o.contentType }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}

// ── Local filesystem provider ───────────────────────────────────────────────────

/** Filesystem-backed provider rooted at `baseDir`. Rejects path traversal. */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  constructor(private readonly baseDir: string) {}

  private resolve(key: string): string {
    const safeKey = validateKey(key);
    const full = normalize(join(this.baseDir, safeKey));
    const root = normalize(this.baseDir.endsWith(sep) ? this.baseDir : this.baseDir + sep);
    if (full !== normalize(this.baseDir) && !full.startsWith(root)) {
      throw new Error(`LocalStorageProvider: refusing path traversal for key "${key}"`);
    }
    return full;
  }

  async put(key: string, data: Buffer, options: PutOptions = {}): Promise<ObjectInfo> {
    const full = this.resolve(key);
    await fs.mkdir(join(full, '..'), { recursive: true });
    await fs.writeFile(full, data);
    const contentType = options.contentType ?? 'application/octet-stream';
    if (options.metadata) {
      await fs.writeFile(`${full}.meta.json`, JSON.stringify({ contentType, metadata: options.metadata }));
    }
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string): Promise<StoredObject | undefined> {
    const full = this.resolve(key);
    try {
      const data = await fs.readFile(full);
      let contentType = 'application/octet-stream';
      let metadata: Record<string, string> = {};
      try {
        const meta = JSON.parse(await fs.readFile(`${full}.meta.json`, 'utf8'));
        contentType = meta.contentType ?? contentType;
        metadata = meta.metadata ?? {};
      } catch { /* no sidecar metadata */ }
      return { key, data, contentType, size: data.byteLength, metadata };
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<boolean> {
    const full = this.resolve(key);
    try {
      await fs.rm(full);
      await fs.rm(`${full}.meta.json`, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix = ''): Promise<ObjectInfo[]> {
    const out: ObjectInfo[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          await walk(join(dir, e.name), childRel);
        } else if (!e.name.endsWith('.meta.json')) {
          if (childRel.startsWith(prefix)) {
            const stat = await fs.stat(join(dir, e.name));
            out.push({ key: childRel, size: stat.size, contentType: 'application/octet-stream' });
          }
        }
      }
    };
    await walk(this.baseDir, '');
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}

// ── Signed URLs ─────────────────────────────────────────────────────────────────

export interface SignedUrlOptions {
  /** Seconds until the URL expires. Default 900 (15 min). */
  expiresInSeconds?: number;
  /** Operation the URL authorizes. Default 'get'. */
  operation?: 'get' | 'put';
}

export interface SignedUrl {
  key: string;
  operation: 'get' | 'put';
  expiresAt: number; // epoch seconds
  signature: string;
}

/**
 * HMAC-based signer for time-limited object URLs. The signature covers the key,
 * operation, and expiry, so it cannot be replayed for a different object/op or
 * after expiry. Use the same secret on sign and verify.
 */
export class UrlSigner {
  constructor(private readonly secret: string, private readonly now: () => number = () => Date.now()) {
    if (!secret || secret.length < 16) {
      throw new Error('UrlSigner: secret must be at least 16 characters');
    }
  }

  sign(key: string, options: SignedUrlOptions = {}): SignedUrl {
    validateKey(key);
    const operation = options.operation ?? 'get';
    const expiresAt = Math.floor(this.now() / 1000) + (options.expiresInSeconds ?? 900);
    return { key, operation, expiresAt, signature: this.compute(key, operation, expiresAt) };
  }

  /** Returns true iff the signature matches and the URL has not expired. */
  verify(url: SignedUrl): boolean {
    if (typeof url?.signature !== 'string') return false;
    if (Math.floor(this.now() / 1000) > url.expiresAt) return false;
    const expected = this.compute(url.key, url.operation, url.expiresAt);
    const a = Buffer.from(url.signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private compute(key: string, operation: string, expiresAt: number): string {
    return createHmac('sha256', this.secret).update(`${operation}:${key}:${expiresAt}`).digest('hex');
  }
}

// ── StorageService ──────────────────────────────────────────────────────────────

/** Result returned by a scan hook. */
export type ScanResult = { ok: true } | { ok: false; reason: string };

export interface StorageServiceOptions {
  provider?: StorageProvider;
  /** Maximum object size in bytes. Default 10 MiB. */
  maxBytes?: number;
  /** Optional async scanner run before storing (malware/content hooks). */
  scan?: (key: string, data: Buffer, contentType: string) => Promise<ScanResult> | ScanResult;
  /** Optional transform run before storing (e.g. image optimization). */
  transform?: (key: string, data: Buffer, contentType: string) => Promise<Buffer> | Buffer;
  /** Signer used by {@link StorageService.signedUrl}. */
  signer?: UrlSigner;
}

/** Thrown when an upload exceeds the configured size cap. */
export class UploadTooLargeError extends Error {
  constructor(public readonly size: number, public readonly maxBytes: number) {
    super(`Upload of ${size} bytes exceeds limit of ${maxBytes} bytes`);
    this.name = 'UploadTooLargeError';
  }
}

/** Thrown when the scan hook rejects an object. */
export class ScanRejectedError extends Error {
  constructor(public readonly reason: string) {
    super(`Upload rejected by scan: ${reason}`);
    this.name = 'ScanRejectedError';
  }
}

/** File storage facade applying limits, scanning, transforms, and signed URLs. */
export class StorageService {
  private readonly provider: StorageProvider;
  private readonly maxBytes: number;
  private readonly scan: StorageServiceOptions['scan'];
  private readonly transform: StorageServiceOptions['transform'];
  private readonly signer: UrlSigner | undefined;

  constructor(options: StorageServiceOptions = {}) {
    this.provider = options.provider ?? new InMemoryStorageProvider();
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
    this.scan = options.scan;
    this.transform = options.transform;
    this.signer = options.signer;
  }

  /** Store an object after enforcing the size limit, scan, and transform. */
  async upload(key: string, data: Buffer, options: PutOptions = {}): Promise<ObjectInfo> {
    validateKey(key);
    if (!Buffer.isBuffer(data)) throw new Error('StorageService.upload: data must be a Buffer');
    if (data.byteLength > this.maxBytes) throw new UploadTooLargeError(data.byteLength, this.maxBytes);

    const contentType = options.contentType ?? 'application/octet-stream';
    if (this.scan) {
      const result = await this.scan(key, data, contentType);
      if (!result.ok) throw new ScanRejectedError(result.reason);
    }
    let payload = data;
    if (this.transform) {
      payload = await this.transform(key, data, contentType);
      if (payload.byteLength > this.maxBytes) throw new UploadTooLargeError(payload.byteLength, this.maxBytes);
    }
    return this.provider.put(key, payload, options);
  }

  async download(key: string): Promise<StoredObject | undefined> {
    return this.provider.get(validateKey(key));
  }

  async remove(key: string): Promise<boolean> {
    return this.provider.delete(validateKey(key));
  }

  async exists(key: string): Promise<boolean> {
    return this.provider.exists(validateKey(key));
  }

  async list(prefix?: string): Promise<ObjectInfo[]> {
    return this.provider.list(prefix);
  }

  /** Create a time-limited signed URL descriptor for an object. */
  signedUrl(key: string, options?: SignedUrlOptions): SignedUrl {
    if (!this.signer) throw new Error('StorageService: a signer is required for signed URLs');
    return this.signer.sign(validateKey(key), options);
  }

  /** Verify a signed URL descriptor. */
  verifySignedUrl(url: SignedUrl): boolean {
    if (!this.signer) throw new Error('StorageService: a signer is required to verify signed URLs');
    return this.signer.verify(url);
  }
}

// ── key validation lives in ./internal.js (re-exported above) ───────────────────

export * from './pg.js';
export * from './gcs.js';
export * from './azure.js';
