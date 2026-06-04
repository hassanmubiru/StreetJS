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
export declare function measureStreetStartup(): Promise<number>;
/** Run a simple throughput benchmark using Node.js http module */
export declare function runHttpBenchmark(label: string, port: number, durationMs?: number, concurrency?: number): Promise<BenchmarkResult>;
//# sourceMappingURL=http-benchmark.d.ts.map