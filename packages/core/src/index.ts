// src/index.ts
// Public API surface for the street npm package.
// Import from 'street' to get everything you need.

// ── Core ──────────────────────────────────────────────────────────────────────
export { container, Container, Injectable } from './core/container.js';
export {
  Controller, Get, Post, Put, Patch, Delete,
  Validate, ApiOperation, Config, Command,
  getControllerMeta, getRoutesMeta, getCommandMeta, getConfigFields,
} from './core/decorators.js';
export { createContext } from './core/context.js';
export type {
  StreetContext, AuthenticatedUser, CookieOptions,
} from './core/context.js';
export type {
  Constructor, Awaitable,
  TokenPair, PaginatedResult,
  RouteMetadata, ControllerMetadata, MiddlewareFn,
  ValidationSchema, FieldRule, OpenApiOperation,
  IpcMessage, TelemetrySample,
} from './core/types.js';

// ── HTTP ──────────────────────────────────────────────────────────────────────
export { streetApp } from './http/server.js';
export type { StreetApp, StreetAppOptions } from './http/server.js';
export {
  StreetException, BadRequestException, UnauthorizedException,
  ForbiddenException, NotFoundException, ConflictException,
  UnprocessableException, InternalException, ServiceUnavailableException,
  DatabaseConnectionError,
  isStreetException,
} from './http/exceptions.js';
export {
  authMiddleware, requireRoles, securityHeaders, corsMiddleware,
} from './http/auth.middleware.js';
export {
  buildCsp, computeSecurityHeaders, securityHeadersMiddleware, DEFAULT_CSP,
} from './security/headers.js';
export type { CspDirectives, SecurityHeadersOptions } from './security/headers.js';
export {
  createMutualTlsServer, clientCertMiddleware, validateClientCert,
  certificateFingerprint, verifyCertificatePin, TrustStore, rotateServerCertificate,
} from './security/mtls.js';
export type { ClientCertPolicy, ClientCertResult, PeerCertLike, MutualTlsServerOptions, TrustMaterial, RotateCertificateOptions } from './security/mtls.js';
export { generateOpenApi } from './http/openapi.js';
export {
  FaultInjector, InjectedFaultError, chaosMiddleware, retryWithBackoff,
} from './testing/chaos.js';
export type { FaultPolicy } from './testing/chaos.js';
export {
  applyCodemods, listCodemods, getCodemod, renameIdentifierCodemod, safeRenameCodemod,
  BUILTIN_CODEMODS, ROUTING_CODEMODS, MIDDLEWARE_CODEMODS, PLUGIN_API_CODEMODS, ALL_CODEMODS,
} from './devx/codemods.js';
export type { Codemod, CodemodArea, CodemodResult, ApplyCodemodsResult } from './devx/codemods.js';
export { resolveVersions, analyzeBreakingChanges } from './devx/upgrade.js';
export type { VersionResolution, BreakingArea, BreakingChange } from './devx/upgrade.js';
export { openApiToHtml } from './devx/playground.js';
export type { PlaygroundOptions } from './devx/playground.js';
export {
  buildRouteTree, assembleRouteTree, flattenRouteTree,
  buildDependencyGraph, inspectorSuccess, inspectorFailure,
} from './devx/devtools.js';
export type {
  RouteNode, DepGraph, InspectorRequest, InspectorResult,
} from './devx/devtools.js';
export {
  validateOpenApiDocument, openApiOperations, parseZapReport,
  summarizeFindings, evaluateDastGate, openApiConformanceScan,
  buildDastArtifact,
} from './security/dast.js';
export type {
  DastSeverity, DastFinding, OpenApiValidationResult, OpenApiOperationTarget,
  DastGateOptions, DastGateResult, ConformanceScanOptions,
  DastFailureCause, DastArtifactDetails, DastArtifactMeta,
} from './security/dast.js';

