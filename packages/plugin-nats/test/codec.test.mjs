// Unit tests for the dependency-free NATS protocol codec and config validation.
// Pure/offline — no broker required. Run with: npm test -w packages/plugin-nats
//
// Exercises the testable seams exported by the plugin: encodeConnect, encodePub,
// encodeSub, encodeUnsub, parseFrame (incremental), isValidSubject, and
// validateNatsConfig.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeConnect, encodePub, encodeSub, encodeUnsub, parseFrame,
  isValidSubject, validateNatsConfig, natsPluginManifest,
  NATS_PLUGIN_NAME,
} from '../dist/index.js';

const s = (buf) => buf.toString('utf8');

describe('encodeConnect', () => {
  it('emits a CONNECT line with a JSON body and trailing CRLF', () => {
    const line = s(encodeConnect({ name: 'svc' }));
    assert.ok(line.startsWith('CONNECT {'));
    assert.ok(line.endsWith('\r\n'));
    const body = JSON.parse(line.slice('CONNECT '.length).trim());
    assert.equal(body.name, 'svc');
    assert.equal(body.lang, 'typescript');
    assert.equal(body.verbose, false);
  });

  it('includes auth_token when a token is supplied', () => {
    const body = JSON.parse(s(encodeConnect({ token: 'secret' })).slice('CONNECT '.length).trim());
    assert.equal(body.auth_token, 'secret');
  });
});

describe('encodePub', () => {
  it('frames subject, byte count, payload, and CRLFs', () => {
    const out = s(encodePub('orders.created', 'hi'));
    assert.equal(out, 'PUB orders.created 2\r\nhi\r\n');
  });

  it('includes a reply subject when provided', () => {
    const out = s(encodePub('req', 'x', 'inbox.1'));
    assert.equal(out, 'PUB req inbox.1 1\r\nx\r\n');
  });

  it('uses the byte length, not the string length, for multibyte payloads', () => {
    const out = encodePub('s', '€'); // 3 UTF-8 bytes
    assert.ok(s(out).startsWith('PUB s 3\r\n'));
  });

  it('rejects an invalid subject', () => {
    assert.throws(() => encodePub('bad subject', 'x'), /invalid subject/);
  });
});

describe('encodeSub / encodeUnsub', () => {
  it('encodes SUB without and with a queue group', () => {
    assert.equal(s(encodeSub('a.b', 1)), 'SUB a.b 1\r\n');
    assert.equal(s(encodeSub('a.b', 2, 'workers')), 'SUB a.b workers 2\r\n');
  });

  it('encodes UNSUB without and with a max', () => {
    assert.equal(s(encodeUnsub(3)), 'UNSUB 3\r\n');
    assert.equal(s(encodeUnsub(3, 10)), 'UNSUB 3 10\r\n');
  });
});

describe('isValidSubject', () => {
  it('accepts dotted tokens and rejects whitespace/empty', () => {
    assert.equal(isValidSubject('orders.created'), true);
    assert.equal(isValidSubject('a.*.c'), true);
    assert.equal(isValidSubject(''), false);
    assert.equal(isValidSubject('a b'), false);
  });
});

describe('parseFrame', () => {
  it('parses PING, PONG, +OK', () => {
    assert.equal(parseFrame(Buffer.from('PING\r\n')).frame.kind, 'PING');
    assert.equal(parseFrame(Buffer.from('PONG\r\n')).frame.kind, 'PONG');
    assert.equal(parseFrame(Buffer.from('+OK\r\n')).frame.kind, 'OK');
  });

  it('parses -ERR with the message unquoted', () => {
    const r = parseFrame(Buffer.from("-ERR 'Authorization Violation'\r\n"));
    assert.equal(r.frame.kind, 'ERR');
    assert.equal(r.frame.message, 'Authorization Violation');
  });

  it('parses INFO into an object', () => {
    const r = parseFrame(Buffer.from('INFO {"server_id":"abc","max_payload":1048576}\r\n'));
    assert.equal(r.frame.kind, 'INFO');
    assert.equal(r.frame.info.server_id, 'abc');
  });

  it('parses a MSG with payload and consumes the trailing CRLF', () => {
    const wire = Buffer.from('MSG orders.created 7 5\r\nhello\r\n');
    const r = parseFrame(wire);
    assert.equal(r.frame.kind, 'MSG');
    assert.equal(r.frame.subject, 'orders.created');
    assert.equal(r.frame.sid, 7);
    assert.equal(r.frame.payload.toString('utf8'), 'hello');
    assert.equal(r.next, wire.length);
  });

  it('parses a MSG that carries a reply subject', () => {
    const r = parseFrame(Buffer.from('MSG req 1 inbox.9 2\r\nok\r\n'));
    assert.equal(r.frame.reply, 'inbox.9');
    assert.equal(r.frame.payload.toString('utf8'), 'ok');
  });

  it('returns null when the control line is incomplete', () => {
    assert.equal(parseFrame(Buffer.from('MSG a 1 5\r')), null);
  });

  it('returns null when the MSG payload has not fully arrived', () => {
    assert.equal(parseFrame(Buffer.from('MSG a 1 5\r\nhel')), null);
  });

  it('throws on an unsupported op', () => {
    assert.throws(() => parseFrame(Buffer.from('BOGUS x\r\n')), /unsupported protocol op/);
  });

  it('round-trips two concatenated frames via the offset advance', () => {
    const wire = Buffer.concat([Buffer.from('PING\r\n'), Buffer.from('MSG s 1 2\r\nhi\r\n')]);
    const first = parseFrame(wire, 0);
    assert.equal(first.frame.kind, 'PING');
    const second = parseFrame(wire.subarray(first.next), 0);
    assert.equal(second.frame.kind, 'MSG');
    assert.equal(second.frame.payload.toString('utf8'), 'hi');
  });
});

describe('validateNatsConfig', () => {
  it('accepts a minimal valid config', () => {
    const cfg = validateNatsConfig({ host: 'localhost', port: 4222 });
    assert.equal(cfg.host, 'localhost');
    assert.equal(cfg.port, 4222);
  });

  it('rejects a missing/empty host', () => {
    assert.throws(() => validateNatsConfig({ port: 4222 }), /"host" is required/);
  });

  it('rejects an out-of-range port', () => {
    assert.throws(() => validateNatsConfig({ host: 'h', port: 70000 }), /"port"/);
  });

  it('requires user and pass together', () => {
    assert.throws(() => validateNatsConfig({ host: 'h', port: 4222, user: 'a' }), /provided together/);
  });

  it('accepts user+pass when both present', () => {
    const cfg = validateNatsConfig({ host: 'h', port: 4222, user: 'a', pass: 'b' });
    assert.equal(cfg.user, 'a');
    assert.equal(cfg.pass, 'b');
  });
});

describe('manifest', () => {
  it('declares the expected name, capabilities, and permissions', () => {
    const m = natsPluginManifest();
    assert.equal(m.name, NATS_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['messaging', 'pubsub', 'nats']);
    assert.deepEqual(m.permissions, ['net', 'middleware']);
  });
});
