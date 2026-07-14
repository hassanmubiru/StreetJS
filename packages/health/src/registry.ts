/**
 * The health-check registry.
 *
 * Depends on `types`, `check`, and `report`.
 */

import type {
  CheckKind,
  Clock,
  EndpointResponse,
  HealthCheckOptions,
  HealthReport,
} from './types.js';
import { normalizeCheck, runCheck, type NormalizedCheck } from './check.js';
import { buildReport, toEndpointResponse, CONTENT_TYPE } from './report.js';

/** Public, read-only view of a registered check's metadata. */
export interface RegisteredCheck {
  readonly name: string;
  readonly kind: CheckKind;
  readonly critical: boolean;
  readonly timeoutMs: number;
}

export interface HealthRegistryOptions {
  /** Injectable clock (epoch ms). Default `Date.now`. */
  readonly clock?: Clock;
}

export class HealthRegistry {
  private readonly checks = new Map<string, NormalizedCheck>();
  private readonly clock: Clock;

  readonly contentType = CONTENT_TYPE;

  constructor(options: HealthRegistryOptions = {}) {
    this.clock = options.clock ?? Date.now;
  }

  /** Register a check. Throws on a duplicate name. */
  register(options: HealthCheckOptions): void {
    const normalized = normalizeCheck(options);
    if (this.checks.has(normalized.name)) {
      throw new Error(`A health check named ${JSON.stringify(normalized.name)} is already registered`);
    }
    this.checks.set(normalized.name, normalized);
  }

  /** Remove a check by name. Returns `true` if one was removed. */
  unregister(name: string): boolean {
    return this.checks.delete(name);
  }

  /** Metadata for a registered check. */
  get(name: string): RegisteredCheck | undefined {
    const c = this.checks.get(name);
    return c ? { name: c.name, kind: c.kind, critical: c.critical, timeoutMs: c.timeoutMs } : undefined;
  }

  /** Metadata for all registered checks, optionally filtered by kind. */
  list(kind?: CheckKind): readonly RegisteredCheck[] {
    const out: RegisteredCheck[] = [];
    for (const c of this.checks.values()) {
      if (kind && c.kind !== kind) {
        continue;
      }
      out.push({ name: c.name, kind: c.kind, critical: c.critical, timeoutMs: c.timeoutMs });
    }
    return out;
  }

  /** Run checks (optionally only those of `kind`) and build a report. */
  async run(kind?: CheckKind): Promise<HealthReport> {
    const selected = [...this.checks.values()].filter((c) => !kind || c.kind === kind);
    const outcomes = await Promise.all(selected.map((c) => runCheck(c, this.clock)));
    return buildReport(outcomes, new Date(this.clock()).toISOString());
  }

  /** Run only liveness checks. */
  liveness(): Promise<HealthReport> {
    return this.run('liveness');
  }

  /** Run only readiness checks. */
  readiness(): Promise<HealthReport> {
    return this.run('readiness');
  }

  /** Run only startup checks. */
  startup(): Promise<HealthReport> {
    return this.run('startup');
  }

  /** Run checks and produce a transport-agnostic HTTP response. */
  async endpoint(kind?: CheckKind): Promise<EndpointResponse> {
    return toEndpointResponse(await this.run(kind));
  }

  /** Remove every registered check. */
  clear(): void {
    this.checks.clear();
  }
}
