// packages/edge/src/lambda.ts
// AWS Lambda adapter: converts API Gateway proxy events (REST API v1 and
// HTTP API v2 / payload format 2.0) into a Web Fetch `Request`, dispatches them
// through Street via `handleEdgeRequest`, and converts the `Response` back into
// an API Gateway proxy result. No aws-sdk dependency — pure event shaping.

import type { StreetApp } from '@streetjs/core';
import { handleEdgeRequest } from './adapter.js';

/** Minimal API Gateway proxy event shape (v1 and v2 fields, all optional). */
export interface ApiGatewayProxyEvent {
  version?: string;
  rawPath?: string;
  rawQueryString?: string;
  path?: string;
  httpMethod?: string;
  requestContext?: { http?: { method?: string; path?: string } };
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

export interface ApiGatewayProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

function buildUrl(event: ApiGatewayProxyEvent): string {
  const host = event.headers?.['host'] ?? event.headers?.['Host'] ?? 'lambda.local';
  const proto = event.headers?.['x-forwarded-proto'] ?? 'https';
  const path = event.rawPath ?? event.path ?? event.requestContext?.http?.path ?? '/';
  let query = event.rawQueryString ?? '';
  if (!query && event.queryStringParameters) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(event.queryStringParameters)) {
      if (v !== undefined) params.append(k, v);
    }
    query = params.toString();
  }
  return `${proto}://${host}${path}${query ? `?${query}` : ''}`;
}

function methodOf(event: ApiGatewayProxyEvent): string {
  return event.httpMethod ?? event.requestContext?.http?.method ?? 'GET';
}

/** Convert an API Gateway proxy event into a Web Fetch Request. */
export function eventToRequest(event: ApiGatewayProxyEvent): Request {
  const method = methodOf(event);
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    if (v !== undefined) headers.set(k, v);
  }
  let body: string | undefined;
  if (event.body != null && method !== 'GET' && method !== 'HEAD') {
    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  }
  return new Request(buildUrl(event), { method, headers, ...(body !== undefined ? { body } : {}) });
}

/** Convert a Web Fetch Response into an API Gateway proxy result. */
export async function responseToResult(res: Response): Promise<ApiGatewayProxyResult> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => { headers[key] = value; });
  const body = await res.text();
  return { statusCode: res.status, headers, body, isBase64Encoded: false };
}

/**
 * Create an AWS Lambda handler that dispatches API Gateway proxy events through
 * a StreetApp. Works with both REST API (v1) and HTTP API (v2) payload formats.
 *
 * ```ts
 * import { streetApp } from '@streetjs/core';
 * import { createLambdaHandler } from '@streetjs/edge/lambda';
 * const app = streetApp();
 * app.use(async (ctx) => ctx.json({ ok: true }));
 * export const handler = createLambdaHandler(app);
 * ```
 */
export function createLambdaHandler(app: StreetApp): (event: ApiGatewayProxyEvent) => Promise<ApiGatewayProxyResult> {
  return async (event: ApiGatewayProxyEvent): Promise<ApiGatewayProxyResult> => {
    const request = eventToRequest(event);
    const response = await handleEdgeRequest(request, app);
    return responseToResult(response);
  };
}
