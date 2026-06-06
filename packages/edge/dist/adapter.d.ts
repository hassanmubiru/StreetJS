import type { StreetApp } from '@streetjs/core';
/**
 * Handles an incoming Web Fetch API `Request` using a StreetApp instance.
 * This adapter converts the Web Fetch request into a StreetContext-compatible
 * shape and returns a Web Fetch `Response`.
 *
 * Compatible with Vercel Edge Functions, Cloudflare Workers, and any
 * environment implementing the WinterCG Fetch standard.
 */
export declare function handleEdgeRequest(request: Request, app: StreetApp): Promise<Response>;
//# sourceMappingURL=adapter.d.ts.map