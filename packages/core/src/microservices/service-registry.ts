// src/microservices/service-registry.ts
// Service discovery: service registry, static backend, and Consul backend.

import { request as httpsRequest } from 'node:https';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ServiceInstance {
  id: string;
  name: string;
  host: string;
  port: number;
  healthy: boolean;
  metadata?: Record<string, string>;
}

export interface ServiceRegistryBackend {
  getInstances(name: string): Promise<ServiceInstance[]>;
}

// ── ServiceRegistry ────────────────────────────────────────────────────────────

export class ServiceRegistry {
  constructor(private readonly _backend: ServiceRegistryBackend) {}

  /** Returns all known instances (healthy or not) for a service. */
  async getInstances(name: string): Promise<ServiceInstance[]> {
    return this._backend.getInstances(name);
  }

  /** Returns only healthy instances for a service. */
  async getHealthy(name: string): Promise<ServiceInstance[]> {
    const instances = await this._backend.getInstances(name);
    return instances.filter((i) => i.healthy);
  }
}

// ── StaticRegistry ─────────────────────────────────────────────────────────────

export class StaticRegistry implements ServiceRegistryBackend {
  constructor(private readonly _services: Record<string, ServiceInstance[]>) {}

  async getInstances(name: string): Promise<ServiceInstance[]> {
    return this._services[name] ?? [];
  }
}

// ── ConsulRegistry ─────────────────────────────────────────────────────────────

interface ConsulServiceEntry {
  Node?: { Address?: string };
  Service?: { ID?: string; Service?: string; Address?: string; Port?: number };
  Checks?: Array<{ Status?: string }>;
}

export class ConsulRegistry implements ServiceRegistryBackend {
  private readonly _cache = new Map<string, { instances: ServiceInstance[]; fetchedAt: number }>();
  private readonly _refreshMs: number;
  private readonly _consulHost: string;
  private readonly _consulPort: number;

  constructor(opts: {
    host?: string;
    port?: number;
    refreshMs?: number;
  } = {}) {
    this._consulHost = opts.host ?? 'localhost';
    this._consulPort = opts.port ?? 8500;
    this._refreshMs = opts.refreshMs ?? 10_000;
  }

  async getInstances(name: string): Promise<ServiceInstance[]> {
    const cached = this._cache.get(name);
    if (cached && Date.now() - cached.fetchedAt < this._refreshMs) {
      return cached.instances;
    }

    const instances = await this._fetchFromConsul(name);
    this._cache.set(name, { instances, fetchedAt: Date.now() });
    return instances;
  }

  private _fetchFromConsul(name: string): Promise<ServiceInstance[]> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this._consulHost,
        port: this._consulPort,
        path: `/v1/health/service/${encodeURIComponent(name)}?passing=true`,
        method: 'GET',
        rejectUnauthorized: false,
      };

      // Use http for Consul (typically not TLS in development)
      const http = require('node:http') as typeof import('node:http');
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const entries: ConsulServiceEntry[] = JSON.parse(body);

            const instances: ServiceInstance[] = entries.map((entry) => ({
              id: entry.Service?.ID ?? '',
              name: entry.Service?.Service ?? name,
              host: entry.Service?.Address || entry.Node?.Address || 'localhost',
              port: entry.Service?.Port ?? 80,
              healthy: (entry.Checks ?? []).every((c) => c.Status === 'passing'),
            }));

            resolve(instances);
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }
}
