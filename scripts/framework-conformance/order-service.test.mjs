import { it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { JwtService } from 'streetjs';
import { createOrderService, listen, close } from '../../examples/reference-apps/order-service/server.mjs';

async function fixture(t) {
  const secret = randomBytes(32).toString('hex');
  const logs = [];
  const service = await listen({ jwtSecret: secret, logStream: { write: (line) => logs.push(line) } });
  t.after(() => close(service));
  const jwt = new JwtService(secret);
  const token = (roles, sub = 'customer-1', options = {}) => jwt.sign({ sub, roles }, { expiresInSeconds: 60, ...options });
  const request = (path, { bearer, body, raw, method = 'GET', ...headers } = {}) => fetch(
    `http://127.0.0.1:${service.app.server.address().port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  const writer = token(['writer']);
  const post = (body, bearer = writer, headers = {}) => request('/orders', { method: 'POST', body, bearer, ...headers });
  return { service, token, request, post, writer, logs };
}
const input = () => ({ requestKey: randomUUID(), sku: "SKU 'quoted'", quantity: 2 });

it('creates, audits and reads an order over HTTP with scoped resources and observability', async (t) => {
  const { service, post, request, token, logs } = await fixture(t);
  const body = input();
  const response = await post(body, undefined, { 'x-correlation-id': 'golden-path' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-correlation-id'), 'golden-path');
  const resource = response.headers.get('x-request-resource');
  assert.ok(resource);
  const { order } = await response.json();
  assert.equal(order.sku, body.sku);
  assert.equal(order.quantity, 2);
  const read = await request(`/orders/${order.id}`, { bearer: token(['reader']) });
  assert.equal(read.status, 200);
  assert.notEqual(read.headers.get('x-request-resource'), resource);
  assert.deepEqual(await read.json(), { order });
  const hidden = await request(`/orders/${order.id}`, { bearer: token(['reader'], 'other-customer') });
  assert.equal(hidden.status, 404);
  await hidden.json();
  const audit = await service.pool.query('SELECT * FROM order_audit');
  assert.deepEqual(audit.rows, [{ request_key: body.requestKey, order_id: order.id, actor_id: 'customer-1', correlation_id: 'golden-path' }]);
  for (const path of ['/health/live', '/health/ready']) {
    const probe = await request(path);
    assert.equal(probe.status, 200);
    assert.equal((await probe.json()).status, 'ok');
  }
  const metrics = await request('/metrics');
  assert.match(metrics.headers.get('content-type'), /text\/plain/);
  assert.match(await metrics.text(), /order_service_orders_total 1/);
  assert.equal(service.resources.created, service.resources.disposed);
  const entry = logs.map((line) => JSON.parse(line)).find((log) => log.message === 'order.created');
  assert.equal(entry.correlationId, 'golden-path');
  assert.equal(entry.orderId, order.id);
});

it('rejects missing, invalid, expired and reader-only credentials, plus malformed and invalid bodies', async (t) => {
  const { service, request, post, writer, token } = await fixture(t);
  for (const [bearer, status] of [[undefined, 401], ['invalid', 401], [token(['writer'], 'customer-1', { expiresInSeconds: -3600 }), 401], [token(['reader']), 403]]) {
    const response = await request('/orders', { method: 'POST', body: input(), bearer });
    assert.equal(response.status, status);
    await response.json();
  }
  const malformed = await request('/orders', { method: 'POST', raw: '{', bearer: writer });
  assert.equal(malformed.status, 400);
  await malformed.json();
  for (const body of [null, [], {}, { ...input(), quantity: '2' }, { ...input(), quantity: 0 }, { ...input(), sku: {} }, { ...input(), extra: true }]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    await response.json();
  }
  const trailing = await request('/orders/', { method: 'POST', body: input(), bearer: writer });
  assert.equal(trailing.status, 404);
  await trailing.json();
  assert.equal((await service.pool.query('SELECT * FROM orders')).rows.length, 0);
  assert.equal(service.resources.created, service.resources.disposed);
});

it('rolls back the order when the audit UNIQUE constraint fails without leaking SQL internals', async (t) => {
  const { service, post } = await fixture(t);
  const body = input();
  const first = await post(body);
  assert.equal(first.status, 201);
  await first.json();
  const duplicate = await post({ ...body, sku: 'must-roll-back' });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { code: 'ConflictException', message: 'Request key already used', status: 409,
    correlationId: duplicate.headers.get('x-correlation-id') });
  assert.equal((await service.pool.query('SELECT * FROM orders')).rows.length, 1);
  assert.equal((await service.pool.query('SELECT * FROM order_audit')).rows.length, 1);
  const fresh = await post(input());
  assert.equal(fresh.status, 201);
  await fresh.json();
  assert.equal((await service.pool.query('SELECT * FROM orders')).rows.length, 2);
  await service.pool.query('DROP TABLE order_audit');
  const failure = await post(input());
  assert.equal(failure.status, 500);
  const envelope = await failure.json();
  assert.equal(envelope.message, 'Internal Server Error');
  assert.doesNotMatch(JSON.stringify(envelope), /SQL|order_audit|stack|INSERT/);
  assert.equal((await service.pool.query('SELECT * FROM orders')).rows.length, 2);
});

it('isolates two apps and closes their workers and owned containers repeatedly', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const response = await first.post(input());
  const { order } = await response.json();
  const rejected = await second.post(input(), first.writer);
  assert.equal(rejected.status, 401);
  await rejected.json();
  assert.equal((await second.service.pool.query('SELECT * FROM orders')).rows.length, 0);
  const missing = await second.request(`/orders/${order.id}`, { bearer: second.writer });
  assert.equal(missing.status, 404);
  await missing.json();
  await Promise.all([close(first.service), close(first.service)]);
  await assert.rejects(first.service.pool.query('SELECT 1'), /closed/);
  assert.throws(() => first.service.app.container.resolve(Symbol()), /disposed/);
  const stillWorking = await second.post(input());
  assert.equal(stillWorking.status, 201);
  await stillWorking.json();
  await close(second.service);
  await close(second.service);
  const unstarted = await createOrderService({ jwtSecret: randomBytes(32).toString('hex') });
  await close(unstarted);
  await close(unstarted);
  await assert.rejects(createOrderService({ jwtSecret: '' }), /jwtSecret/);
});