// ── Verification Artifact subsystem ───────────────────────────────────────────
export { classify } from './verification/status.js';
export type {
  VerificationStatus, EvidenceComponents, BlockedReason, ClassifyInput,
} from './verification/status.js';
export { validateArtifact } from './verification/artifact.js';
export type { VerificationArtifact, ArtifactValidationResult } from './verification/artifact.js';
export { CommandRunner, DEFAULT_TIMEOUT_MS } from './verification/runner.js';
export type { RunOptions, RunResult } from './verification/runner.js';

// ── Release Engineering ───────────────────────────────────────────────────────
export {
  isValidSemver, validateReleaseNotes, buildReleaseReport,
  boundScorecard, clampScore, computeHealthMetrics,
  MIN_SCORE, MAX_SCORE,
} from './release/scorecard.js';
export type {
  ReleaseScorecard, HealthMetric, HealthMetrics, HealthCounts,
  ReleaseValidation, ReleaseReport, ReleaseReportInput,
} from './release/scorecard.js';

// ── Router ────────────────────────────────────────────────────────────────────
export { Router, notFoundHandler, errorHandler } from './router/router.js';

// ── Database ──────────────────────────────────────────────────────────────────
export { PgConnection, StreetPostgresWireStream } from './database/wire.js';
export type { PgRow, PgResult, DbResult, PgConnectOptions } from './database/wire.js';
export { PgPool } from './database/pool.js';
export type { PoolOptions } from './database/pool.js';
export { onPoolExhausted } from './database/pool.js';
export { StreetPostgresRepository } from './database/repository.js';
export type { IRepository } from './database/repository.js';
export { StreetMigrationRunner, MigrationDiffer } from './database/migrations.js';
export type { MigrationDiff, EntityColumnMeta } from './database/migrations.js';
export { StreetSeeder } from './database/seeder.js';
export type { SeedablePool, SeedablePoolConn } from './database/seeder.js';
export { QueryProfiler, ProfiledPool, ConnectionDiagnostics } from './database/profiler.js';
export type { QueryRecord, PoolStats, ProfileablePool } from './database/profiler.js';
export { SqlitePool } from './database/sqlite/pool.js';
export type { SqlitePoolOptions } from './database/sqlite/pool.js';
export { MysqlConnection, MysqlResultStream } from './database/mysql/wire.js';
export type { MysqlConnectOptions } from './database/mysql/wire.js';
export { MysqlPool } from './database/mysql/pool.js';
export type { MysqlPoolOptions } from './database/mysql/pool.js';
export { MariaDbConnection } from './database/mysql/mariadb.js';

// ── Security ──────────────────────────────────────────────────────────────────
export { JwtService } from './security/jwt.js';
export type { JwtPayload, JwtOptions } from './security/jwt.js';
export { SessionManager } from './security/session.js';
export type { SessionData } from './security/session.js';
export { encryptSecret, decryptSecret, loadConfig, constantTimeEqual } from './security/vault.js';
export { RateLimiter, RateLimitException, RateLimit, getRateLimitMeta } from './security/ratelimit.js';
export type { RateLimiterOptions, RateLimitDecoratorOptions } from './security/ratelimit.js';
export { sanitizeString, sanitizeDeep, escapeHtml, xssMiddleware } from './security/xss.js';

// ── Multipart ─────────────────────────────────────────────────────────────────
export { MultipartParser } from './multipart/parser.js';
export type { ParsedFile, MultipartResult } from './multipart/parser.js';

// ── WebSocket + SSE ───────────────────────────────────────────────────────────
export { StreetWebSocketServer, StreetSocket } from './websocket/server.js';
export type { WsHandler, WsEvent, WsServerOptions, RawWsHandler } from './websocket/server.js';
export { SseConnection, createSse } from './websocket/sse.js';
export type { SseEvent } from './websocket/sse.js';

// ── Cache ─────────────────────────────────────────────────────────────────────
export { LruCache } from './cache/lru.js';
export type { LruOptions } from './cache/lru.js';

