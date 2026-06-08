# Mutual TLS (mTLS)

Street ships first-class mutual-TLS support built only on Node's `node:https`,
`node:tls`, and `node:crypto` — no third-party dependencies. It covers three
common deployment needs:

1. **CA-verified client certificates** — only clients presenting a certificate
   signed by a trusted CA may connect.
2. **Certificate pinning** — accept a specific set of SHA-256 fingerprints,
   including self-signed client certs that are not part of any CA chain.
3. **Common-Name allow-listing** — restrict access to an explicit set of subject
   CNs (e.g. service identities in a mesh).

All helpers are exported from `@streetjs/core`.

## API

| Export | Description |
| --- | --- |
| `createMutualTlsServer(opts, handler)` | HTTPS server with `requestCert: true`. |
| `clientCertMiddleware(policy)` | Enforces a `ClientCertPolicy` on the request socket. |
| `validateClientCert(cert, authorized, policy)` | Pure, unit-testable policy check. |
| `certificateFingerprint(der)` | SHA-256 fingerprint (lowercase hex) of a DER cert. |
| `verifyCertificatePin(der, pins)` | Constant-time pin match (colon/case-insensitive). |
| `TrustStore` | Mutable set of trusted client CAs + pinned fingerprints, with rotation. |
| `rotateServerCertificate(server, opts)` | Hot-swap the server cert/key/CA with no restart. |

### `ClientCertPolicy`

```ts
interface ClientCertPolicy {
  required?: boolean;              // default true
  allowedFingerprints?: string[];  // SHA-256 pins (with or without colons)
  allowedCommonNames?: string[];   // subject CN allow-list
}
```

When `allowedFingerprints` is set, a matching pin is sufficient and bypasses CA
trust — this is how you accept self-signed pinned client certs. Otherwise the
TLS chain must be CA-authorized (`TLSSocket.authorized === true`).

## Quick start

```ts
import { readFileSync } from 'node:fs';
import { createMutualTlsServer, clientCertMiddleware } from '@streetjs/core';

const server = createMutualTlsServer(
  {
    cert: readFileSync('server.crt'),
    key: readFileSync('server.key'),
    ca: readFileSync('ca.crt'),       // CA used to verify client certs
    rejectUnauthorized: true,          // TLS layer rejects untrusted clients
  },
  (req, res) => {
    clientCertMiddleware({ allowedCommonNames: ['payments-svc'] })(
      { req, state: {} },
      async () => undefined,
    )
      .then(() => { res.writeHead(200); res.end('authorized'); })
      .catch(() => { res.writeHead(401); res.end('denied'); });
  },
);

server.listen(8443, '0.0.0.0');
```

On success the middleware stores `{ subjectCN, fingerprint }` in
`ctx.state['clientCert']` for downstream handlers.

## Certificate pinning (self-signed clients)

Set `rejectUnauthorized: false` on the server so the TLS layer defers the
decision, then pin in the middleware:

```ts
const server = createMutualTlsServer(
  { cert, key, ca, rejectUnauthorized: false },
  (req, res) => {
    clientCertMiddleware({
      allowedFingerprints: ['AA:BB:CC:...'], // SHA-256, colons optional
    })({ req, state: {} }, async () => undefined)
      .then(() => { res.writeHead(200); res.end('ok'); })
      .catch(() => { res.writeHead(401); res.end('denied'); });
  },
);
```

## Computing a pin

```ts
import { certificateFingerprint } from '@streetjs/core';
// der: the raw DER bytes of the peer certificate (e.g. cert.raw)
const pin = certificateFingerprint(der); // 64-char lowercase hex
```

Or with the CLI: `openssl x509 -in client.crt -outform der | openssl dgst -sha256`.

## Trust store

`TrustStore` holds a mutable set of trusted client CAs and pinned fingerprints.
It supports incremental add/remove and atomic `rotate()` so trust material can be
rolled without dropping the old set prematurely.

```ts
import { TrustStore } from '@streetjs/core';

const trust = new TrustStore({ ca: [readFileSync('ca.crt')], pins: ['AA:BB:...'] });
trust.addCa(readFileSync('ca-next.crt'));      // dual-trust during rollover
trust.addPin('CC:DD:...');

const result = trust.validate(peerCert, socket.authorized, {
  allowedCommonNames: ['payments-svc'],
});
if (!result.ok) throw new Error(result.reason);

// Atomically swap to a brand-new CA + pin set once the old certs are retired.
trust.rotate({ ca: [readFileSync('ca-next.crt')], pins: ['CC:DD:...'] });
```

## Certificate rotation (zero-downtime)

`rotateServerCertificate` uses Node's `tls.Server.setSecureContext` to swap the
server's certificate, key, and trusted client CAs **without restarting the
listener**. Existing connections keep their context; new handshakes use the new
material.

```ts
import { rotateServerCertificate } from '@streetjs/core';

// e.g. on a SIGHUP or a cert-manager renewal hook:
rotateServerCertificate(server, {
  cert: readFileSync('server.crt'),  // freshly renewed
  key: readFileSync('server.key'),
  ca: readFileSync('ca.crt'),        // optionally rotate the trusted client CA too
});
```

The rotation test (`mtls.test.ts`) proves this end-to-end: it starts a server
trusting CA-1, confirms a CA-1 client is accepted and a CA-2 client rejected,
rotates the trusted client CA to CA-2, then confirms the trust relationship has
inverted — all on the same running listener.

## Security notes

- Pin comparison is constant-time (`crypto.timingSafeEqual`) to avoid leaking
  fingerprint bytes via timing.
- Minimum TLS version defaults to `TLSv1.2`; pass `minVersion: 'TLSv1.3'` to
  require 1.3.
- CN allow-listing is applied **in addition** to CA trust / pinning, never as a
  replacement — a forged CN on an untrusted cert is still rejected.

## Verification

`packages/core/src/tests/mtls.test.ts` generates a real CA, server, and client
certificate with `openssl` and performs genuine mTLS handshakes:

- a client presenting a CA-signed cert is accepted (HTTP 200);
- a client with no certificate is rejected at the TLS layer;
- pinning, CN allow-listing, and the "required" flag are unit-tested against the
  pure `validateClientCert` function.

Run it:

```bash
cd packages/core
npx tsc
node --test dist/src/tests/mtls.test.js
```
