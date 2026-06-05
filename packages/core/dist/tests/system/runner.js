// tests/system/runner.ts
// Unified test orchestrator — runs all system-level test suites, aggregates results,
// generates summary reports. Designed for CI integration and local validation.
// Zero external dependencies — uses only node:test, node:assert, node:fs, node:path.
import { run } from 'node:test';
import { tap } from 'node:test/reporters';
import { argv, exit } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════
const ROOT = dirname(fileURLToPath(import.meta.url));
const SUITES = {
    security: {
        path: join(ROOT, 'security.test.js'),
        label: 'Security — fuzz, bounds, timing attacks',
    },
    'memory-safety': {
        path: join(ROOT, 'memory-safety.test.js'),
        label: 'Memory Safety — heap, bounds, leak detection',
    },
    'load-testing': {
        path: join(ROOT, 'load-testing.test.js'),
        label: 'Load Testing — concurrent HTTP, pool, sustained load',
    },
    'fuzz-testing': {
        path: join(ROOT, 'fuzz-testing.test.js'),
        label: 'Fuzz Testing — randomized inputs, protocol fuzzing',
    },
    'chaos-testing': {
        path: join(ROOT, 'chaos-testing.test.js'),
        label: 'Chaos Testing — fault injection, shutdown, resource exhaustion',
    },
    infrastructure: {
        path: join(ROOT, 'infrastructure.test.js'),
        label: 'Infrastructure — migrations, Docker, telemetry, cluster',
        requiresPg: true,
    },
};
// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════
/** Format elapsed time in a human-readable format */
function fmtDuration(ms) {
    if (ms < 1000)
        return `${ms.toFixed(0)}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    const min = Math.floor(ms / 60000);
    const sec = ((ms % 60000) / 1000).toFixed(1);
    return `${min}m ${sec}s`;
}
/** Format memory bytes to human-readable */
function fmtBytes(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}
async function runSuite(name, config) {
    const start = performance.now();
    // Run the test file using node:test
    const testStream = run({
        files: [config.path],
        timeout: 120_000, // 2 minutes per suite
        concurrency: false,
    });
    // Collect events using TAP reporter
    const tapStream = testStream.compose(tap);
    const chunks = [];
    for await (const chunk of tapStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const durationMs = performance.now() - start;
    const tapOutput = Buffer.concat(chunks).toString('utf8');
    // Parse TAP output for simple pass/fail counts
    const lines = tapOutput.split('\n');
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const line of lines) {
        if (line.startsWith('ok '))
            passed++;
        else if (line.startsWith('not ok '))
            failed++;
        else if (line.includes('# SKIP'))
            skipped++;
    }
    return {
        name,
        label: config.label,
        passed,
        failed,
        skipped,
        durationMs,
        error: failed > 0 ? `TAP output: ${tapOutput}` : undefined,
    };
}
// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
    const args = argv.slice(2);
    const filterSuite = args.find((a) => !a.startsWith('--'));
    const jsonOutput = args.includes('--json');
    const skipPg = args.includes('--skip-pg');
    const ciMode = args.includes('--ci');
    const memBefore = process.memoryUsage().heapUsed;
    // Select suites
    const suitesToRun = filterSuite
        ? { [filterSuite]: SUITES[filterSuite] }
        : SUITES;
    // Validate suite names
    if (filterSuite && !SUITES[filterSuite]) {
        console.error(`Unknown suite: "${filterSuite}"`);
        console.error(`Available suites: ${Object.keys(SUITES).join(', ')}`);
        exit(1);
    }
    // Display banner
    const banner = `
╔══════════════════════════════════════════════════════════════════╗
║           street framework — System Test Runner                 ║
╚══════════════════════════════════════════════════════════════════╝
`;
    console.log(banner);
    if (!filterSuite) {
        console.log(`All ${Object.keys(suitesToRun).length} suites will be executed.\n`);
    }
    else {
        console.log(`Running suite "${filterSuite}" only.\n`);
    }
    // Run suites sequentially (system tests are resource-intensive)
    const results = [];
    for (const [name, config] of Object.entries(suitesToRun)) {
        if (config.requiresPg && skipPg) {
            console.log(`  ⏭  [SKIP] ${config.label} (requires PostgreSQL)\n`);
            results.push({
                name,
                label: config.label,
                passed: 0,
                failed: 0,
                skipped: 1,
                durationMs: 0,
            });
            continue;
        }
        process.stdout.write(`  ▶  ${config.label} ... `);
        try {
            const result = await runSuite(name, config);
            results.push(result);
            if (result.failed === 0) {
                process.stdout.write('✓ passed');
            }
            else {
                process.stdout.write(`✗ failed (${result.failed} failures)`);
            }
            if (result.skipped > 0) {
                process.stdout.write(` (${result.skipped} skipped)`);
            }
            process.stdout.write(` [${fmtDuration(result.durationMs)}]\n`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stdout.write('✗ error\n');
            results.push({
                name,
                label: config.label,
                passed: 0,
                failed: 1,
                skipped: 0,
                durationMs: 0,
                error: msg,
            });
        }
    }
    // ── Summary ────────────────────────────────────────────────────
    const totalPassed = results.reduce((s, r) => s + r.passed, 0);
    const totalFailed = results.reduce((s, r) => s + r.failed, 0);
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
    const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
    const suiteFailed = results.filter((r) => r.failed > 0).length;
    const suitePassed = results.filter((r) => r.failed === 0 && r.passed > 0).length;
    const memAfter = process.memoryUsage().heapUsed;
    const memDelta = memAfter - memBefore;
    const divider = '─'.repeat(62);
    const summary = `
${divider}
  Summary:
  ────────
  Suites passed:  ${suitePassed}/${results.length}
  Suites failed:  ${suiteFailed}
  Tests passed:   ${totalPassed}
  Tests failed:   ${totalFailed}
  Tests skipped:  ${totalSkipped}
  Total duration: ${fmtDuration(totalDuration)}
  Heap delta:     ${fmtBytes(memDelta)} (${fmtBytes(memBefore)} → ${fmtBytes(memAfter)})

${divider}
`;
    console.log(summary);
    // Report failures with details
    if (results.some((r) => r.error)) {
        console.log('\n  Failure Details:\n');
        for (const result of results) {
            if (result.error) {
                console.log(`  ── ${result.label} ──`);
                console.log(result.error);
                console.log();
            }
        }
    }
    // JSON output for CI
    if (jsonOutput) {
        const jsonPath = join(ROOT, 'system-test-results.json');
        await writeFile(jsonPath, JSON.stringify(results, null, 2));
        console.log(`  Results written to: ${jsonPath}\n`);
    }
    // Exit code
    const exitCode = suiteFailed > 0 ? 1 : 0;
    if (ciMode) {
        // CI annotation markers
        if (suiteFailed > 0) {
            console.log(`::error::${suiteFailed} system test suite(s) failed`);
        }
        console.log(`::notice::System tests: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);
    }
    exit(exitCode);
}
main().catch((err) => {
    console.error('Fatal error in runner:', err);
    exit(1);
});
//# sourceMappingURL=runner.js.map