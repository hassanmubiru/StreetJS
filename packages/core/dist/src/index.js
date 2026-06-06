// src/index.ts
// Public API surface for the street npm package.
// Import from 'street' to get everything you need.
// ── Core ──────────────────────────────────────────────────────────────────────
export { container, Container, Injectable } from './core/container.js';
export { Controller, Get, Post, Put, Patch, Delete, Validate, ApiOperation, Config, Command, getControllerMeta, getRoutesMeta, getCommandMeta, getConfigFields, } from './core/decorators.js';
export { createContext } from './core/context.js';
// ── HTTP ──────────────────────────────────────────────────────────────────────
export { streetApp } from './http/server.js';
export { StreetException, BadRequestException, UnauthorizedException, ForbiddenException, NotFoundException, ConflictException, UnprocessableException, InternalException, ServiceUnavailableException, DatabaseConnectionError, isStreetException, } from './http/exceptions.js';
export { authMiddleware, requireRoles, securityHeaders, corsMiddleware, } from './http/auth.middleware.js';
export { generateOpenApi } from './http/openapi.js';
// ── Router ────────────────────────────────────────────────────────────────────
export { Router, notFoundHandler, errorHandler } from './router/router.js';
// ── Database ──────────────────────────────────────────────────────────────────
export { PgConnection, StreetPostgresWireStream } from './database/wire.js';
export { PgPool } from './database/pool.js';
export { onPoolExhausted } from './database/pool.js';
export { StreetPostgresRepository } from './database/repository.js';
export { StreetMigrationRunner, MigrationDiffer } from './database/migrations.js';
export { StreetSeeder } from './database/seeder.js';
export { QueryProfiler, ProfiledPool, ConnectionDiagnostics } from './database/profiler.js';
export { SqlitePool } from './database/sqlite/pool.js';
export { MysqlConnection, MysqlResultStream } from './database/mysql/wire.js';
export { MysqlPool } from './database/mysql/pool.js';
export { MariaDbConnection } from './database/mysql/mariadb.js';
// ── Security ──────────────────────────────────────────────────────────────────
export { JwtService } from './security/jwt.js';
export { SessionManager } from './security/session.js';
export { encryptSecret, decryptSecret, loadConfig, constantTimeEqual } from './security/vault.js';
export { RateLimiter, RateLimitException, RateLimit, getRateLimitMeta } from './security/ratelimit.js';
export { sanitizeString, sanitizeDeep, escapeHtml, xssMiddleware } from './security/xss.js';
// ── Multipart ─────────────────────────────────────────────────────────────────
export { MultipartParser } from './multipart/parser.js';
// ── WebSocket + SSE ───────────────────────────────────────────────────────────
export { StreetWebSocketServer, StreetSocket } from './websocket/server.js';
export { SseConnection, createSse } from './websocket/sse.js';
// ── Cache ─────────────────────────────────────────────────────────────────────
export { LruCache } from './cache/lru.js';
// ── Telemetry ─────────────────────────────────────────────────────────────────
export { TelemetryTracker, telemetryMiddleware } from './telemetry/tracker.js';
// ── Cluster ───────────────────────────────────────────────────────────────────
export { ClusterCoordinator, workerHeartbeat, signalReady, } from './cluster/coordinator.js';
// ── Webhook ───────────────────────────────────────────────────────────────────
export { WebhookDispatcher } from './webhook/dispatcher.js';
export { WebhookManager, signWebhookPayload, verifyIncomingWebhook, WEBHOOK_ENDPOINTS_MIGRATION_SQL, WEBHOOK_DELIVERIES_MIGRATION_SQL, } from './webhook/manager.js';
// ── Dev ───────────────────────────────────────────────────────────────────────
export { DevWatcher } from './dev/watcher.js';
// ── Query Builder ─────────────────────────────────────────────────────────────
export { QueryBuilder, SqlDialect } from './database/query-builder.js';
// ── Schema Inspector ──────────────────────────────────────────────────────────
export { SchemaInspector } from './database/schema-inspector.js';
// ── Config ────────────────────────────────────────────────────────────────────
export { defineConfig, ConfigValidationError } from './config/validator.js';
// ── Diagnostics ───────────────────────────────────────────────────────────────
export { DiagnosticsReporter, diagnosticsReporter } from './diagnostics/reporter.js';
// ── CLI ───────────────────────────────────────────────────────────────────────
export { CliKernel, parseArgv } from './cli/kernel.js';
// ── Observability (OpenTelemetry-compatible) ──────────────────────────────────
export { OtelTracer, otelMiddleware, OtelInstrumentedPool, instrumentPoolWithOtel } from './observability/otel.js';
// ── Health Check DSL ──────────────────────────────────────────────────────────
export { HealthCheckRegistry, registerHealthRoutes } from './observability/health.js';
// ── Structured Logging ────────────────────────────────────────────────────────
export { Logger, correlationMiddleware } from './observability/logger.js';
// ── Prometheus Metrics ────────────────────────────────────────────────────────
export { MetricsRegistry, Counter, Gauge, Histogram, MetricConflictError, prometheusMiddleware, metricsHandler, registerMetricsRoute, PROMETHEUS_CONTENT_TYPE } from './observability/prometheus.js';
// ── Route Profiler ────────────────────────────────────────────────────────────
export { RouteProfiler } from './diagnostics/route-profiler.js';
// ── Diagnostics Socket Server ─────────────────────────────────────────────────
export { DiagnosticsServer, isStaleSocket } from './diagnostics/socket-server.js';
// ── Auth: OAuth2 / OIDC ───────────────────────────────────────────────────────
export { OAuthManager, JwksCache } from './auth/oauth2.js';
// ── Auth: API Keys ────────────────────────────────────────────────────────────
export { ApiKeyService, apiKeyMiddleware, API_KEYS_MIGRATION_SQL } from './auth/api-keys.js';
// ── Auth: Refresh Tokens ──────────────────────────────────────────────────────
export { RefreshTokenService, TokenReplayError, REFRESH_TOKENS_MIGRATION_SQL } from './auth/refresh-tokens.js';
// ── Auth: RBAC ────────────────────────────────────────────────────────────────
export { RbacService, Roles, Permissions, rbacGuard } from './auth/rbac.js';
// ── Auth: WebAuthn / Passkeys ─────────────────────────────────────────────────
export { WebAuthnService, decodeCbor, WEBAUTHN_MIGRATION_SQL } from './auth/webauthn.js';
// ── Auth: Session Store & Audit ───────────────────────────────────────────────
export { StreetSessionStore, sessionRevocationMiddleware, AuditWriter, SESSION_STORE_MIGRATION_SQL, AUDIT_LOG_MIGRATION_SQL } from './auth/session-store.js';
export { auditAuthEvent, auditLoginSuccess, auditLoginFailure, auditLogout, auditTokenRefresh, auditSessionRevoked, auditPermissionDenied, } from './auth/audit-writer.js';
// ── Jobs: Queue, Scheduler, Workflow ─────────────────────────────────────────
export { JobQueue, Job, registerJobMetricsRoute, STREET_JOBS_MIGRATION_SQL, STREET_DLQ_MIGRATION_SQL, STREET_JOB_HISTORY_MIGRATION_SQL, } from './jobs/queue.js';
export { CronScheduler, CronParseError } from './jobs/scheduler.js';
export { WorkflowEngine, STREET_WORKFLOWS_MIGRATION_SQL, } from './jobs/workflow.js';
// ── Tenancy ───────────────────────────────────────────────────────────────────
export { tenantMiddleware, TENANTS_MIGRATION_SQL } from './tenancy/context.js';
export { TenantPoolRegistry } from './tenancy/pool-registry.js';
export { TenantScopedRepository, TenantScoped } from './tenancy/tenant-scoped.js';
export { TenantServiceImpl, QuotaEnforcer, registerTenantMetricsRoute, TENANT_USAGE_MIGRATION_SQL } from './tenancy/provisioner.js';
export { TenantMetricsRegistry, TenantMetricsView, TENANT_DAILY_STATS_MIGRATION_SQL } from './tenancy/metrics.js';
export { InMemoryBillingAdapter } from './tenancy/billing.js';
// ── Microservices ─────────────────────────────────────────────────────────────
export { streetHttp2App } from './microservices/http2.js';
export { ServiceRegistry, StaticRegistry, ConsulRegistry } from './microservices/service-registry.js';
export { CircuitBreaker, CircuitOpenError } from './microservices/circuit-breaker.js';
export { EventBus, InProcessTransport } from './microservices/event-bus.js';
export { RedisEventBusTransport } from './microservices/transports/redis.js';
export { RabbitMqTransport, RabbitMqConnectionManager, RabbitMqPublisher, RabbitMqConsumer, AmqpConnection, } from './transports/rabbitmq/index.js';
export { KafkaClient, KafkaProtocolError, KafkaProducer, KafkaConsumer, KafkaStreamTransport, encodeRecordBatch, decodeRecordBatches, } from './transports/kafka/index.js';
export { SagaOrchestrator } from './microservices/saga.js';
export { DistributedLock } from './microservices/distributed-lock.js';
export { CommandBus, QueryBus } from './microservices/cqrs.js';
export { EventStore, EVENTS_MIGRATION_SQL } from './microservices/event-store.js';
export { GrpcServer } from './microservices/grpc/server.js';
export { parseProto, parseProtoFile, generateGrpcTypes, protoTypeToTs } from './microservices/grpc/proto-parser.js';
export { encodeFrame, decodeFrame, decodeFrames, parseGrpcTimeout, GrpcError, GRPC_STATUS, GRPC_MAX_MESSAGE_BYTES, jsonCodec } from './microservices/grpc/framing.js';
// ── Cloud ─────────────────────────────────────────────────────────────────────
export { generateManifest } from './cloud/deployment.js';
export { VaultSecretProvider, AwsSecretsManagerProvider, GcpSecretManagerProvider } from './cloud/secret-providers.js';
export { registerShutdownHook, isRunningInServiceMesh, buildAutoscaleMetrics, registerAutoscaleRoute, } from './cloud/runtime.js';
// ── Enterprise: Feature Flags ──────────────────────────────────────────────────
export { FeatureFlagService, FEATURE_FLAGS_MIGRATION_SQL, registerFeatureFlagAdminRoute } from './enterprise/feature-flags.js';
// ── Enterprise: Audit Logger ───────────────────────────────────────────────────
export { AuditLogger, Sensitive, ENTERPRISE_AUDIT_MIGRATION_SQL } from './enterprise/audit-logger.js';
// ── Enterprise: Data Policy ────────────────────────────────────────────────────
export { RetainFor, Encrypt, Classify, RetentionJob, ComplianceReporter } from './enterprise/data-policy.js';
// ── Enterprise: Backup ────────────────────────────────────────────────────────
export { BackupService, LocalStorageAdapter, BACKUPS_MIGRATION_SQL } from './enterprise/backup.js';
export { S3StorageAdapter, GcsStorageAdapter, signAwsV4 } from './enterprise/storage-adapters.js';
// ── Platform: Distributed Cache ───────────────────────────────────────────────
export { DistributedCache, InProcessCacheTransport, GlobalConfigService } from './platform/distributed-cache.js';
export { RedisCacheTransport } from './platform/transports/redis.js';
export { MemcachedTransport } from './platform/transports/memcached.js';
export { RedisClient, RespParser, encodeCommand } from './transports/resp.js';
// ── Platform: Event Streaming ─────────────────────────────────────────────────
export { EventStreamPublisher, EventStreamConsumer, InProcessStreamTransport, RealtimeAggregator } from './platform/event-streaming.js';
export { KinesisStreamTransport } from './platform/transports/kinesis.js';
// ── Platform: Replication ─────────────────────────────────────────────────────
export { ReplicationCoordinator, preferredRegionMiddleware } from './platform/replication.js';
// ── Platform: AI ──────────────────────────────────────────────────────────────
export { OpenAiClient, AnthropicClient, OllamaClient } from './platform/ai/llm-client.js';
export { ToolRegistry } from './platform/ai/tool-registry.js';
export { AgentExecutor } from './platform/ai/agent-executor.js';
// ── Platform: Plugins ─────────────────────────────────────────────────────────
export { PluginModule } from './platform/plugins/sdk.js';
export { PluginInstaller } from './platform/plugins/registry.js';
// ── HTTP: Edge Runtime ────────────────────────────────────────────────────────
export { FeatureUnavailableInEdgeRuntimeError } from './http/exceptions.js';
// ── API Versioning ────────────────────────────────────────────────────────────
export { ApiVersion, Deprecated, enableVersioning, getApiVersion, getDeprecatedMeta, versionGuard, filterOpenApiByVersion, registerVersionedOpenApi } from './versioning/strategy.js';
// ── SDK Generator ─────────────────────────────────────────────────────────────
export { generateTypescriptSdk } from './sdk-gen/typescript.js';
export { generatePythonSdk } from './sdk-gen/python.js';
// ── API Analytics ─────────────────────────────────────────────────────────────
export { AnalyticsService, STREET_API_EVENTS_MIGRATION_SQL } from './observability/analytics.js';
// ── GraphQL: SDL Schema Parser ────────────────────────────────────────────────
export { parseSchema, typeRefToString, namedType, SchemaParseError } from './graphql/schema.js';
// ── GraphQL: Execution Engine ─────────────────────────────────────────────────
export { GraphQlEngine, graphqlMiddleware, registerGraphqlRoute, DEFAULT_GRAPHQL_PATH } from './graphql/engine.js';
// ── GraphQL: Subscriptions (graphql-ws) ───────────────────────────────────────
export { GraphQlWsConnection, attachGraphqlWs, GRAPHQL_WS_SUBPROTOCOL, GraphQlWsMessageType, GraphQlWsCloseCode, } from './graphql/subscriptions.js';
//# sourceMappingURL=index.js.map