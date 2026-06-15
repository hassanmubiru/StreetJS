// Release-only signing step: produce manifest.signed.json from manifest.json
// (Ed25519). Invoked ONLY by `prepublishOnly` (during publish), never by `build`,
// so a local/CI `npm run build` never mutates committed signed manifests.
// STREET_PLUGIN_SIGNING_KEY (PKCS#8 PEM) is REQUIRED — the script fails loudly if
// absent, so an unsigned/ephemerally-signed package can never be published.
// Pure Node — no third-party dependencies.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { signManifest, verifyManifest } from 'streetjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(pkgRoot, 'manifest.json');
const signedPath = join(pkgRoot, 'manifest.signed.json');
const pubPath = join(pkgRoot, 'manifest.pub');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const envKey = process.env.STREET_PLUGIN_SIGNING_KEY;
if (!envKey || envKey.trim() === '') {
  console.error('[sign-manifest] FATAL: STREET_PLUGIN_SIGNING_KEY is not set. Signing runs only during release; refusing to sign with an ephemeral key.');
  process.exit(1);
}

const privateKey = createPrivateKey(envKey);
const publicKey = createPublicKey(privateKey);
const signed = signManifest(manifest, privateKey);
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
if (!verifyManifest(signed, publicKey)) {
  console.error('[sign-manifest] FATAL: produced signature failed verification.');
  process.exit(1);
}
writeFileSync(signedPath, JSON.stringify(signed, null, 2) + '\n');
writeFileSync(pubPath, pubPem);
console.log(`[sign-manifest] wrote ${signedPath} (checksum ${signed.checksum.slice(0, 12)}…)`);
