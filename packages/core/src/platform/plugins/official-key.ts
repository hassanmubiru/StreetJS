// packages/core/src/platform/plugins/official-key.ts
// The official StreetJS plugin-signing public key (Ed25519, SPKI PEM).
//
// Every official `@streetjs/plugin-*` package ships a manifest signed in CI with
// the corresponding private key (held only as the STREET_PLUGIN_SIGNING_KEY
// secret). Consumers verify those signatures against this public key. It is the
// public half of an Ed25519 keypair — safe to embed and distribute.

import { createPublicKey, type KeyObject } from 'node:crypto';

/** PEM (SPKI) of the official StreetJS plugin-signing public key. */
export const OFFICIAL_PLUGIN_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAaA5REx8qF/ID/Hwc9CcI10/FVqAEAMt21rX7f3YWiBc=
-----END PUBLIC KEY-----
`;

/** The official plugin-signing public key as a node:crypto KeyObject. */
export function officialPluginPublicKey(): KeyObject {
  return createPublicKey(OFFICIAL_PLUGIN_PUBLIC_KEY_PEM);
}
