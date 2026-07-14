/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Shows how a StreetJS package or application records metrics and exposes them
 * in the Prometheus text format — counters, histograms, labels, timers, and the
 * default process metrics. Self-contained (no other package required).
 */

import {
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  type Registry,
} from '../index.js';

// A tiny "HTTP layer" that receives a registry via constructor injection — the
// interface-first / DI pattern every StreetJS package follows.
class HttpMetrics {
  readonly requests: Counter;
  readonly inFlight: Gauge;
  readonly duration: Histogram;

  constructor(registry: Registry) {
    this.requests = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests.',
      labelNames: ['method', 'status'],
    });
    this.inFlight = new Gauge({
      name: 'http_requests_in_flight',
      help: 'In-flight HTTP requests.',
    });
    this.duration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds.',
      labelNames: ['route'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1],
    });
    registry.register(this.requests);
    registry.register(this.inFlight);
    registry.register(this.duration);
  }

  record(method: string, route: string, status: number, seconds: number): void {
    this.inFlight.inc();
    this.requests.inc({ method, status: String(status) });
    this.duration.observe({ route }, seconds);
    this.inFlight.dec();
  }
}

function main(): void {
  const registry = new MetricsRegistry();
  collectDefaultMetrics(registry);

  const http = new HttpMetrics(registry);
  http.record('GET', '/health', 200, 0.004);
  http.record('GET', '/users', 200, 0.12);
  http.record('POST', '/users', 201, 0.34);
  http.record('GET', '/users', 500, 0.9);

  // In a real app this string is served at /metrics with:
  //   Content-Type: registry.contentType
  process.stdout.write(registry.render());
}

main();