// ── Telemetry ─────────────────────────────────────────────────────────────────
export { TelemetryTracker, telemetryMiddleware } from './telemetry/tracker.js';

// ── Cluster ───────────────────────────────────────────────────────────────────
export {
  ClusterCoordinator, workerHeartbeat, signalReady,
} from './cluster/coordinator.js';
export type { ClusterOptions } from './cluster/coordinator.js';

// ── Webhook ───────────────────────────────────────────────────────────────────
export { WebhookDispatcher } from './webhook/dispatcher.js';
export type { WebhookPayload, WebhookTarget } from './webhook/dispatcher.js';
export {
  WebhookManager,
  signWebhookPayload,
  verifyIncomingWebhook,
  WEBHOOK_ENDPOINTS_MIGRATION_SQL,
  WEBHOOK_DELIVERIES_MIGRATION_SQL,
} from './webhook/manager.js';
export type { WebhookManagerPool, WebhookManagerOptions, WebhookEndpoint, WebhookDelivery } from './webhook/manager.js';

// ── Dev ───────────────────────────────────────────────────────────────────────
export { DevWatcher } from './dev/watcher.js';
export type { WatcherOptions } from './dev/watcher.js';

// ── Query Builder ─────────────────────────────────────────────────────────────
export { QueryBuilder, SqlDialect } from './database/query-builder.js';

// ── Schema Inspector ──────────────────────────────────────────────────────────
export { SchemaInspector } from './database/schema-inspector.js';
export type {
  ColumnMeta, IndexMeta, FkMeta, TableSchema, DatabaseSchema, QueryablePool,
} from './database/schema-inspector.js';

// ── Config ────────────────────────────────────────────────────────────────────
export { defineConfig, ConfigValidationError } from './config/validator.js';
export type { FieldType, ConfigFieldDef, ConfigSchema, ConfigResult } from './config/validator.js';

// ── Diagnostics ───────────────────────────────────────────────────────────────
export { DiagnosticsReporter, diagnosticsReporter } from './diagnostics/reporter.js';
export type { DiagnosticEvent } from './diagnostics/reporter.js';

// ── CLI ───────────────────────────────────────────────────────────────────────
export { CliKernel, parseArgv } from './cli/kernel.js';
export type { ParsedArgs, CliKernelOptions } from './cli/kernel.js';

// ── Observability (OpenTelemetry-compatible) ──────────────────────────────────
export { OtelTracer, otelMiddleware, OtelInstrumentedPool, instrumentPoolWithOtel } from './observability/otel.js';
export type { SpanContext, Span, OtelInstrumentablePool, ActiveSpanResolver } from './observability/otel.js';

// ── Health Check DSL ──────────────────────────────────────────────────────────
export { HealthCheckRegistry, registerHealthRoutes } from './observability/health.js';
export type { CheckResult, HealthResponse, CheckType, CheckStatus, CheckFn } from './observability/health.js';

// ── Structured Logging ────────────────────────────────────────────────────────
export { Logger, correlationMiddleware } from './observability/logger.js';
export type { LogLevel, LogEntry } from './observability/logger.js';

// ── Prometheus Metrics ────────────────────────────────────────────────────────
export { MetricsRegistry, Counter, Gauge, Histogram, MetricConflictError, prometheusMiddleware, metricsHandler, registerMetricsRoute, PROMETHEUS_CONTENT_TYPE } from './observability/prometheus.js';
export {
  SubsystemMetrics, registerSubsystemMetrics, subsystemMetricNames, SUBSYSTEM_METRIC_NAMES,
  instrumentPgPool, instrumentKafkaClient, instrumentCoordinatorGate,
  instrumentRabbitMqPublisher, instrumentRabbitMqConsumer, instrumentPluginHost,
} from './observability/subsystem-metrics.js';
export {
  streetRecordingRules, streetAlertRules, streetSaturationRules, streetSloBurnRateRules, streetRuleGroups,
  validatePrometheusRuleGroups, serializePrometheusRulesYaml, isAlertRule,
} from './observability/prometheus-rules.js';
export type { RecordingRule, AlertRule, PromRule, RuleGroup, RuleValidationResult } from './observability/prometheus-rules.js';
export { streetApiDashboard, streetRuntimeDashboard, streetDashboards, validateGrafanaDashboard } from './observability/grafana-dashboard.js';
export type { GrafanaDashboard, GrafanaPanel, GrafanaTarget, DashboardValidationResult } from './observability/grafana-dashboard.js';
export {
  exportedMetricNames, referencedMetrics, validateMetricReferences, extractMetricsFromExpr,
} from './observability/metric-references.js';
export type { ObservabilityAssets, MetricReferenceViolation } from './observability/metric-references.js';

