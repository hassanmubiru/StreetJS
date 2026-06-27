// PayPal webhook signature verification (Outstanding Action #9). Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { verifyPayPalWebhook } from '../dist/index.js';

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xed_b8_83_20 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const headers = { transmissionId: 'tx-1', transmissionTime: '2026-01-01T00:00:00Z', webhookId: 'WH-1' };
const body = '{"event_type":"PAYMENT.CAPTURE.COMPLETED"}';

function signedHeaders(h, rawBody) {
  const data = `${h.transmissionId}|${h.transmissionTime}|${h.webhookId}|${crc32(Buffer.from(rawBody))}`;
  const s = createSign('RSA-SHA256');
  s.update(data); s.end();
  return { ...h, signature: s.sign(privateKey).toString('base64') };
}

describe('verifyPayPalWebhook', () => {
  it('accepts a valid signature (public-key PEM)', () => {
    assert.equal(verifyPayPalWebhook(pubPem, signedHeaders(headers, body), body), true);
  });
  it('rejects a tampered body', () => {
    assert.equal(verifyPayPalWebhook(pubPem, signedHeaders(headers, body), body + 'x'), false);
  });
  it('rejects tampered transmission metadata', () => {
    const good = signedHeaders(headers, body);
    assert.equal(verifyPayPalWebhook(pubPem, { ...good, webhookId: 'WH-2' }, body), false);
  });
  it('rejects empty / malformed inputs', () => {
    assert.equal(verifyPayPalWebhook('', signedHeaders(headers, body), body), false);
    assert.equal(verifyPayPalWebhook(pubPem, { ...headers, signature: '' }, body), false);
    assert.equal(verifyPayPalWebhook(pubPem, { transmissionId: '', transmissionTime: '', webhookId: '', signature: 'x' }, body), false);
  });
});
