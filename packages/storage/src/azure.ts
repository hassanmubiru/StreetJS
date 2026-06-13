// packages/storage/src/azure.ts
// Azure Blob Storage StorageProvider using SharedKey (HMAC-SHA256) auth,
// implemented to the documented Blob canonicalization spec.
//
// STATUS: EXPERIMENTAL / NOT YET VERIFIED. The SharedKey signature is rejected
// by the Azurite emulator in local testing (403 AuthorizationFailure) and the
// mismatch has not been isolated (recent Azurite no longer echoes the expected
// string-to-sign). Do not rely on this provider until it has an integration
// test passing against Azurite or real Azure. The GCS and Postgres providers
// are verified; prefer those, or @streetjs/plugin-s3 / -r2, in the meantime.

import { createHmac } from 'node:crypto';
import type { StorageProvider, PutOptions, StoredObject, ObjectInfo } from './index.js';
import { validateKey } from './index.js';

const API_VERSION = '2021-12-02';

/** Fetch with binary + header reads this provider needs. */
export type AzureFetch = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null; forEach(cb: (value: string, key: string) => void): void };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface AzureBlobStorageProviderOptions {
  account: string;
  accountKey: string;
  container: string;
  /** Blob endpoint. Default https://{account}.blob.core.windows.net. Azurite:
   *  http://127.0.0.1:10000/devstoreaccount1 */
  endpoint?: string;
  fetch?: AzureFetch;
}

export class AzureBlobStorageProvider implements StorageProvider {
  readonly name = 'azure-blob';
  private readonly account: string;
  private readonly key: Buffer;
  private readonly container: string;
  private readonly endpoint: string;
  private readonly fetch: AzureFetch;
  private containerReady: Promise<void> | null = null;

  constructor(options: AzureBlobStorageProviderOptions) {
    this.account = options.account;
    this.key = Buffer.from(options.accountKey, 'base64');
    this.container = options.container;
    this.endpoint = (options.endpoint ?? `https://${options.account}.blob.core.windows.net`).replace(/\/$/, '');
    const g = (globalThis as { fetch?: unknown }).fetch;
    this.fetch = options.fetch ?? (g as AzureFetch);
    if (typeof this.fetch !== 'function') throw new Error('AzureBlobStorageProvider: no fetch available');
  }

  /** Build SharedKey StringToSign and return the Authorization header value. */
  private authorize(
    method: string,
    pathAndQuery: string,
    headers: Record<string, string>,
    contentLength: number,
  ): string {
    const h = (name: string) => headers[name] ?? '';
    // CanonicalizedHeaders: x-ms-* sorted by name, lowercased.
    const msHeaders = Object.keys(headers)
      .filter((k) => k.toLowerCase().startsWith('x-ms-'))
      .map((k) => [k.toLowerCase(), headers[k]!.trim()] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => `${k}:${v}`)
      .join('\n');

    // CanonicalizedResource: /account/path + sorted query params.
    const [path, query = ''] = pathAndQuery.split('?');
    const params = query
      ? query.split('&').map((p) => {
          const i = p.indexOf('=');
          return [decodeURIComponent(p.slice(0, i)).toLowerCase(), decodeURIComponent(p.slice(i + 1))] as const;
        })
      : [];
    params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const canonResource =
      `/${this.account}${path}` + params.map(([k, v]) => `\n${k}:${v}`).join('');

    // Content-Length is "" when 0 (API 2015-02-21+).
    const clen = contentLength > 0 ? String(contentLength) : '';
    const stringToSign = [
      method,
      h('Content-Encoding'),
      h('Content-Language'),
      clen,
      h('Content-MD5'),
      h('Content-Type'),
      '', // Date (we use x-ms-date instead)
      h('If-Modified-Since'),
      h('If-Match'),
      h('If-None-Match'),
      h('If-Unmodified-Since'),
      h('Range'),
      msHeaders + '\n' + canonResource,
    ].join('\n');

    const sig = createHmac('sha256', this.key).update(stringToSign, 'utf8').digest('base64');
    return `SharedKey ${this.account}:${sig}`;
  }

  private async send(
    method: string,
    pathAndQuery: string,
    extraHeaders: Record<string, string> = {},
    body?: Uint8Array,
  ): ReturnType<AzureFetch> {
    const contentLength = body ? body.byteLength : 0;
    const headers: Record<string, string> = {
      'x-ms-date': new Date().toUTCString(),
      'x-ms-version': API_VERSION,
      ...extraHeaders,
    };
    headers['authorization'] = this.authorize(method, pathAndQuery, headers, contentLength);
    return this.fetch(`${this.endpoint}${pathAndQuery}`, { method, headers, body });
  }

  private ensureContainer(): Promise<void> {
    if (!this.containerReady) {
      this.containerReady = (async () => {
        const res = await this.send('PUT', `/${this.container}?restype=container`);
        // 201 created, 409 already-exists are both acceptable.
        if (!res.ok && res.status !== 409) {
          throw new Error(`azure: create container failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
      })();
    }
    return this.containerReady;
  }

  private blobPath(key: string): string {
    return `/${this.container}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async put(key: string, data: Buffer, options: PutOptions = {}): Promise<ObjectInfo> {
    validateKey(key);
    await this.ensureContainer();
    const contentType = options.contentType ?? 'application/octet-stream';
    const metaHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(options.metadata ?? {})) metaHeaders[`x-ms-meta-${k}`] = v;
    const res = await this.send(
      'PUT',
      this.blobPath(key),
      { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType, ...metaHeaders },
      data,
    );
    if (!res.ok) throw new Error(`azure: put blob failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string): Promise<StoredObject | undefined> {
    validateKey(key);
    const res = await this.send('GET', this.blobPath(key));
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`azure: get blob failed ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    const metadata: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith('x-ms-meta-')) metadata[key.slice('x-ms-meta-'.length)] = value;
    });
    return {
      key,
      data,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      size: data.byteLength,
      metadata,
    };
  }

  async delete(key: string): Promise<boolean> {
    validateKey(key);
    const res = await this.send('DELETE', this.blobPath(key));
    if (res.status === 404) return false;
    if (!res.ok && res.status !== 202) throw new Error(`azure: delete blob failed ${res.status}`);
    return true;
  }

  async exists(key: string): Promise<boolean> {
    validateKey(key);
    const res = await this.send('HEAD', this.blobPath(key));
    return res.ok;
  }

  async list(prefix = ''): Promise<ObjectInfo[]> {
    await this.ensureContainer();
    const res = await this.send('GET', `/${this.container}?restype=container&comp=list&prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) throw new Error(`azure: list failed ${res.status}`);
    const xml = await res.text();
    const out: ObjectInfo[] = [];
    // Minimal XML scan: <Blob><Name>..</Name>...<Content-Length>..</Content-Length><Content-Type>..</Content-Type>
    for (const blob of xml.split('<Blob>').slice(1)) {
      const name = /<Name>([\s\S]*?)<\/Name>/.exec(blob)?.[1];
      if (!name) continue;
      const size = Number(/<Content-Length>(\d+)<\/Content-Length>/.exec(blob)?.[1] ?? 0);
      const ct = /<Content-Type>([\s\S]*?)<\/Content-Type>/.exec(blob)?.[1] ?? 'application/octet-stream';
      out.push({ key: name, size, contentType: ct });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}