// ── Route Profiler ────────────────────────────────────────────────────────────
export { RouteProfiler } from './diagnostics/route-profiler.js';
export type { LatencySample, RouteStats } from './diagnostics/route-profiler.js';

// ── Diagnostics Socket Server ─────────────────────────────────────────────────
export { DiagnosticsServer, isStaleSocket } from './diagnostics/socket-server.js';

// ── Auth: OAuth2 / OIDC ───────────────────────────────────────────────────────
export { OAuthManager, JwksCache } from './auth/oauth2.js';
export type { OAuthProvider, OAuthProfile, OAuthTokens, OAuthSuccessCallback, OAuthErrorCallback } from './auth/oauth2.js';

// ── Auth: API Keys ────────────────────────────────────────────────────────────
export { ApiKeyService, apiKeyMiddleware, API_KEYS_MIGRATION_SQL } from './auth/api-keys.js';
export type { ApiKey, ApiKeyGenerateOpts, ApiKeyPool } from './auth/api-keys.js';

// ── Auth: Refresh Tokens ──────────────────────────────────────────────────────
export { RefreshTokenService, TokenReplayError, REFRESH_TOKENS_MIGRATION_SQL } from './auth/refresh-tokens.js';
export type { RefreshTokenPool, RefreshTokenServiceOptions } from './auth/refresh-tokens.js';

// ── Auth: RBAC ────────────────────────────────────────────────────────────────
export { RbacService, Roles, Permissions, rbacGuard } from './auth/rbac.js';
export type { RoleHierarchy, RbacGuardOptions } from './auth/rbac.js';

// ── Auth: WebAuthn / Passkeys ─────────────────────────────────────────────────
export { WebAuthnService, decodeCbor, WEBAUTHN_MIGRATION_SQL } from './auth/webauthn.js';
export {
  MfaService, hotp, totp, verifyTotp, base32Encode, base32Decode,
  generateRecoveryCodes, mfaGuard, verifyMfaStepUp, MFA_MIGRATION_SQL,
} from './auth/mfa.js';
export type { TotpOptions, TotpAlgorithm, MfaPool, EnrollmentResult, MfaGuardOptions } from './auth/mfa.js';export type { WebAuthnConfig, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON, AuthenticationResponseJSON, WebAuthnSession, WebAuthnPool } from './auth/webauthn.js';

// ── Auth: Session Store & Audit ───────────────────────────────────────────────
export { StreetSessionStore, sessionRevocationMiddleware, AuditWriter, SESSION_STORE_MIGRATION_SQL, AUDIT_LOG_MIGRATION_SQL } from './auth/session-store.js';
export type { SessionData as ServerSessionData, SessionStorePool, AuditEvent, AuditRecord, StreetSessionStoreOptions } from './auth/session-store.js';
export {
  auditAuthEvent,
  auditLoginSuccess,
  auditLoginFailure,
  auditLogout,
  auditTokenRefresh,
  auditSessionRevoked,
  auditPermissionDenied,
} from './auth/audit-writer.js';
export type { AuditEventDetails } from './auth/audit-writer.js';

