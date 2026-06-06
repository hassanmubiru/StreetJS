// packages/core/src/benchmarks/http-benchmark.ts
// HTTP throughput benchmark: Street vs Express vs Fastify (using autocannon or raw http)

import { createServer, request as httpRequest } from 'node:http';
import { streetApp } from '../http/server.js';
import { Router } from '../router/router.js';

export interface BenchmarkResult {
  name: string;
  requestsPerSec: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  memoryMb: number;
  startupMs: number;
}

/** Measure startup time for a Street app */
export async function measureStreetStartup(): Promise<number> {
  const start = Date.now();
  const app = streetApp({ port: 0 });
  app.use(async (ctx) => { ctx.json({ ok: true }); });
  await app.listen(0);
  const elapsed = Date.now() - start;
  await app.close();
  return elapsed;
}

/** Run a simple throughput benchmark using Node.js http module */
export async function runHttpBenchmark(
  label: string,
  port: number,
  durationMs: number = 5000,
  concurrency: number = 10,
): Promise<BenchmarkResult> {
  const memBefore = process.memoryUsage().heapUsed;
  const results: number[] = [];
  let completed = 0;
  const deadline = Date.now() + durationMs;

  const http = { request: httpRequest };

  await new Promise<void>((resolve) => {
    let inFlight = 0;

    function fire(): void {
      if (Date.now() >= deadline) {
        if (inFlight === 0) resolve();
        return;
      }
      inFlight++;
      const start = Date.now();
      const req = http.request({ host: '127.0.0.1', port, path: '/bench', method: 'GET' }, (res) => {
        res.resume();
        res.on('end', () => {
          results.push(Date.now() - start);
          completed++;
          inFlight--;
          if (Date.now() < deadline) fire();
          else if (inFlight === 0) resolve();
        });
      });
      req.on('error', () => {
        inFlight--;
        if (inFlight === 0 && Date.now() >= deadline) resolve();
      });
      req.end();
    }

    for (let i = 0; i < concurrency; i++) fire();
  });

  results.sort((a, b) => a - b);
  const p50 = results[Math.floor(results.length * 0.5)] ?? 0;
  const p95 = results[Math.floor(results.length * 0.95)] ?? 0;
  const p99 = results[Math.floor(results.length * 0.99)] ?? 0;
  const memAfter = process.memoryUsage().heapUsed;

  return {
    name: label,
    requestsPerSec: Math.round(completed / (durationMs / 1000)),
    latencyP50Ms: p50,
    latencyP95Ms: p95,
    latencyP99Ms: p99,
    memoryMb: Math.round((memAfter - memBefore) / 1024 / 1024 * 100) / 100,
    startupMs: 0,
  };
}

// Suppress "unused import" warning — Router is available for external benchmark extensions
void Router;
void createServer;
