import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type ClientHttp2Session, type ClientHttp2Stream, type ServerHttp2Stream } from 'node:http2';

import { createContainer } from '../core/container.js';
import { streetHttp2App, type StreetHttp2App } from '../microservices/http2.js';

const TIMEOUT_MS = 2_000;

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function request(session: ClientHttp2Session, path: string): Promise<{ body: string; stream: ClientHttp2Stream }> {
  const stream = session.request({ ':method': 'GET', ':path': path });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.once('response', () => undefined);
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.once('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), stream }));
    stream.once('error', reject);
    stream.end();
  });
}

test('HTTP/2 TLS request lifecycle remains bounded across completion, reset, reuse, and drain', async (t) => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      t.skip('SKIP: openssl unavailable; TLS certificate generation cannot run');
      return;
    }
    throw error;
  }

  const directory = mkdtempSync(join(tmpdir(), 'street-http2-'));
  try {
    const keyPath = join(directory, 'key.pem');
    const certPath = join(directory, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
      '-keyout', keyPath, '-out', certPath, '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1',
    ], { stdio: 'ignore' });

    const container = createContainer();
    const app: StreetHttp2App = streetHttp2App({
      key: readFileSync(keyPath), cert: readFileSync(certPath), container,
      containerOwnership: 'app', requestScope: true,
    });
    const scopeToken = Symbol('http2-request-scope');
    let disposed = 0;
    container.registerFactory(scopeToken, () => ({ close: () => { disposed++; } }), 'scoped');
    let normal!: { signal: AbortSignal; req: import('node:http').IncomingMessage };
    let resetRequest!: { signal: AbortSignal; req: import('node:http').IncomingMessage };
    let resetStarted!: () => void;
    const resetEntered = new Promise<void>((resolve) => { resetStarted = resolve; });
    let release!: () => void;
    const holdRelease = new Promise<void>((resolve) => { release = resolve; });
    let holdEntered!: () => void;
    const holdStarted = new Promise<void>((resolve) => { holdEntered = resolve; });
    const observedStreams = new Map<string, ServerHttp2Stream>();
    const streamClosed = new Map<string, Promise<void>>();
    const onStream = (stream: ServerHttp2Stream, headers: Record<string, string | undefined>): void => {
      const path = String(headers[':path'] ?? '').split('?')[0];
      observedStreams.set(path, stream);
      streamClosed.set(path, new Promise<void>((resolve) => {
        stream.once('close', () => setImmediate(resolve));
      }));
    };
    app.server.on('stream', onStream);
    app.use(async (ctx) => {
      ctx.container?.resolve(scopeToken);
      if (ctx.req.url === '/normal') {
        normal = { signal: ctx.signal, req: ctx.req };
        ctx.text('normal');
      } else if (ctx.req.url === '/reset') {
        resetRequest = { signal: ctx.signal, req: ctx.req };
        resetStarted();
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) resolve();
          else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } else if (ctx.req.url === '/hold') {
        holdEntered();
        await holdRelease;
        ctx.text('released');
      } else {
        ctx.text('usable');
      }
    });

    await bounded(app.listen(0, '127.0.0.1'), 'HTTP/2 listen');
    const address = app.server.address();
    assert.ok(address && typeof address !== 'string');
    const session = connect(`https://127.0.0.1:${address.port}`, { rejectUnauthorized: false });
    session.on('error', () => undefined);
    await bounded(new Promise<void>((resolve) => session.once('connect', resolve)), 'HTTP/2 connect');

    const normalResponse = await bounded(request(session, '/normal'), 'normal response');
    assert.equal(normalResponse.body, 'normal');
    assert.equal(normal.signal.aborted, false);
    assert.equal(normal.req.listenerCount('aborted'), 0);
    assert.equal(normal.req.listenerCount('close'), 0);
    assert.equal(disposed, 1);
    await bounded(streamClosed.get('/normal') ?? Promise.reject(new Error('normal stream not observed')), 'normal stream close');
    assert.equal(observedStreams.get('/normal')?.listenerCount('data'), 0);
    assert.equal(observedStreams.get('/normal')?.listenerCount('end'), 0);
    assert.equal(observedStreams.get('/normal')?.listenerCount('close'), 0);
    assert.equal(observedStreams.get('/normal')?.listenerCount('aborted'), 0);

    const resetStream = session.request({ ':method': 'GET', ':path': '/reset' });
    resetStream.on('error', () => undefined);
    resetStream.end();
    await bounded(resetEntered, 'reset handler entry');
    resetStream.close(0x8);
    await bounded(new Promise<void>((resolve) => {
      const check = (): void => {
        if (disposed >= 2) resolve();
        else setImmediate(check);
      };
      check();
    }), 'reset scope disposal');
    assert.equal(disposed, 2);
    assert.equal(resetRequest.signal.aborted, true);
    assert.equal(resetRequest.req.listenerCount('aborted'), 0);
    assert.equal(resetRequest.req.listenerCount('close'), 0);
    await bounded(streamClosed.get('/reset') ?? Promise.reject(new Error('reset stream not observed')), 'reset stream close');
    assert.equal(observedStreams.get('/reset')?.listenerCount('data'), 0);
    assert.equal(observedStreams.get('/reset')?.listenerCount('end'), 0);
    assert.equal(observedStreams.get('/reset')?.listenerCount('close'), 0);
    assert.equal(observedStreams.get('/reset')?.listenerCount('aborted'), 0);

    const usable = await bounded(request(session, '/usable'), 'post-reset response');
    assert.equal(usable.body, 'usable');
    assert.equal(disposed, 3);

    const holdResponse = request(session, '/hold');
    await bounded(holdStarted, 'active handler entry');
    const closePromise = app.close();
    assert.equal(app.lifecycleState, 'DRAINING');
    release();
    assert.equal((await bounded(holdResponse, 'released response')).body, 'released');
    session.close();
    await bounded(closePromise, 'graceful HTTP/2 close');
    app.server.off('stream', onStream);
    assert.equal(app.lifecycleState, 'CLOSED');
    assert.equal(disposed, 4);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
