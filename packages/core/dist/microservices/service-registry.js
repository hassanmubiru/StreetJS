// src/microservices/service-registry.ts
// Service discovery: service registry, static backend, and Consul backend.
// ── ServiceRegistry ────────────────────────────────────────────────────────────
export class ServiceRegistry {
    _backend;
    constructor(_backend) {
        this._backend = _backend;
    }
    /** Returns all known instances (healthy or not) for a service. */
    async getInstances(name) {
        return this._backend.getInstances(name);
    }
    /** Returns only healthy instances for a service. */
    async getHealthy(name) {
        const instances = await this._backend.getInstances(name);
        return instances.filter((i) => i.healthy);
    }
}
// ── StaticRegistry ─────────────────────────────────────────────────────────────
export class StaticRegistry {
    _services;
    constructor(_services) {
        this._services = _services;
    }
    async getInstances(name) {
        return this._services[name] ?? [];
    }
}
export class ConsulRegistry {
    _cache = new Map();
    _refreshMs;
    _consulHost;
    _consulPort;
    constructor(opts = {}) {
        this._consulHost = opts.host ?? 'localhost';
        this._consulPort = opts.port ?? 8500;
        this._refreshMs = opts.refreshMs ?? 10_000;
    }
    async getInstances(name) {
        const cached = this._cache.get(name);
        if (cached && Date.now() - cached.fetchedAt < this._refreshMs) {
            return cached.instances;
        }
        const instances = await this._fetchFromConsul(name);
        this._cache.set(name, { instances, fetchedAt: Date.now() });
        return instances;
    }
    _fetchFromConsul(name) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this._consulHost,
                port: this._consulPort,
                path: `/v1/health/service/${encodeURIComponent(name)}?passing=true`,
                method: 'GET',
                rejectUnauthorized: false,
            };
            // Use http for Consul (typically not TLS in development)
            const http = require('node:http');
            const req = http.request(options, (res) => {
                const chunks = [];
                res.on('data', (d) => chunks.push(d));
                res.on('end', () => {
                    try {
                        const body = Buffer.concat(chunks).toString('utf8');
                        const entries = JSON.parse(body);
                        const instances = entries.map((entry) => ({
                            id: entry.Service?.ID ?? '',
                            name: entry.Service?.Service ?? name,
                            host: entry.Service?.Address || entry.Node?.Address || 'localhost',
                            port: entry.Service?.Port ?? 80,
                            healthy: (entry.Checks ?? []).every((c) => c.Status === 'passing'),
                        }));
                        resolve(instances);
                    }
                    catch (err) {
                        reject(err);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }
}
//# sourceMappingURL=service-registry.js.map