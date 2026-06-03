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
export { StreetPostgresRepository } from './database/repository.js';
export { StreetMigrationRunner } from './database/migrations.js';
export { SqlitePool } from './database/sqlite/pool.js';
// ── Security ──────────────────────────────────────────────────────────────────
export { JwtService } from './security/jwt.js';
export { SessionManager } from './security/session.js';
export { encryptSecret, decryptSecret, loadConfig, constantTimeEqual } from './security/vault.js';
export { RateLimiter, RateLimitException } from './security/ratelimit.js';
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
// ── Dev ───────────────────────────────────────────────────────────────────────
export { DevWatcher } from './dev/watcher.js';
// ── Config ────────────────────────────────────────────────────────────────────
export { defineConfig, ConfigValidationError } from './config/validator.js';
// ── Diagnostics ───────────────────────────────────────────────────────────────
export { DiagnosticsReporter, diagnosticsReporter } from './diagnostics/reporter.js';
// ── CLI ───────────────────────────────────────────────────────────────────────
export { CliKernel, parseArgv } from './cli/kernel.js';
//# sourceMappingURL=index.js.map