// ── Jobs: Queue, Scheduler, Workflow ─────────────────────────────────────────
export {
  JobQueue,
  Job,
  registerJobMetricsRoute,
  STREET_JOBS_MIGRATION_SQL,
  STREET_DLQ_MIGRATION_SQL,
  STREET_JOB_HISTORY_MIGRATION_SQL,
} from './jobs/queue.js';
export type { JobHandler, JobContext, RetryPolicy, JobQueuePool, DlqPruneScheduler, JobQueueMetrics } from './jobs/queue.js';
export { CronScheduler, CronParseError } from './jobs/scheduler.js';
export {
  WorkflowEngine,
  STREET_WORKFLOWS_MIGRATION_SQL,
} from './jobs/workflow.js';
export type { WorkflowStep, WorkflowContext } from './jobs/workflow.js';

// ── Tenancy ───────────────────────────────────────────────────────────────────
export { tenantMiddleware, TENANTS_MIGRATION_SQL } from './tenancy/context.js';
export type { TenantContextData, TenantResolutionStrategy } from './tenancy/context.js';
export { TenantPoolRegistry } from './tenancy/pool-registry.js';
export { TenantScopedRepository, TenantScoped } from './tenancy/tenant-scoped.js';
export { TenantServiceImpl, QuotaEnforcer, registerTenantMetricsRoute, TENANT_USAGE_MIGRATION_SQL } from './tenancy/provisioner.js';
export type { QuotaStatus, QuotaConfig, TenantService } from './tenancy/provisioner.js';
export { TenantMetricsRegistry, TenantMetricsView, TenantUsageAggregator, TENANT_DAILY_STATS_MIGRATION_SQL } from './tenancy/metrics.js';
export { InMemoryBillingAdapter } from './tenancy/billing.js';
export type { TenantBillingAdapter, UsageMetrics, BillingPeriod } from './tenancy/billing.js';

// ── Microservices ─────────────────────────────────────────────────────────────
export { streetHttp2App } from './microservices/http2.js';
export { ServiceRegistry, StaticRegistry, ConsulRegistry } from './microservices/service-registry.js';
export type { ServiceInstance, ServiceRegistryBackend } from './microservices/service-registry.js';
export { CircuitBreaker, CircuitOpenError } from './microservices/circuit-breaker.js';
export type { CircuitState, CircuitBreakerOptions } from './microservices/circuit-breaker.js';
export { EventBus, InProcessTransport } from './microservices/event-bus.js';
export type { EventEnvelope, EventBusTransport } from './microservices/event-bus.js';
export { RedisEventBusTransport } from './microservices/transports/redis.js';
export {
  RabbitMqTransport, RabbitMqConnectionManager, RabbitMqPublisher, RabbitMqConsumer, AmqpConnection,
} from './transports/rabbitmq/index.js';
export type { RabbitMqOptions, ConsumerOptions, AmqpConnectionOptions, DeliveredMessage } from './transports/rabbitmq/index.js';
export {
  KafkaClient, KafkaProtocolError, KafkaProducer, KafkaConsumer, KafkaStreamTransport,
  CoordinatorReadinessGate,
  accountLostMessages, CHAOS_SCENARIOS, SLOW_BROKER_MIN_DELAY_MS,
  FULL_SCALE_COLD_STARTS, FULL_SCALE_RESTART_CYCLES,
  encodeRecordBatch, decodeRecordBatches,
} from './transports/kafka/index.js';
export type {
  KafkaClientOptions, ClusterMeta, TopicMeta, PartitionMeta, KafkaRecord,
  CoordinatorGateResult, CoordinatorReadinessGateOptions,
  LostMessageAccount, ChaosScenario,
  ProducerOptions as KafkaProducerOptions, ConsumerOptions as KafkaConsumerOptions,
  ConsumedMessage as KafkaConsumedMessage,
} from './transports/kafka/index.js';
export { SagaOrchestrator } from './microservices/saga.js';
export type { SagaStep } from './microservices/saga.js';
export { DistributedLock } from './microservices/distributed-lock.js';
export type { LockHandle } from './microservices/distributed-lock.js';
export { CommandBus, QueryBus } from './microservices/cqrs.js';
export { EventStore, EVENTS_MIGRATION_SQL } from './microservices/event-store.js';
export type { DomainEvent } from './microservices/event-store.js';
export { GrpcServer } from './microservices/grpc/server.js';
export type { GrpcServerOptions, GrpcCallContext, MethodRegistration } from './microservices/grpc/server.js';
export { parseProto, parseProtoFile, generateGrpcTypes, protoTypeToTs } from './microservices/grpc/proto-parser.js';
export type { ProtoAst, ServiceDefinition as GrpcServiceDefinition, RpcDefinition, MessageDefinition, FieldDef as GrpcFieldDef } from './microservices/grpc/proto-parser.js';
export { encodeFrame, decodeFrame, decodeFrames, parseGrpcTimeout, GrpcError, GRPC_STATUS, GRPC_MAX_MESSAGE_BYTES, jsonCodec } from './microservices/grpc/framing.js';

