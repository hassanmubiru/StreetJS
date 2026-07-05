// @streetjs/registry-server — public entry point.
//
// The Street Framework Network Plugin Registry (Req 4). A network-accessible
// service that hosts, indexes, and serves signed plugins with secure publish and
// public install flows. It reuses the core signing/pagination primitives from
// `streetjs` (verifyManifest, manifestChecksum, signManifest, PluginManifest,
// normalizePageSize) so the registry and the framework agree, byte-for-byte, on
// what a valid signed manifest is.
//
// SECURITY MODEL (declared, Req 4.9):
//  - AuthN: bearer-token. Publish requires `Authorization: Bearer <api-key>`;
//    only the SHA-256 hash of an API key is stored.
//  - AuthZ: namespace ownership. A publisher may only publish plugins whose
//    namespace it owns (`@acme/x` and `acme/x` → namespace `acme`).
//  - Reads (download/verify/search/list/versions) are public.
export { RegistryService, isRegistryError } from './registry.js';
export { RegistryStore } from './store.js';
export { PublisherDirectory, hashApiKey, namespaceOf, parseBearer } from './auth.js';
export { validateManifestMetadata, asManifest } from './validation.js';
export { createRegistryServer, startRegistryServer, createRequestHandler, statusForError, } from './server.js';
// Re-export the reused core primitives for convenience so consumers of the
// registry can sign/verify without a second import.
export { verifyManifest, manifestChecksum, signManifest, normalizePageSize } from 'streetjs';
//# sourceMappingURL=index.js.map