// Build step: produce manifest.signed.json from manifest.json (Ed25519).
// STREET_PLUGIN_SIGNING_KEY (PKCS#8 PEM) is used when set; otherwise an
// ephemeral dev keypair is generated and its public key written alongside.
// Pure Node — no third-party dependencies.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { signManifest, verifyManifest } from 'streetjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(pkgRoot, 'manifest.json'), 'utf8'));

let privateKey, publicKey;
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
writeFileSync(join(pkgRoot, 'manifest.signed.json'), JSON.stringify(signed, null, 2) + '\n');
writeFileSync(join(pkgRoot, 'manifest.pub'), pubPem);
console.log(`[sign] wrote manifest.signed.json (checksum ${signed.checksum.slice(0, 12)}…)`);
