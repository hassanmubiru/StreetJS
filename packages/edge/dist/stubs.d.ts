export declare class EdgeRuntimeStub {
    static readonly unavailableApis: ReadonlyArray<string>;
    /**
     * Returns true if the current environment is an Edge runtime
     * (Vercel Edge, Cloudflare Workers, Deno Deploy, etc.)
     */
    static isEdgeRuntime(): boolean;
}
/**
 * Minimal Request/Response polyfills for environments that don't have
 * the global Fetch API. In modern Edge runtimes (CF Workers, Vercel Edge,
 * Deno) these are available natively — the stubs are only used in tests
 * or Node.js <18 environments.
 */
export type EdgeRequest = Request;
export type EdgeResponse = Response;
//# sourceMappingURL=stubs.d.ts.map