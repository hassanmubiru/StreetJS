import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ParsedFile } from '../multipart/parser.js';
export interface StreetContext {
    /** Raw Node.js request */
    readonly req: IncomingMessage;
    /** Raw Node.js response */
    readonly res: ServerResponse;
    /** Parsed URL path */
    readonly path: string;
    /** HTTP method (uppercase) */
    readonly method: string;
    /** Extracted route params e.g. { id: "123" } */
    params: Record<string, string>;
    /** Parsed query string */
    readonly query: Record<string, string>;
    /** Parsed request headers (lowercase keys) */
    readonly headers: Record<string, string>;
    /** Parsed request body (JSON or form) */
    body: unknown;
    /** Uploaded files from multipart parsing */
    files: ParsedFile[];
    /** Arbitrary state bag for middleware communication */
    state: Record<string, unknown>;
    /** Authenticated user (set by auth middleware) */
    user: AuthenticatedUser | null;
    /** Request start time (hrtime bigint) */
    readonly startTime: bigint;
    /** Send JSON response */
    json(data: unknown, status?: number): void;
    /** Send plain text response */
    text(data: string, status?: number): void;
    /** Send HTML response */
    html(data: string, status?: number): void;
    /** Send empty response with status */
    send(status: number): void;
    /** Set a response header */
    setHeader(name: string, value: string): void;
    /** Get a request cookie value */
    cookie(name: string): string | undefined;
    /** Set a response cookie */
    setCookie(name: string, value: string, options?: CookieOptions): void;
    /** Check if response has been sent */
    readonly sent: boolean;
}
export interface AuthenticatedUser {
    id: string;
    email: string;
    roles: string[];
}
export interface CookieOptions {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    maxAge?: number;
    path?: string;
    domain?: string;
}
export declare function createContext(req: IncomingMessage, res: ServerResponse, path: string, query: Record<string, string>): StreetContext;
//# sourceMappingURL=context.d.ts.map