// packages/core/src/benchmarks/run.ts
// Entry point for benchmark suite
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { streetApp } from '../http/server.js';
import { runHttpBenchmark, measureStreetStartup } from './http-benchmark.js';
const BENCHMARK_PORT = 19876;
const DURATION_MS = 3000;
async function runStreetBenchmark() {
    const app = streetApp({ port: BENCHMARK_PORT });
    app.use(async (ctx) => {
        if (ctx.path === '/bench') {
            ctx.json({ message: 'hello world', ts: Date.now() });
        }
    });
    await app.listen(BENCHMARK_PORT);
    const result = await runHttpBenchmark('Street', BENCHMARK_PORT, DURATION_MS, 10);
    result.startupMs = await measureStreetStartup();
    await app.close();
    return result;
}
async function main() {
    console.log('\n🏎  Street Framework HTTP Benchmark\n');
    console.log(`Duration: ${DURATION_MS}ms | Concurrency: 10`);
    console.log('─'.repeat(60));
    const results = [];
    // Street benchmark
    process.stdout.write('Running Street benchmark... ');
    const streetResult = await runStreetBenchmark();
    results.push(streetResult);
    process.stdout.write(`done — ${streetResult.requestsPerSec} req/s\n`);
    // Print results table
    console.log('\n📊 Results:\n');
    console.log(`${'Framework'.padEnd(12)} ${'req/s'.padStart(8)} ${'P50ms'.padStart(7)} ${'P95ms'.padStart(7)} ${'P99ms'.padStart(7)} ${'Mem MB'.padStart(8)}`);
    console.log('─'.repeat(60));
    for (const r of results) {
        console.log(`${r.name.padEnd(12)} ${String(r.requestsPerSec).padStart(8)} ${String(r.latencyP50Ms).padStart(7)} ${String(r.latencyP95Ms).padStart(7)} ${String(r.latencyP99Ms).padStart(7)} ${String(r.memoryMb).padStart(8)}`);
    }
    // Check for baseline regression
    const baselineFlag = process.argv.indexOf('--baseline');
    if (baselineFlag !== -1) {
        const baselineFile = process.argv[baselineFlag + 1];
        if (baselineFile && existsSync(baselineFile)) {
            const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
            const currentRps = streetResult.requestsPerSec;
            const baselineRps = baseline['street_rps'] ?? currentRps;
            const degradation = (baselineRps - currentRps) / baselineRps;
            if (degradation > 0.10) {
                console.error(`\n❌ Performance regression: ${(degradation * 100).toFixed(1)}% below baseline (${baselineRps} req/s → ${currentRps} req/s)`);
                process.exit(1);
            }
            else {
                console.log(`\n✅ Performance within baseline (${(degradation * 100).toFixed(1)}% delta)`);
            }
        }
        else {
            // Write new baseline
            const newBaseline = { street_rps: streetResult.requestsPerSec };
            if (baselineFile)
                writeFileSync(baselineFile, JSON.stringify(newBaseline, null, 2));
            console.log(`\n📝 Wrote baseline: ${streetResult.requestsPerSec} req/s`);
        }
    }
    console.log('\nNote: Express/Fastify/NestJS/Hono/Fiber/Gin comparisons require those frameworks');
    console.log('to be installed. Run: npm install -g autocannon express fastify');
    console.log('Then run: node dist/benchmarks/run.js --compare');
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=run.js.map