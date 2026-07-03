/**
 * @streetjs/gateway
 *
 * StreetJS Core v2 — API Gateway & Edge Framework. Additive package layered over
 * the `streetjs` core. The base entry re-exports the public surface as modules
 * are implemented. It imports no cloud SDK and no sibling pillar package directly;
 * pillar integration is optional and structural.
 */

/** Package version marker. */
export const GATEWAY_PACKAGE_NAME = "@streetjs/gateway" as const;
export const GATEWAY_FRAMEWORK_VERSION = "0.1.0" as const;
