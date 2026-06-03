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
export { generateOpenApi } from './http/openapi.js';

// ── Router ────────────────────────────────────────────────────────────────────
export { Router, notFoundHandler, errorHandler } from './router/router.js';

// ── Database ──────────────────────────────────────────────────────────────────
export { PgConnection, StreetPostgresWireStream } from './database/wire.js';
export type { PgRow, PgResult, DbResult, PgConnectOptions } from './database/wire.js';
export { PgPool } from './database/pool.js';
export type { PoolOptions } from './database/pool.js';
export { StreetPostgresRepository } from './database/repository.js';
export type { IRepository } from './database/repository.js';
export { StreetMigrationRunner } from './database/migrations.js';
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
export { RateLimiter, RateLimitException } from './security/ratelimit.js';
export type { RateLimiterOptions } from './security/ratelimit.js';
export { sanitizeString, sanitizeDeep, escapeHtml, xssMiddleware } from './security/xss.js';

// ── Multipart ─────────────────────────────────────────────────────────────────
export { MultipartParser } from './multipart/parser.js';
export type { ParsedFile, MultipartResult } from './multipart/parser.js';

// ── WebSocket + SSE ───────────────────────────────────────────────────────────
export { StreetWebSocketServer, StreetSocket } from './websocket/server.js';
export type { WsHandler, WsEvent, WsServerOptions } from './websocket/server.js';
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