// ── Cloud ─────────────────────────────────────────────────────────────────────
export { generateManifest, validateDeploymentManifest, generateTargetAssets, helmChartAssets, generateEcsService, validateEcsService } from './cloud/deployment.js';
export type { CloudPlatform, DeploymentTarget, DeployConfig, ManifestValidationResult, EcsServiceValidationResult } from './cloud/deployment.js';
export { VaultSecretProvider, AwsSecretsManagerProvider, GcpSecretManagerProvider, AzureKeyVaultProvider, SecretRotationManager } from './cloud/secret-providers.js';export type { SecretProvider, HttpClientOptions, RotationOptions } from './cloud/secret-providers.js';
export {
  registerShutdownHook,
  isRunningInServiceMesh,
  buildAutoscaleMetrics,
  registerAutoscaleRoute,
} from './cloud/runtime.js';
export type {
  Closeable, ShutdownHookOptions, AutoscaleMetrics, AutoscaleSource,
  ExternalMetricValue,
} from './cloud/runtime.js';

// ── Enterprise: Feature Flags ──────────────────────────────────────────────────
export { FeatureFlagService, FEATURE_FLAGS_MIGRATION_SQL, registerFeatureFlagAdminRoute } from './enterprise/feature-flags.js';
export type { FeatureFlagRule } from './enterprise/feature-flags.js';

// ── Enterprise: Audit Logger ───────────────────────────────────────────────────
export { AuditLogger, Sensitive, ENTERPRISE_AUDIT_MIGRATION_SQL } from './enterprise/audit-logger.js';
export type { AuditCategory } from './enterprise/audit-logger.js';

// ── Enterprise: Data Policy ────────────────────────────────────────────────────
export { RetainFor, Encrypt, Classify, RetentionJob, ComplianceReporter, FieldEncryptor, redactByClassification } from './enterprise/data-policy.js';
export type { DataClassificationLevel, RetentionEntityMeta, ComplianceReport } from './enterprise/data-policy.js';

// ── Enterprise: Console APIs ────────────────────────────────────────────────────
export { EnterpriseConsole, CONSOLE_ROUTES, InMemoryConsoleBackend, ConsoleNotFoundError } from './enterprise/console/index.js';
export type {
  EnterpriseConsoleOptions,
  ConsoleArea,
  ConsoleBackend,
  ConsoleMethod,
  ConsolePrincipal,
  ConsoleRequest,
  ConsoleResponse,
  ConsoleRoute,
  ValidationResult as ConsoleValidationResult,
  CreateTenantInput,
  UpdateTenantInput,
  RbacPolicyInput,
  MfaPolicyInput,
  RetentionPolicyInput,
  ClassificationPolicyInput,
  AuditExportInput,
  ManageUserInput,
  RotateKeyInput,
  ManageSecretInput,
} from './enterprise/console/index.js';

