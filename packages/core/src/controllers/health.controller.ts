// src/controllers/health.controller.ts
// Health check endpoint for load balancers and monitoring.

import { Injectable } from '../core/container.js';
import { Controller, Get, ApiOperation } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { TelemetryTracker } from '../telemetry/tracker.js';
import { PgPool } from '../database/pool.js';

@Injectable()
@Controller('/api')
export class HealthController {
  constructor(
    private readonly telemetry: TelemetryTracker,
    private readonly pool: PgPool
  ) {}

  @Get('/health')
  @ApiOperation({ summary: 'Health check', tags: ['system'] })
  async health(ctx: StreetContext): Promise<void> {
    const checks: Record<string, { status: 'ok' | 'fail'; latencyMs?: number; detail?: string }> = {};

    // Database check
    const dbStart = Date.now();
    try {
      await this.pool.query('SELECT 1');
      checks['database'] = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (err) {
      checks['database'] = {
        status: 'fail',
        latencyMs: Date.now() - dbStart,
        detail: err instanceof Error ? err.message : 'unknown',
      };
    }

    const health = this.telemetry.health() as Record<string, unknown>;
    const allOk = Object.values(checks).every((c) => c.status === 'ok');

    ctx.json(
      {
        ...health,
        status: allOk ? 'ok' : 'degraded',
        checks,
        pool: { size: this.pool.size, idle: this.pool.idle },
      },
      allOk ? 200 : 503
    );
  }

  @Get('/metrics')
  @ApiOperation({ summary: 'Telemetry metrics', tags: ['system'] })
  async metrics(ctx: StreetContext): Promise<void> {
    const count = parseInt(String(ctx.query['count'] ?? '60'), 10);
    ctx.json({
      samples: this.telemetry.getHistory(Math.min(count, 1440)),
    });
  }

  @Get('/openapi.json')
  @ApiOperation({ summary: 'OpenAPI spec', tags: ['system'] })
  async openApiSpec(ctx: StreetContext): Promise<void> {
    // The actual spec is injected at startup — served from state
    const spec = (ctx.state['openApiSpec'] as object | undefined) ?? { openapi: '3.1.0', info: { title: 'Street API', version: '1.0.0' }, paths: {} };
    ctx.json(spec);
  }
}
