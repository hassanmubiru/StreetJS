import type { Publisher } from './types.js';
/** SHA-256 hex of an API key. Used to register and to look up publishers. */
export declare function hashApiKey(apiKey: string): string;
/**
 * Derive a plugin's namespace from its name. The namespace is the portion
 * before the first `/`, with a leading `@` removed. A name with no `/` is its
 * own namespace.
 */
export declare function namespaceOf(name: string): string;
/** Extract the raw bearer token from an `Authorization` header value. */
export declare function parseBearer(header: string | undefined): string | undefined;
/**
 * In-memory publisher directory. Authenticates bearer keys and authorizes
 * namespace ownership. Tokens are matched by hash so raw keys are never stored.
 */
export declare class PublisherDirectory {
    private readonly byHash;
    /** Register a publisher by raw API key + owned namespaces. */
    register(id: string, apiKey: string, namespaces: string[]): Publisher;
    /** Register a publisher whose API key hash is already known. */
    registerHashed(publisher: Publisher): void;
    /** Resolve a publisher from a raw bearer key, or `undefined` if unknown (Req 4.9). */
    authenticate(apiKey: string | undefined): Publisher | undefined;
    /** True iff the publisher owns the namespace of `pluginName` (Req 4.9). */
    authorize(publisher: Publisher, pluginName: string): boolean;
}
//# sourceMappingURL=auth.d.ts.map