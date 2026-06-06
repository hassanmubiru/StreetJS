export { StreetException, BadRequestException, UnauthorizedException, ForbiddenException, NotFoundException, ConflictException, UnprocessableException, InternalException, ServiceUnavailableException, DatabaseConnectionError, FeatureUnavailableInEdgeRuntimeError, isStreetException, } from './http/exceptions.js';
export { sanitizeString, sanitizeDeep, escapeHtml } from './security/xss.js';
export { LruCache } from './cache/lru.js';
export type { LruOptions } from './cache/lru.js';
/**
 * The runtime this build targets. Useful for guards in isomorphic code:
 *
 *   import { STREET_BUILD_TARGET } from '@streetjs/core';
 *   if (STREET_BUILD_TARGET === 'browser') { ... }
 */
export declare const STREET_BUILD_TARGET: "browser";
//# sourceMappingURL=browser.d.ts.map