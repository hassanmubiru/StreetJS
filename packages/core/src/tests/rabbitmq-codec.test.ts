// tests/rabbitmq-codec.test.ts
// Broker-independent unit tests for the AMQP 0-9-1 wire codec.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AmqpWriter, AmqpReader, buildFrame, buildMethodFrame, buildHeaderFrame,
  buildBodyFrame, buildHeartbeat, FrameDecoder, readMethodHeader,
  FRAME_METHOD, FRAME_HEADER, FRAME_BODY, FRAME_HEARTBEAT, FRAME_END, PROTOCOL_HEADER,
} from '../transports/rabbitmq/codec.js';

describe('AMQP codec — field encoding', () => {
  it('round-trips octet, shortUint, longUint, longLong', () => {
    const buf = new AmqpWriter().octet(7).shortUint(258).longUint(70000).longLong(9_000_000_000n).build();
    const r = new AmqpReader(buf);
    assert.equal(r.octet(), 7);
    assert.equal(r.shortUint(), 258);
    assert.equal(r.longUint(), 70000);
    assert.equal(r.longLong(), 9_000_000_000n);
  });

  it('round-trips short and long strings', () => {
    const buf = new AmqpWriter().shortStr('queue.name').longStr('a longer payload string').build();
    const r = new AmqpReader(buf);
    assert.equal(r.shortStr(), 'queue.name');
    assert.equal(r.longStr().toString('utf8'), 'a longer payload string');
  });

  it('rejects short strings over 255 bytes', () => {
    assert.throws(() => new AmqpWriter().shortStr('x'.repeat(256)));
  });

  it('encodes a field table that the server-side skip can consume', () => {
    const buf = new AmqpWriter()
      .table({ 'x-dead-letter-exchange': 'dlx', 'x-message-ttl': 60000, durable: true })
      .shortStr('after')
      .build();
    const r = new AmqpReader(buf);
    r.skipTable();
    assert.equal(r.shortStr(), 'after');
  });

  it('packs bits LSB-first', () => {
    const buf = new AmqpWriter().bits(true, false, true).build(); // 0b101 = 5
    assert.equal(new AmqpReader(buf).octet(), 5);
  });
});

describe('AMQP codec — frame framing', () => {
  it('builds a frame with the correct header and 0xCE terminator', () => {
    const frame = buildFrame(FRAME_METHOD, 1, Buffer.from('hello'));
    assert.equal(frame.readUInt8(0), FRAME_METHOD);
    assert.equal(frame.readUInt16BE(1), 1);
    assert.equal(frame.readUInt32BE(3), 5);
    assert.equal(frame.readUInt8(frame.length - 1), FRAME_END);
  });

  it('FrameDecoder yields complete frames and waits for partial ones', () => {
    const f1 = buildMethodFrame(1, 10, 11, new AmqpWriter().shortStr('ok').build());
    const f2 = buildHeartbeat();
    const dec = new FrameDecoder();
    dec.push(f1.subarray(0, 4)); // partial
    assert.equal(dec.next(), null);
    dec.push(f1.subarray(4));
    const frame1 = dec.next();
    assert.ok(frame1);
    assert.equal(frame1!.type, FRAME_METHOD);
    const { classId, methodId, reader } = readMethodHeader(frame1!.payload);
    assert.equal(classId, 10);
    assert.equal(methodId, 11);
    assert.equal(reader.shortStr(), 'ok');
    dec.push(f2);
    assert.equal(dec.next()!.type, FRAME_HEARTBEAT);
  });

  it('header + body frames carry the declared body size', () => {
    const body = Buffer.from('payload-bytes');
    const header = buildHeaderFrame(1, 60, body.length, { contentType: 'application/json', deliveryMode: 2 });
    const bodyFrame = buildBodyFrame(1, body);
    const dec = new FrameDecoder();
    dec.push(Buffer.concat([header, bodyFrame]));
    const h = dec.next()!;
    assert.equal(h.type, FRAME_HEADER);
    assert.equal(Number(h.payload.readBigUInt64BE(4)), body.length);
    const b = dec.next()!;
    assert.equal(b.type, FRAME_BODY);
    assert.equal(b.payload.toString('utf8'), 'payload-bytes');
  });

  it('protocol header is the AMQP 0-9-1 preamble', () => {
    assert.deepEqual([...PROTOCOL_HEADER], [0x41, 0x4d, 0x51, 0x50, 0, 0, 9, 1]);
  });
});
