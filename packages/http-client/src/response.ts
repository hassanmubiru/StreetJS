/**
 * A buffered HTTP response.
 *
 * The body is read once into memory so `text()`/`json()`/`bytes()` can be called
 * repeatedly and synchronously.
 *
 * Depends on `types` only.
 */

import type { HeaderMap, HttpResponseView } from './types.js';

export class HttpResponse implements HttpResponseView {
  readonly status: number;
  readonly statusText: string;
  readonly headers: HeaderMap;
  readonly url: string;
  private readonly body: Uint8Array;

  constructor(status: number, statusText: string, headers: HeaderMap, url: string, body: Uint8Array) {
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.url = url;
    this.body = body;
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  /** The raw response bytes. */
  bytes(): Uint8Array {
    return this.body;
  }

  /** The response decoded as UTF-8 text. */
  text(): string {
    return new TextDecoder().decode(this.body);
  }

  /** The response parsed as JSON. Throws on invalid JSON; `undefined` for an empty body. */
  json<T = unknown>(): T {
    const text = this.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }

  /** Buffer a WHATWG `Response` (from `fetch`) into an `HttpResponse`. */
  static async fromFetch(response: Response): Promise<HttpResponse> {
    const headers: HeaderMap = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const body = new Uint8Array(await response.arrayBuffer());
    return new HttpResponse(response.status, response.statusText, headers, response.url, body);
  }
}
