import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  streetApp, createContainer, Controller, Get, Post, SqlitePool,
  JwtService, authMiddleware, requireRoles, z, validate, validated,
  ConflictException, NotFoundException, HealthCheckRegistry, registerHealthRoutes,
  MetricsRegistry, metricsHandler, Logger, correlationMiddleware,
} from 'streetjs';

const DATABASE = Symbol('order database');
const REQUEST = Symbol('request resource');
const orderSchema = {
  body: z.object({
    requestKey: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
    sku: z.string().min(1).max(80),
    quantity: z.number().int().min(1).max(1000),
  }).strict(),
};
const idSchema = { params: z.object({ id: z.string().uuid() }) };
// SqlitePool's wire result represents SQL numeric values as strings.
const orderView = (row) => ({ id: row.id, sku: row.sku, quantity: Number(row.quantity) });

// In-memory by design: one worker owns the entire database, including transactions.
// Callers provide signing material; this service neither issues nor stores tokens.
export async function createOrderService({ jwtSecret, logStream } = {}) {
  if (typeof jwtSecret !== 'string' || jwtSecret.length < 32) {
    throw new TypeError('jwtSecret must contain at least 32 characters');
  }
  const jwt = new JwtService(jwtSecret);
  const container = createContainer();
  const app = streetApp({
    container, containerOwnership: 'app', requestScope: true,
    errorResponse: 'envelope', maxBodyBytes: 4096,
  });
  const pool = new SqlitePool({ filePath: ':memory:', maxWorkers: 1 });
  container.registerValue(DATABASE, pool);
  const resources = { created: 0, disposed: 0 };
  const metrics = new MetricsRegistry();
  const requests = metrics.counter('order_service_requests_total', 'Requests reaching middleware');
  const active = metrics.gauge('order_service_request_resources', 'Active scoped request resources');
  const created = metrics.counter('order_service_orders_total', 'Committed orders');
  const logger = new Logger({ service: 'order-service', stream: logStream });
  let closePromise;
  let closed = false;

  // The container owns the pool. Close HTTP first so no handler can use a closed DB.
  const service = {
    app, pool, metrics, resources,
    async listen(port = 0, host = '127.0.0.1') {
      if (closed) throw new Error('Order service is closed');
      try { await app.listen(port, host); }
      catch (error) { await service.close(); throw error; }
      return service;
    },
    close() {
      closed = true;
      closePromise ??= (async () => {
        try { if (app.server.listening) await app.close(); }
        finally { await container.dispose(); }
      })();
      return closePromise;
    },
  };

  try {
    await pool.query(`CREATE TABLE orders (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, sku TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000))`);
    await pool.query(`CREATE TABLE order_audit (
      request_key TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL,
      actor_id TEXT NOT NULL, correlation_id TEXT NOT NULL)`);

    container.registerFactory(REQUEST, () => {
      resources.created++;
      active.set(resources.created - resources.disposed);
      return {
        id: randomUUID(),
        dispose() {
          resources.disposed++;
          active.set(resources.created - resources.disposed);
        },
      };
    }, 'scoped');
    app.use(correlationMiddleware(logger));
    app.use(async (ctx, next) => {
      requests.inc();
      const resource = ctx.container.resolve(REQUEST);
      ctx.state.requestResource = resource;
      ctx.setHeader('X-Request-Resource', resource.id);
      await next();
    });
    const health = new HealthCheckRegistry();
    health.addCheck('process', async () => ({ status: 'up' }));
    health.addCheck('database', async () => {
      try {
        await pool.query('SELECT 1');
        return { status: 'up' };
      } catch {
        return { status: 'down' }; // Never expose database errors in a public probe.
      }
    }, { type: 'readiness' });
    registerHealthRoutes(app, health);
    // Explicit counters only: no background heap sampler or interval to leak.
    const serveMetrics = metricsHandler(metrics);
    app.use(async (ctx, next) => {
      if (ctx.method === 'GET' && ctx.path === '/metrics') {
        await serveMetrics(ctx, next);
        return;
      }
      await next();
    });

    class Orders {
      async create(ctx) {
        const { requestKey, sku, quantity } = validated(ctx, orderSchema).body;
        const id = randomUUID();
        const db = ctx.container.resolve(DATABASE);
        let order;
        try {
          order = await db.transaction(async (query) => {
            await query('INSERT INTO orders (id, owner_id, sku, quantity) VALUES (?, ?, ?, ?)',
              [id, ctx.user.id, sku, quantity]);
            // A duplicate request key fails here, rolling back the preceding order.
            await query('INSERT INTO order_audit (request_key, order_id, actor_id, correlation_id) VALUES (?, ?, ?, ?)',
              [requestKey, id, ctx.user.id, ctx.state.correlationId]);
            return (await query('SELECT id, sku, quantity FROM orders WHERE id = ?', [id])).rows[0];
          });
        } catch (error) {
          if (error instanceof Error && /UNIQUE constraint failed: order_audit.request_key/.test(error.message)) {
            throw new ConflictException('Request key already used');
          }
          // The framework's envelope masks unexpected exceptions from HTTP clients.
          throw error;
        }
        created.inc();
        ctx.state.logger.info('order.created', { orderId: id });
        ctx.json({ order: orderView(order) }, 201);
      }
      async read(ctx) {
        const { id } = validated(ctx, idSchema).params;
        const result = await ctx.container.resolve(DATABASE).query(
          'SELECT id, sku, quantity FROM orders WHERE id = ? AND owner_id = ?', [id, ctx.user.id]);
        if (!result.rows[0]) throw new NotFoundException('Order not found');
        ctx.json({ order: orderView(result.rows[0]) });
      }
    }
    Controller('/orders', authMiddleware(jwt))(Orders);
    Post('', requireRoles('writer'), validate(orderSchema))(
      Orders.prototype, 'create', Object.getOwnPropertyDescriptor(Orders.prototype, 'create'));
    Get('/:id', requireRoles('reader', 'writer'), validate(idSchema))(
      Orders.prototype, 'read', Object.getOwnPropertyDescriptor(Orders.prototype, 'read'));
    app.registerController(Orders);
    return service;
  } catch (error) {
    await service.close();
    throw error;
  }
}

export async function listen(options, port = 0, host = '127.0.0.1') {
  return (await createOrderService(options)).listen(port, host);
}

export function close(service) { return service.close(); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
    const service = await listen({ jwtSecret: process.env.JWT_SECRET }, port);
    const shutdown = () => { void service.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    console.error('Order service startup failed; check JWT_SECRET and PORT configuration');
    process.exitCode = 1;
  }
}
