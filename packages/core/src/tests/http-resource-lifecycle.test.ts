import assert from 'node:assert/strict';
import { request } from 'node:http';
import { streetApp } from '../http/server.js';
import { streetHttp2App } from '../microservices/http2.js';
import { defineHttpResourceLifecycleConformance } from './helpers/http-resource-lifecycle.js';

async function requestHttp1(app: ReturnType<typeof streetApp>, probe: { request?: import('node:http').IncomingMessage }): Promise<void> {
  await app.listen(0, '127.0.0.1');
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP/1 listener did not expose an address');
  await new Promise<void>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: address.port, path: '/', headers: { connection: 'close' } }, (res) => {
      res.resume();
      res.once('end', resolve);
    });
    req.once('error', reject);
    req.end();
  });
  assert.ok(probe.request);
}

defineHttpResourceLifecycleConformance({
  name: 'HTTP/1.1',
  createApp: () => streetApp({ containerOwnership: 'app', requestScope: true }),
  request: requestHttp1,
});

// HTTP/2 conformance is exercised without TLS here; network coverage belongs
// to the TLS integration suite because createSecureServer requires credentials.
defineHttpResourceLifecycleConformance({
  name: 'HTTP/2',
  createApp: () => streetHttp2App({ containerOwnership: 'app' }),
});
