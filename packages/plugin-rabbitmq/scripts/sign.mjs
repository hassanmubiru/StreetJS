// Build step: produce manifest.signed.json from manifest.json.
//
// Signs the plugin manifest with an Ed25519 private key using the framework's
// `signManifest()` (checksum + signature). The signing key is taken from
// STREET_PLUGIN_SIGNING_KEY (a PEM-encoded PKCS#8 Ed25519 private key) when
// present; otherwise an ephemeral keypair is generated for local/dev builds and
// its public key is written next to the signed manifest so the signature can be
// verified. Pure Node — no third-party dependencies.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { signManifest, verifyManifest } from 'streetjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(pkgRoot, 'manifest.json');
const signedPath = join(pkgRoot, 'manifest.signed.json');
const pubPath = join(pkgRoot, 'manifest.pub');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

let privateKey;
let publicKey;
const envKey = process.env.STREET_PLUGIN_SIGNING_KEY;
if (envKey && envKey.trim() !== '') {
  privateKey = createPrivateKey(envKey);
  publicKey = createPublicKey(privateKey);
} else {
  ({ privateKey, publicKey } = generateKeyPairSync('ed25519'));
  console.warn('[sign] STREET_PLUGIN_SIGNING_KEY not set — using an ephemeral dev keypair.');
}

const signed = signManifest(manifest, privateKey);
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

if (!verifyManifest(signed, publicKey)) {
  console.error('[sign] FATAL: produced signature failed verification.');
  process.exit(1);
}

writeFileSync(signedPath, JSON.stringify(signed, null, 2) + '\n');
writeFileSync(pubPath, pubPem);
console.log(`[sign] wrote ${signedPath} (checksum ${signed.checksum.slice(0, 12)}…)`);
