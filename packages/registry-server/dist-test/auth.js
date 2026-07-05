// @streetjs/registry-server — authentication & authorization model.
//
// AUTHN MODEL (Req 4.9): publish requests MUST present a bearer token in the
// `Authorization: Bearer <api-key>` header. The raw API key is never persisted;
// publishers are registered by a scrypt hash of their key (`apiKeyHash`).
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
import { scryptSync } from 'node:crypto';
// API keys are hashed with a deliberately slow KDF (scrypt) rather than a fast
// digest, so that leaking the publisher directory does not let an attacker
// brute-force operator-chosen keys (CWE-916). The salt is a deterministic
// application pepper — overridable via STREET_REGISTRY_KEY_SALT — which keeps
// the hash a pure function of the key so the directory can look publishers up
// by hash in O(1) and operators may precompute hashes offline.
const API_KEY_SALT = process.env['STREET_REGISTRY_KEY_SALT'] ?? 'streetjs-registry::api-key::v1';
/** scrypt-derived hex of an API key. Used to register and to look up publishers. */
export function hashApiKey(apiKey) {
    return scryptSync(apiKey, API_KEY_SALT, 32).toString('hex');
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
    const trimmed = header.trim();
    // Anchored prefix test only (no unbounded backtracking); then slice off the
    // 6-char "Bearer" word and the following whitespace. Avoids `/^Bearer\s+(.+)$/`
    // polynomial ReDoS on inputs like "Bearer " + many spaces.
    if (!/^Bearer\s/i.test(trimmed))
        return undefined;
    const token = trimmed.slice(6).trimStart();
    return token.length > 0 ? token : undefined;
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