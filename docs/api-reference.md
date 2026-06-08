---
layout: default
title: API Reference
nav_order: 4
---

# API Reference

Complete reference for the `@streetjs/core` public API.

## HTTP Server

### `streetApp(options?): StreetApp`

Creates and returns a Street application instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | Listen port |
| `host` | `string` | `'0.0.0.0'` | Bind address |
| `requestTimeoutMs` | `number` | `30000` | Per-request timeout |
| `maxBodyBytes` | `number` | `1048576` | Request body size limit |
| `uploadsDir` | `string` | `'./uploads'` | Multipart upload directory |

### `StreetApp`

| Method | Signature | Description |
|--------|-----------|-------------|
| `listen` | `(port?, host?) => Promise<void>` | Start the HTTP server |
| `close` | `() => Promise<void>` | Gracefully stop the server |
| `use` | `(mw: MiddlewareFn) => void` | Register global middleware |
| `registerController` | `(ctor: Constructor) => void` | Mount a controller |
| `openApiSpec` | `() => object` | Generate OpenAPI 3.0 spec |

## Decorators

| Decorator | Target | Description |
|-----------|--------|-------------|
| `@Controller(prefix)` | Class | Declare an HTTP controller |
| `@Get(path)` | Method | Handle GET requests |
| `@Post(path)` | Method | Handle POST requests |
| `@Put(path)` | Method | Handle PUT requests |
| `@Patch(path)` | Method | Handle PATCH requests |
| `@Delete(path)` | Method | Handle DELETE requests |
| `@Injectable()` | Class | Register with DI container |
| `@Validate(schema)` | Method | Validate request shape |
| `@ApiOperation(opts)` | Method | OpenAPI metadata |

## Exceptions

All exceptions extend `StreetException` and are automatically serialized as JSON.

| Class | Status |
|-------|--------|
| `BadRequestException` | 400 |
| `UnauthorizedException` | 401 |
| `ForbiddenException` | 403 |
| `NotFoundException` | 404 |
| `ConflictException` | 409 |
| `UnprocessableException` | 422 |
| `InternalException` | 500 |
| `ServiceUnavailableException` | 503 |
| `DatabaseConnectionError` | 503 |
| `FeatureUnavailableInEdgeRuntimeError` | 501 |

## Database

### `PgPool`

Pool of PostgreSQL connections using the Street wire driver.

```typescript
pool.query(sql, params?) // Execute a parameterized query
pool.transaction(fn)     // Run fn in a BEGIN/COMMIT/ROLLBACK block
pool.stream(sql)         // Return a readable stream of result rows
pool.acquire()           // Acquire a raw PgConnection
pool.release(conn)       // Return a connection to the pool
pool.close()             // Close all connections
```

### `QueryBuilder`

Fluent SQL query builder.

```typescript
new QueryBuilder()
  .select('id', 'name')
  .from('users')
  .where('active = true')
  .orderBy('name ASC')
  .limit(10)
  .build()
```

## Security

### `JwtService`

```typescript
jwt.sign(payload, expiresIn?)  // Returns token string
jwt.verify(token)              // Returns payload or throws
```

### `RateLimiter`

```typescript
new RateLimiter({ windowMs: 60000, maxRequests: 100 })
limiter.middleware()           // Returns MiddlewareFn
limiter.destroy()              // Clean up timers
```

## Enterprise

### `FeatureFlagService`

```typescript
new FeatureFlagService(pool, ttlMs?)
service.isEnabled(flagName, context?)  // Returns Promise<boolean>
service.invalidateCache(flagName)
```

### `AuditLogger`

```typescript
new AuditLogger({ pool, signingKey })
logger.log({ category, action, ... })    // Buffer and flush
logger.export(from, to, 'jsonl'|'csv')  // Returns ReadableStream
```

### `RetentionJob`

```typescript
new RetentionJob(pool)
job.run(entityMeta)  // DELETE rows older than retentionDays
```

## Platform

### `DistributedCache`

```typescript
new DistributedCache(transport?, { maxMemoryMb? })
cache.get(key)              // Returns string | null
cache.set(key, value, ttl?) // Store value
cache.invalidate(key)       // Delete and publish invalidation
```

### `ReplicationCoordinator`

```typescript
new ReplicationCoordinator(regions, { healthCheckIntervalMs? })
coordinator.getWritePool()              // Primary pool
coordinator.getReadPool(preferred?)     // Weighted read replica
coordinator.promotePrimary(regionName)  // Manual failover
coordinator.stop()                      // Stop health checks
```

### `AgentExecutor`

```typescript
new AgentExecutor(llmClient, toolRegistry, { maxSteps?, maxTokens? })
executor.run(userMessage, ctx?)  // Returns Promise<string>
```

## Data Policy Decorators

```typescript
@RetainFor('90d')     // Mark field for retention enforcement
@Encrypt()            // Mark field for AES-256-GCM encryption
@Classify('internal') // Mark field with classification level
@Sensitive()          // Mark field for audit log redaction
```

