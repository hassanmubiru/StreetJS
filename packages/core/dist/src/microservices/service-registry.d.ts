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
export declare class ServiceRegistry {
    private readonly _backend;
    constructor(_backend: ServiceRegistryBackend);
    /** Returns all known instances (healthy or not) for a service. */
    getInstances(name: string): Promise<ServiceInstance[]>;
    /** Returns only healthy instances for a service. */
    getHealthy(name: string): Promise<ServiceInstance[]>;
}
export declare class StaticRegistry implements ServiceRegistryBackend {
    private readonly _services;
    constructor(_services: Record<string, ServiceInstance[]>);
    getInstances(name: string): Promise<ServiceInstance[]>;
}
export declare class ConsulRegistry implements ServiceRegistryBackend {
    private readonly _cache;
    private readonly _refreshMs;
    private readonly _consulHost;
    private readonly _consulPort;
    constructor(opts?: {
        host?: string;
        port?: number;
        refreshMs?: number;
    });
    getInstances(name: string): Promise<ServiceInstance[]>;
    private _fetchFromConsul;
}
//# sourceMappingURL=service-registry.d.ts.map