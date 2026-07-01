// src/security.ts
// Internal barrel re-exporting the connection-authentication and rate-limiting
// primitives the Realtime_Facade composes. Keeping the facade's security-related
// imports behind a single module keeps `facade.ts` focused and gives one place
// to evolve the auth/rate-limit surface the facade depends on.

export { createRealtimeUpgradeAuth } from './auth.js';
export type { ChannelAuthorizer, RealtimeUpgradeAuth } from './auth.js';
export { RateLimiter } from './ratelimit.js';
export type { RateLimitConfig } from './ratelimit.js';