`FieldEncryptor` performs the transparent AES-256-GCM encrypt/decrypt of `@Encrypt()` fields and is wired into the repository layer (`encryptEntity`/`decryptEntity`); `redactByClassification` redacts `@Classify()` fields above a threshold for logging.

## Messaging Transports

### `RabbitMqTransport`

AMQP 0-9-1 `EventBusTransport` (publisher confirms, DLQ, reconnect, heartbeats).

```typescript
import { RabbitMqTransport } from '@streetjs/core';
const transport = new RabbitMqTransport({ host: '127.0.0.1', exchange: 'street.events' });
await transport.publish('orders.created', envelope);
const off = transport.subscribe('orders.created', async (env) => { /* handle */ });
await transport.close();
```

Also exported: `RabbitMqConnectionManager`, `RabbitMqPublisher`, `RabbitMqConsumer`, `AmqpConnection`.

### `KafkaClient` / `KafkaProducer` / `KafkaConsumer` / `KafkaStreamTransport`

Kafka binary protocol over `node:net` with a batching, optionally idempotent producer and a consumer-group offset-committing consumer.

```typescript
import { KafkaClient, KafkaProducer, KafkaConsumer } from '@streetjs/core';
const client = new KafkaClient({ brokers: ['127.0.0.1:9092'] });
const producer = new KafkaProducer(client, { idempotent: true });
await producer.send('orders', { key: null, value: Buffer.from('{}') });
const consumer = new KafkaConsumer(client, { groupId: 'g', topic: 'orders' });
await consumer.run(async (msg) => { /* handle msg.value */ });
```

See [docs/transports/rabbitmq.md](transports/rabbitmq.md) and [docs/transports/kafka.md](transports/kafka.md).

## Webhooks

### `WebhookDispatcher`

Outbound webhook delivery with HMAC-SHA256 signatures, retry/backoff, bounded queue, SSRF protection, and HTTPS enforcement. Supports a private-CA `tls` option per target.

```typescript
import { WebhookDispatcher } from '@streetjs/core/webhook';
const dispatcher = new WebhookDispatcher();
dispatcher.enqueue({ url: 'https://example.com/hook', secret: 'whsec', maxRetries: 3 }, 'user.created', { id: 'u1' });
```

### `signWebhookPayload(body, secret)` / `verifyIncomingWebhook(secret, signature, rawBody)`

HMAC-SHA256 signing/verification helpers (`WebhookManager` provides DB-backed endpoint management).

## Secret Providers

`VaultSecretProvider`, `AwsSecretsManagerProvider`, `AzureKeyVaultProvider`, `GcpSecretManagerProvider` implement `SecretProvider.get(key)`. `SecretRotationManager` watches a key and emits `rotate` events (with an `onRotate` hook to recycle pool connections).

```typescript
import { AwsSecretsManagerProvider, SecretRotationManager } from '@streetjs/core';
const provider = new AwsSecretsManagerProvider({ region: 'us-east-1', accessKeyId, secretAccessKey });
const mgr = new SecretRotationManager(provider, 'db-password', { intervalMs: 60000, onRotate: (v) => pool.recycle() });
await mgr.start();
```

## Observability

### `OtelTracer`

W3C Trace Context tracer with OTLP/HTTP export. `startSpan`, `extractContext`, `injectContext`, `flush`.

### `MetricsRegistry`

Prometheus registry: `counter`, `gauge`, `histogram`, `collect()` (text exposition format 0.0.4).

### `HealthCheckRegistry`

`addCheck(name, fn, { type, timeoutMs })`, `runLiveness()`, `runReadiness()`; pair with `registerHealthRoutes(app, registry)`.

### `Logger`

Structured JSON logger with `child(bindings)`, Error serialization, dev pretty-printing, and Cloud Run severity format (auto-detected via `K_SERVICE`). Use `correlationMiddleware(logger)` for per-request correlation IDs.

## Authentication & Authorization

- `ApiKeyService` — `generate(opts)` / `verify(rawKey)`; only SHA-256 hashes stored; LRU-cached, timing-safe.
- `RbacService` — `hasRole()` / `hasPermission()` with hierarchy flattening; `@Roles()`, `@Permissions()`, `rbacGuard(service)`.
- `RefreshTokenService` — `issue()` / `rotate()` with replay detection (`TokenReplayError`) and family revocation.
- `OAuthManager` — PKCE + OIDC validation (`JwksCache`); built-in Google/GitHub/Microsoft configs.
- `WebAuthnService` — passkey registration/authentication with sign-count replay protection.

## Jobs & Scheduling

- `JobQueue` — `enqueue()`, `register(type, handler)`, retry policies, DLQ promotion (`FOR UPDATE SKIP LOCKED`).
- `CronScheduler` — `register(expression, name, fn)` with a 5-field parser and single-instance guard.
