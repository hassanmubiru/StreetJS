// src/controllers/health.controller.ts
// Health check endpoint for load balancers and monitoring.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '../core/container.js';
import { Controller, Get, ApiOperation } from '../core/decorators.js';
import { TelemetryTracker } from '../telemetry/tracker.js';
import { PgPool } from '../database/pool.js';
let HealthController = class HealthController {
    telemetry;
    pool;
    constructor(telemetry, pool) {
        this.telemetry = telemetry;
        this.pool = pool;
    }
    async health(ctx) {
        const checks = {};
        // Database check
        const dbStart = Date.now();
        try {
            await this.pool.query('SELECT 1');
            checks['database'] = { status: 'ok', latencyMs: Date.now() - dbStart };
        }
        catch (err) {
            checks['database'] = {
                status: 'fail',
                latencyMs: Date.now() - dbStart,
                detail: err instanceof Error ? err.message : 'unknown',
            };
        }
        const health = this.telemetry.health();
        const allOk = Object.values(checks).every((c) => c.status === 'ok');
        ctx.json({
            ...health,
            status: allOk ? 'ok' : 'degraded',
            checks,
            pool: { size: this.pool.size, idle: this.pool.idle },
        }, allOk ? 200 : 503);
    }
    async metrics(ctx) {
        const count = parseInt(String(ctx.query['count'] ?? '60'), 10);
        ctx.json({
            samples: this.telemetry.getHistory(Math.min(count, 1440)),
        });
    }
    async openApiSpec(ctx) {
        // The actual spec is injected at startup — served from state
        const spec = ctx.state['openApiSpec'] ?? { openapi: '3.1.0', info: { title: 'Street API', version: '1.0.0' }, paths: {} };
        ctx.json(spec);
    }
};
__decorate([
    Get('/health'),
    ApiOperation({ summary: 'Health check', tags: ['system'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "health", null);
__decorate([
    Get('/metrics'),
    ApiOperation({ summary: 'Telemetry metrics', tags: ['system'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "metrics", null);
__decorate([
    Get('/openapi.json'),
    ApiOperation({ summary: 'OpenAPI spec', tags: ['system'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "openApiSpec", null);
HealthController = __decorate([
    Injectable(),
    Controller('/api'),
    __metadata("design:paramtypes", [TelemetryTracker,
        PgPool])
], HealthController);
export { HealthController };
//# sourceMappingURL=health.controller.js.map