// ── Enterprise: Backup ────────────────────────────────────────────────────────
export { BackupService, LocalStorageAdapter, BACKUPS_MIGRATION_SQL } from './enterprise/backup.js';
export type { StorageAdapter, BackupRecord } from './enterprise/backup.js';
export { S3StorageAdapter, GcsStorageAdapter, signAwsV4 } from './enterprise/storage-adapters.js';
export type { S3StorageOptions, GcsStorageOptions, SigV4Input } from './enterprise/storage-adapters.js';

// ── Platform: Distributed Cache ───────────────────────────────────────────────
export { DistributedCache, InProcessCacheTransport, GlobalConfigService } from './platform/distributed-cache.js';
export type { CacheTransport, DistributedCacheOptions } from './platform/distributed-cache.js';
export { RedisCacheTransport } from './platform/transports/redis.js';
export { MemcachedTransport } from './platform/transports/memcached.js';
export type { MemcachedOptions } from './platform/transports/memcached.js';
export { RedisClient, RespParser, encodeCommand } from './transports/resp.js';
export type { RedisClientOptions, RespValue } from './transports/resp.js';

// ── Platform: Event Streaming ─────────────────────────────────────────────────
export { EventStreamPublisher, EventStreamConsumer, InProcessStreamTransport, RealtimeAggregator } from './platform/event-streaming.js';
export type { StreamTransport, LagEvent, LagMonitorOptions } from './platform/event-streaming.js';
export { KinesisStreamTransport } from './platform/transports/kinesis.js';
export type { KinesisOptions } from './platform/transports/kinesis.js';

// ── Platform: Replication ─────────────────────────────────────────────────────
export { ReplicationCoordinator, preferredRegionMiddleware } from './platform/replication.js';
export type { RegionConfig } from './platform/replication.js';

// ── Platform: AI ──────────────────────────────────────────────────────────────
export { OpenAiClient, AnthropicClient, OllamaClient } from './platform/ai/llm-client.js';
export type { LlmClient, CompletionOptions, CompletionResult } from './platform/ai/llm-client.js';
export { ToolRegistry } from './platform/ai/tool-registry.js';
export type { LlmFunctionDef } from './platform/ai/tool-registry.js';
export { AgentExecutor } from './platform/ai/agent-executor.js';
export type { AgentExecutorOptions } from './platform/ai/agent-executor.js';

// ── Platform: Plugins ─────────────────────────────────────────────────────────
export { PluginModule } from './platform/plugins/sdk.js';
export type { SandboxedApp } from './platform/plugins/sdk.js';
export { PluginInstaller } from './platform/plugins/registry.js';
export type { PluginInstallerOptions } from './platform/plugins/registry.js';
export {
  PluginHost, signManifest, verifyManifest, manifestChecksum,
  satisfiesVersion, parseSemver, compareSemver,
  PluginError, PluginPermissionError, PluginDependencyError, PluginSignatureError, PluginStateError,
  PluginManifestError,
} from './platform/plugins/host.js';
export type { PluginManifest, PluginPermission, PluginHostOptions, PluginState } from './platform/plugins/host.js';
export {
  normalizePageSize, DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE,
} from './platform/plugins/pagination.js';
export {
  S3Plugin, s3PluginManifest, validateS3Config, S3_PLUGIN_NAME, S3_PLUGIN_VERSION,
} from './platform/plugins/official/s3.js';
export type { S3PluginConfig } from './platform/plugins/official/s3.js';
export {
  LocalPluginRegistry, installFromRegistry, installThroughRegistry, assertWellFormedManifest,
} from './platform/plugins/local-registry.js';
export type {
  RegistryRecord, InstallThroughRegistryOptions, InstallThroughRegistryResult,
} from './platform/plugins/local-registry.js';
export {
  SendGridPlugin, SendGridClient, sendGridPluginManifest, validateSendGridConfig,
  SENDGRID_PLUGIN_NAME, SENDGRID_PLUGIN_VERSION,
} from './platform/plugins/official/sendgrid.js';
export type { SendGridPluginConfig, MailMessage, SendGridRequest } from './platform/plugins/official/sendgrid.js';
export {
  StripePlugin, StripeClient, stripePluginManifest, validateStripeConfig, STRIPE_PLUGIN_NAME, STRIPE_PLUGIN_VERSION,
} from './platform/plugins/official/stripe.js';
export type { StripePluginConfig, StripeHttpRequest } from './platform/plugins/official/stripe.js';
export {
  TwilioPlugin, TwilioClient, twilioPluginManifest, validateTwilioConfig, TWILIO_PLUGIN_NAME, TWILIO_PLUGIN_VERSION,
} from './platform/plugins/official/twilio.js';
export type { TwilioPluginConfig, TwilioHttpRequest, SmsMessage } from './platform/plugins/official/twilio.js';
export {
  Auth0Plugin, Auth0Client, auth0PluginManifest, validateAuth0Config, AUTH0_PLUGIN_NAME, AUTH0_PLUGIN_VERSION,
} from './platform/plugins/official/auth0.js';
export type { Auth0PluginConfig, Auth0HttpRequest } from './platform/plugins/official/auth0.js';
export {
  R2Plugin, R2Client, r2PluginManifest, validateR2Config, R2_PLUGIN_NAME, R2_PLUGIN_VERSION,
} from './platform/plugins/official/r2.js';
export type { R2PluginConfig } from './platform/plugins/official/r2.js';

