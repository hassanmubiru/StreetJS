import type { StreetContext } from '../core/context.js';
import { TelemetryTracker } from '../telemetry/tracker.js';
import { PgPool } from '../database/pool.js';
export declare class HealthController {
    private readonly telemetry;
    private readonly pool;
    constructor(telemetry: TelemetryTracker, pool: PgPool);
    health(ctx: StreetContext): Promise<void>;
    metrics(ctx: StreetContext): Promise<void>;
    openApiSpec(ctx: StreetContext): Promise<void>;
}
//# sourceMappingURL=health.controller.d.ts.map