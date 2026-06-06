// src/enterprise/storage-adapters.ts
// S3 (AWS SigV4) and GCS (bearer token) storage adapters for the backup
// framework. Pure node:https + node:crypto — no AWS/GCP SDK dependency.

import { request as httpsRequest } from 'node:https';
import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import type { StorageAdapter } from './backup.js';

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

interface HttpResult { status: number; body: Buffer; }

function httpsSend(opts: {
  method: string; host: string; path: string; headers: Record<string, string>; body?: Buffer;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      { method: opts.method, hostname: opts.host, path: opts.path, headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ── AWS Signature V4 ──────────────────────────────────────────────────────────

const SHA256_EMPTY = createHash('sha256').update('').digest('hex');

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export interface SigV4Input {
  method: string;
  host: string;
  path: string;        // canonical URI (already percent-encoded)
  query?: string;      // canonical query string
  region: string;
  service: string;     // e.g. 's3'
  accessKeyId: string;
  secretAccessKey: string;
  payloadHash: string; // hex sha256 of body (or UNSIGNED-PAYLOAD)
  now?: Date;
  extraHeaders?: Record<string, string>;
}

/**
 * Compute AWS SigV4 signed headers for a request. Exported for unit testing of
 * the canonical-request/signing logic without network access.
 */
export function signAwsV4(input: SigV4Input): Record<string, string> {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
    ...(input.extraHeaders ?? {}),
  };

  const sortedHeaderKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headers[Object.keys(headers).find((h) => h.toLowerCase() === k)!]!.trim()}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    input.method,
    input.path,
    input.query ?? '',
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { ...headers, authorization };
}

// ── S3StorageAdapter ──────────────────────────────────────────────────────────

export interface S3StorageOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional key prefix within the bucket. */
  prefix?: string;
}

export class S3StorageAdapter implements StorageAdapter {
  private readonly opts: S3StorageOptions;
  private readonly host: string;

  constructor(opts: S3StorageOptions) {
    this.opts = opts;
    this.host = `${opts.bucket}.s3.${opts.region}.amazonaws.com`;
  }

  private objectPath(key: string): string {
    const full = (this.opts.prefix ? `${this.opts.prefix.replace(/\/$/, '')}/` : '') + key;
    return '/' + full.split('/').map(encodeURIComponent).join('/');
  }

  async write(key: string, stream: NodeJS.ReadableStream): Promise<void> {
    const body = await streamToBuffer(stream);
    const path = this.objectPath(key);
    const headers = signAwsV4({
      method: 'PUT', host: this.host, path, region: this.opts.region, service: 's3',
      accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey,
      payloadHash: sha256Hex(body),
    });
    const res = await httpsSend({ method: 'PUT', host: this.host, path, headers, body });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`S3 PUT failed (${res.status}): ${res.body.toString('utf8').slice(0, 256)}`);
    }
  }

  async read(key: string): Promise<NodeJS.ReadableStream> {
    const path = this.objectPath(key);
    const headers = signAwsV4({
      method: 'GET', host: this.host, path, region: this.opts.region, service: 's3',
      accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey,
      payloadHash: SHA256_EMPTY,
    });
    const res = await httpsSend({ method: 'GET', host: this.host, path, headers });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`S3 GET failed (${res.status})`);
    }
    return Readable.from(res.body);
  }

  async list(): Promise<string[]> {
    const query = 'list-type=2';
    const headers = signAwsV4({
      method: 'GET', host: this.host, path: '/', query, region: this.opts.region, service: 's3',
      accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey,
      payloadHash: SHA256_EMPTY,
    });
    const res = await httpsSend({ method: 'GET', host: this.host, path: `/?${query}`, headers });
    if (res.status < 200 || res.status >= 300) return [];
    const xml = res.body.toString('utf8');
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
  }
}

// ── GcsStorageAdapter ─────────────────────────────────────────────────────────

export interface GcsStorageOptions {
  bucket: string;
  /** OAuth2 bearer access token (from a service account). */
  accessToken: string;
  prefix?: string;
}

export class GcsStorageAdapter implements StorageAdapter {
  private readonly host = 'storage.googleapis.com';
  constructor(private readonly opts: GcsStorageOptions) {}

  private objectName(key: string): string {
    return (this.opts.prefix ? `${this.opts.prefix.replace(/\/$/, '')}/` : '') + key;
  }

  async write(key: string, stream: NodeJS.ReadableStream): Promise<void> {
    const body = await streamToBuffer(stream);
    const name = encodeURIComponent(this.objectName(key));
    const path = `/upload/storage/v1/b/${encodeURIComponent(this.opts.bucket)}/o?uploadType=media&name=${name}`;
    const res = await httpsSend({
      method: 'POST', host: this.host, path,
      headers: { authorization: `Bearer ${this.opts.accessToken}`, 'content-type': 'application/octet-stream', 'content-length': String(body.length) },
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GCS upload failed (${res.status}): ${res.body.toString('utf8').slice(0, 256)}`);
    }
  }

  async read(key: string): Promise<NodeJS.ReadableStream> {
    const name = encodeURIComponent(this.objectName(key));
    const path = `/storage/v1/b/${encodeURIComponent(this.opts.bucket)}/o/${name}?alt=media`;
    const res = await httpsSend({ method: 'GET', host: this.host, path, headers: { authorization: `Bearer ${this.opts.accessToken}` } });
    if (res.status < 200 || res.status >= 300) throw new Error(`GCS download failed (${res.status})`);
    return Readable.from(res.body);
  }

  async list(): Promise<string[]> {
    const path = `/storage/v1/b/${encodeURIComponent(this.opts.bucket)}/o`;
    const res = await httpsSend({ method: 'GET', host: this.host, path, headers: { authorization: `Bearer ${this.opts.accessToken}` } });
    if (res.status < 200 || res.status >= 300) return [];
    const parsed = JSON.parse(res.body.toString('utf8')) as { items?: Array<{ name: string }> };
    return (parsed.items ?? []).map((i) => i.name);
  }
}
