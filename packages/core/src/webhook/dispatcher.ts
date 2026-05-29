// src/webhook/dispatcher.ts
// Outbound webhook dispatcher with HMAC-SHA256 signatures, retry, and bounded queue.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHmac } from 'node:crypto';
import { URL } from 'node:url';

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

export class WebhookDispatcher {
  private readonly queue: WebhookJob[] = [];
  private running = 0;
  private processing = false;
  private stopped = false;

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

    this.queue.push({ target, payload, attempt: 0 });
    if (!this.processing) this._drain();
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
    const isHttps = parsed.protocol === 'https:';
    const requester = isHttps ? httpsRequest : httpRequest;

    const bodyBuf = Buffer.from(body, 'utf8');

    const req = requester(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
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

function randomId(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