// ── HTTP: Edge Runtime ────────────────────────────────────────────────────────
export { FeatureUnavailableInEdgeRuntimeError } from './http/exceptions.js';

// ── API Versioning ────────────────────────────────────────────────────────────
export { ApiVersion, Deprecated, enableVersioning, getApiVersion, getDeprecatedMeta, versionGuard, filterOpenApiByVersion, registerVersionedOpenApi } from './versioning/strategy.js';
export type { VersioningOptions, DeprecatedOptions } from './versioning/strategy.js';

// ── SDK Generator ─────────────────────────────────────────────────────────────
export { generateTypescriptSdk } from './sdk-gen/typescript.js';
export type { OpenApiSpec as SdkOpenApiSpec, OpenApiOperation as SdkOpenApiOperation } from './sdk-gen/typescript.js';
export { generatePythonSdk } from './sdk-gen/python.js';

// ── API Analytics ─────────────────────────────────────────────────────────────
export { AnalyticsService, STREET_API_EVENTS_MIGRATION_SQL } from './observability/analytics.js';
export type { AnalyticsPool, AnalyticsEvent, AnalyticsServiceOptions, AnalyticsReport, RouteReportRow } from './observability/analytics.js';

// ── GraphQL: SDL Schema Parser ────────────────────────────────────────────────
export { parseSchema, typeRefToString, namedType, SchemaParseError } from './graphql/schema.js';
export type {
  SchemaAst, ServiceDefinition, TypeDef, TypeDefKind, FieldDef, ArgDef,
  TypeRef, DirectiveNode, DirectiveArg, DirectiveDef, EnumValueDef,
} from './graphql/schema.js';

// ── GraphQL: Execution Engine ─────────────────────────────────────────────────
export { GraphQlEngine, graphqlMiddleware, registerGraphqlRoute, DEFAULT_GRAPHQL_PATH } from './graphql/engine.js';
export type { GraphQlEngineOptions, ExecutionResult, SubscriptionSource } from './graphql/engine.js';

// ── GraphQL: Subscriptions (graphql-ws) ───────────────────────────────────────
export {
  GraphQlWsConnection,
  attachGraphqlWs,
  GRAPHQL_WS_SUBPROTOCOL,
  GraphQlWsMessageType,
  GraphQlWsCloseCode,
} from './graphql/subscriptions.js';
export type {
  GraphQlWsTransport,
  GraphQlWsConnectionOptions,
  GraphQlWsServerOptions,
  GraphQlWsMessage,
} from './graphql/subscriptions.js';
