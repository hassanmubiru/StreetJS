// src/webhook/dispatcher.ts
// Outbound webhook dispatcher with HMAC-SHA256 signatures, retry, and bounded queue.

import { request as httpsRequest } from 'node:https';
import { createHmac, randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { lookup } from 'node:dns/promises';

export interface WebhookPayload {
  event: string;
  data: unknown;
  ts: number;
  id: string;
}

export interface WebhookTarget {
  url: string;
  secret: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface WebhookJob {
  target: WebhookTarget;
  payload: WebhookPayload;
  attempt: number;
}

const MAX_QUEUE_SIZE = 10_000;
const MAX_CONCURRENT = 32;

// ─── SSRF Protection ──────────────────────────────────────────────────────────

// Patterns that match private, loopback, link-local, and reserved IP ranges.
// Applied to both the URL hostname literal and the resolved IP address.
const BLOCKED_IP_PATTERNS = [
  /^127\./,                              // IPv4 loopback
  /^0\./,                                // IPv4 "this" network
  /^10\./,                               // RFC 1918 private
  /^172\.(1[6-9]|2\d|3[01])\./,         // RFC 1918 private
  /^192\.168\./,                         // RFC 1918 private
  /^169\.254\./,                         // link-local / AWS IMDS
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // RFC 6598 shared address
  /^192\.0\.2\./,                        // TEST-NET-1
  /^198\.51\.100\./,                     // TEST-NET-2
  /^203\.0\.113\./,                      // TEST-NET-3
  /^240\./,                              // reserved
  /^255\./,                              // broadcast
  /^::1$/,                               // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,                    // IPv6 ULA
  /^fd[0-9a-f]{2}:/i,                    // IPv6 ULA
  /^fe[89ab][0-9a-f]:/i,                 // IPv6 link-local
  /^::ffff:127\./,                       // IPv4-mapped loopback
  /^::ffff:10\./,                        // IPv4-mapped RFC1918
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,  // IPv4-mapped RFC1918
  /^::ffff:192\.168\./,                  // IPv4-mapped RFC1918
  /^::ffff:169\.254\./,                  // IPv4-mapped link-local
];

function isBlockedAddress(address: string): boolean {
  return BLOCKED_IP_PATTERNS.some((re) => re.test(address));
}

/**
 * Validate a webhook URL for SSRF safety.
 * - Must use HTTPS
 * - Hostname must not be a private/reserved IP literal
 * - Resolved IP must not be private/reserved (DNS rebinding protection)
 */
async function validateWebhookUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URLs must use HTTPS to protect payload confidentiality');
  }

  const hostname = parsed.hostname;

  // Block bare IP literals that are private/reserved
  if (isBlockedAddress(hostname)) {
    throw new Error(`Webhook URL targets a blocked address: ${hostname}`);
  }

  // Resolve hostname and check the resulting IP (DNS rebinding protection)
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isBlockedAddress(address)) {
        throw new Error(`Webhook URL resolves to a blocked address: ${address}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Webhook URL')) throw err;
    throw new Error(`Webhook URL DNS resolution failed: ${hostname}`);
  }
}

export class WebhookDispatcher {
  private readonly queue: WebhookJob[] = [];
  private running = 0;
  private processing = false;
  private stopped = false;
  private readonly allowedHosts: Set<string>;

  // Track URLs that have already been warned about to prevent log spam.
  // Cleared every 60 seconds so recurring misconfiguration is still visible.
  private readonly _warnedUrls = new Set<string>();
  private readonly _warnClearTimer: NodeJS.Timeout;

  /**
   * @param allowedHosts - Optional set of hostnames/IPs that bypass the SSRF
   * blocklist. Use ONLY in test environments to allow localhost HTTPS servers.
   * Never pass user-controlled values here.
   */
  constructor(allowedHosts: string[] = []) {
    this.allowedHosts = new Set(allowedHosts);
    this._warnClearTimer = setInterval(() => this._warnedUrls.clear(), 60_000);
    this._warnClearTimer.unref();
  }

  enqueue(target: WebhookTarget, event: string, data: unknown): boolean {
    if (this.stopped) return false;
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      console.warn('[webhook] Queue full, dropping event:', event);
      return false;
    }

    const payload: WebhookPayload = {
      event,
      data,
      ts: Date.now(),
      id: randomId(),
    };

    // Validate URL asynchronously before dispatching; drop on failure.
    // Each unique bad URL is only logged once per 60-second window to
    // prevent log spam when the same misconfigured URL is called repeatedly.
    validateWebhookUrl(target.url)
      .then(() => {
        if (this.stopped) return;
        this.queue.push({ target, payload, attempt: 0 });
        if (!this.processing) this._drain();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        const key = `${target.url}::${msg}`;
        if (!this._warnedUrls.has(key)) {
          this._warnedUrls.add(key);
          console.error(
            `[webhook] URL validation failed, dropping event "${event}": ${msg}\n` +
            `  → Fix: update the webhook target URL to use https://`
          );
        }
      });

    return true;
  }

  private _drain(): void {
    this.processing = true;
    while (this.queue.length > 0 && this.running < MAX_CONCURRENT) {
      const job = this.queue.shift()!;
      this.running++;
      this._dispatch(job)
        .catch((err) => console.error('[webhook] Dispatch error:', err))
        .finally(() => {
          this.running--;
          if (this.queue.length > 0) this._drain();
          else this.processing = false;
        });
    }
    if (this.queue.length === 0) this.processing = false;
  }

  private async _dispatch(job: WebhookJob): Promise<void> {
    const { target, payload } = job;
    const body = JSON.stringify(payload);
    const sig = signPayload(body, target.secret);
    const timeoutMs = target.timeoutMs ?? 10_000;
    const maxRetries = target.maxRetries ?? 3;

    try {
      const statusCode = await sendRequest(target.url, body, sig, timeoutMs);
      if (statusCode >= 200 && statusCode < 300) {
        return; // success
      }
      throw new Error(`Unexpected status: ${statusCode}`);
    } catch (err) {
      if (job.attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, job.attempt), 30_000);
        setTimeout(() => {
          if (!this.stopped && this.queue.length < MAX_QUEUE_SIZE) {
            this.queue.push({ ...job, attempt: job.attempt + 1 });
            if (!this.processing) this._drain();
          }
        }, delay).unref();
      } else {
        console.error(`[webhook] Permanently failed after ${maxRetries} retries:`, err);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    clearInterval(this._warnClearTimer);
  }
}

function signPayload(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function sendRequest(
  url: string,
  body: string,
  signature: string,
  timeoutMs: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    // Only HTTPS is permitted (enforced by validateWebhookUrl, but double-check here)
    if (parsed.protocol !== 'https:') {
      reject(new Error('Only HTTPS webhook URLs are permitted'));
      return;
    }
    const requester = httpsRequest;

    const bodyBuf = Buffer.from(body, 'utf8');

    const req = requester(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': bodyBuf.length,
          'X-Street-Signature': signature,
          'User-Agent': 'Street-Webhook/1.0',
        },
        timeout: timeoutMs,
      },
      (res) => {
        // Drain response to free socket
        res.resume();
        res.once('end', () => resolve(res.statusCode ?? 0));
        res.once('error', reject);
      }
    );

    req.once('error', reject);
    req.once('timeout', () => {
      req.destroy(new Error('Webhook request timeout'));
    });
    req.once('socket', (sock) => {
      sock.once('close', () => {
        // Socket fully closed — nothing to clean up here
      });
    });

    req.write(bodyBuf);
    req.end();
  });
}

// Finding 3 fix: use cryptographically secure randomBytes instead of Math.random()
function randomId(): string {
  return randomBytes(16).toString('hex');
}
