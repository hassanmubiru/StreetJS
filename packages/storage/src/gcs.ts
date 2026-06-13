// packages/storage/src/gcs.ts
// Google Cloud Storage (JSON API) StorageProvider. Works against real GCS and
// the fsouza/fake-gcs-server emulator. Uploads use multipart/related so content
// type and custom metadata travel with the bytes; downloads use ?alt=media.
//
// Auth: pass an OAuth `accessToken` for real GCS. The emulator needs none.

import { randomBytes } from 'node:crypto';
import type { StorageProvider, PutOptions, StoredObject, ObjectInfo } from './index.js';
import { validateKey } from './index.js';

/** Fetch with the binary + json reads this provider needs. */
export type GcsFetch = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface GcsStorageProviderOptions {
  bucket: string;
  /** API endpoint. Default https://storage.googleapis.com. */
  endpoint?: string;
  /** OAuth access token (real GCS). Omit for the emulator. */
  accessToken?: string;
  fetch?: GcsFetch;
}

export class GcsStorageProvider implements StorageProvider {
  readonly name = 'gcs';
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly token: string | undefined;
  private readonly fetch: GcsFetch;
  private bucketReady: Promise<void> | null = null;

  constructor(options: GcsStorageProviderOptions) {
    this.bucket = options.bucket;
    this.endpoint = (options.endpoint ?? 'https://storage.googleapis.com').replace(/\/$/, '');
    this.token = options.accessToken;
    const g = (globalThis as { fetch?: unknown }).fetch;
    this.fetch = options.fetch ?? (g as GcsFetch);
    if (typeof this.fetch !== 'function') throw new Error('GcsStorageProvider: no fetch available');
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }

  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const res = await this.fetch(`${this.endpoint}/storage/v1/b?project=street`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify({ name: this.bucket }),
        });
        // 200 created, 409 already-exists are both fine.
        if (!res.ok && res.status !== 409) {
          const body = await res.text();
          if (!/already (own|exist)/i.test(body)) {
            throw new Error(`gcs: create bucket failed ${res.status}: ${body.slice(0, 200)}`);
          }
        }
      })();
    }
    return this.bucketReady;
  }

  async put(key: string, data: Buffer, options: PutOptions = {}): Promise<ObjectInfo> {
    validateKey(key);
    await this.ensureBucket();
    const contentType = options.contentType ?? 'application/octet-stream';
    const boundary = `street${randomBytes(12).toString('hex')}`;
    const meta = JSON.stringify({ name: key, contentType, metadata: options.metadata ?? {} });
    const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
    const post = `\r\n--${boundary}--`;
    const body = Buffer.concat([Buffer.from(pre, 'utf8'), data, Buffer.from(post, 'utf8')]);

    const res = await this.fetch(
      `${this.endpoint}/upload/storage/v1/b/${this.bucket}/o?uploadType=multipart`,
      { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}`, ...this.authHeaders() }, body },
    );
    if (!res.ok) throw new Error(`gcs: upload failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string): Promise<StoredObject | undefined> {
    validateKey(key);
    const obj = encodeURIComponent(key);
    const metaRes = await this.fetch(`${this.endpoint}/storage/v1/b/${this.bucket}/o/${obj}`, { headers: this.authHeaders() });
    if (metaRes.status === 404) return undefined;
    if (!metaRes.ok) throw new Error(`gcs: get metadata failed ${metaRes.status}`);
    const meta = (await metaRes.json()) as Record<string, unknown>;

    const mediaRes = await this.fetch(`${this.endpoint}/storage/v1/b/${this.bucket}/o/${obj}?alt=media`, { headers: this.authHeaders() });
    if (mediaRes.status === 404) return undefined;
    if (!mediaRes.ok) throw new Error(`gcs: get media failed ${mediaRes.status}`);
    const data = Buffer.from(await mediaRes.arrayBuffer());

    return {
      key,
      data,
      contentType: String(meta['contentType'] ?? 'application/octet-stream'),
      size: data.byteLength,
      metadata: (meta['metadata'] as Record<string, string>) ?? {},
    };
  }

  async delete(key: string): Promise<boolean> {
    validateKey(key);
    const res = await this.fetch(`${this.endpoint}/storage/v1/b/${this.bucket}/o/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`gcs: delete failed ${res.status}`);
    return true;
  }

  async exists(key: string): Promise<boolean> {
    validateKey(key);
    const res = await this.fetch(`${this.endpoint}/storage/v1/b/${this.bucket}/o/${encodeURIComponent(key)}`, { headers: this.authHeaders() });
    return res.ok;
  }

  async list(prefix = ''): Promise<ObjectInfo[]> {
    await this.ensureBucket();
    const res = await this.fetch(
      `${this.endpoint}/storage/v1/b/${this.bucket}/o?prefix=${encodeURIComponent(prefix)}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) throw new Error(`gcs: list failed ${res.status}`);
    const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
    return (json.items ?? [])
      .map((o) => ({
        key: String(o['name']),
        size: Number(o['size'] ?? 0),
        contentType: String(o['contentType'] ?? 'application/octet-stream'),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}
