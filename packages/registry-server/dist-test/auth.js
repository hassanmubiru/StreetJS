// @streetjs/registry-server — authentication & authorization model.
//
// AUTHN MODEL (Req 4.9): publish requests MUST present a bearer token in the
// `Authorization: Bearer <api-key>` header. The raw API key is never persisted;
// publishers are registered by the SHA-256 hash of their key (`apiKeyHash`).
// A request authenticates iff its presented key hashes to a known publisher.
//
// AUTHZ MODEL (Req 4.9): a publisher owns a set of namespaces. The namespace of
// a plugin is the segment before the first `/`, with a leading `@` stripped
// (so `@acme/widgets` and `acme/widgets` both belong to namespace `acme`, and a
// bare `widgets` belongs to namespace `widgets`). A publisher is authorized to
// publish a plugin iff it owns that plugin's namespace.
//
// READS ARE PUBLIC: download / verify / search / list / versions require no
// authentication. Only publish is gated.
import { createHash } from 'node:crypto';
/** SHA-256 hex of an API key. Used to register and to look up publishers. */
export function hashApiKey(apiKey) {
    return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}
/**
 * Derive a plugin's namespace from its name. The namespace is the portion
 * before the first `/`, with a leading `@` removed. A name with no `/` is its
 * own namespace.
 */
export function namespaceOf(name) {
    const trimmed = name.trim();
    const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    const slash = stripped.indexOf('/');
    return slash === -1 ? stripped : stripped.slice(0, slash);
}
/** Extract the raw bearer token from an `Authorization` header value. */
export function parseBearer(header) {
    if (!header)
        return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : undefined;
}
/**
 * In-memory publisher directory. Authenticates bearer keys and authorizes
 * namespace ownership. Tokens are matched by hash so raw keys are never stored.
 */
export class PublisherDirectory {
    byHash = new Map();
    /** Register a publisher by raw API key + owned namespaces. */
    register(id, apiKey, namespaces) {
        const publisher = {
            id,
            apiKeyHash: hashApiKey(apiKey),
            namespaces: [...namespaces],
        };
        this.byHash.set(publisher.apiKeyHash, publisher);
        return publisher;
    }
    /** Register a publisher whose API key hash is already known. */
    registerHashed(publisher) {
        this.byHash.set(publisher.apiKeyHash, { ...publisher, namespaces: [...publisher.namespaces] });
    }
    /** Resolve a publisher from a raw bearer key, or `undefined` if unknown (Req 4.9). */
    authenticate(apiKey) {
        if (!apiKey)
            return undefined;
        return this.byHash.get(hashApiKey(apiKey));
    }
    /** True iff the publisher owns the namespace of `pluginName` (Req 4.9). */
    authorize(publisher, pluginName) {
        return publisher.namespaces.includes(namespaceOf(pluginName));
    }
}
//# sourceMappingURL=auth.js.map