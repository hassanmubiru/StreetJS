// src/types.ts
// Router-owned validation schema types and the structural profiler contract.

/** Single field validation rule. */
export interface FieldRule {
  type: 'string' | 'number' | 'boolean' | 'email' | 'uuid';
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
}

/** Validation schema (runtime shape validator) applied to body/query/params. */
export interface ValidationSchema {
  body?: Record<string, FieldRule>;
  query?: Record<string, FieldRule>;
  params?: Record<string, FieldRule>;
}

/**
 * Minimal structural contract for a per-route latency profiler. The framework's
 * `RouteProfiler` satisfies it; declaring it structurally keeps the router free
 * of a diagnostics-profiler dependency.
 */
export interface RouteProfiler {
  record(method: string, pathTemplate: string, latencyNs: bigint, isError: boolean): void;
}
