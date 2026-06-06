// packages/edge/src/stubs.ts
// Stub implementations for Node.js APIs not available in Edge runtimes.
export class EdgeRuntimeStub {
    static unavailableApis = [
        'fs',
        'net',
        'tls',
        'dns',
        'child_process',
        'worker_threads',
        'v8',
    ];
    /**
     * Returns true if the current environment is an Edge runtime
     * (Vercel Edge, Cloudflare Workers, Deno Deploy, etc.)
     */
    static isEdgeRuntime() {
        return (typeof globalThis['EdgeRuntime'] === 'string' ||
            typeof globalThis['caches'] !== 'undefined' && typeof process === 'undefined');
    }
}
//# sourceMappingURL=stubs.js.map