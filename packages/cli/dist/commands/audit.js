// packages/cli/src/commands/audit.ts
// `street audit` — runs `npm audit --json` and formats CVE findings as a table.
import { spawn } from 'node:child_process';
const SEVERITY_ORDER = {
    critical: 0,
    high: 1,
    moderate: 2,
    low: 3,
    info: 4,
};
const SEVERITY_COLORS = {
    critical: '\x1b[41m\x1b[37m',
    high: '\x1b[31m',
    moderate: '\x1b[33m',
    low: '\x1b[36m',
    info: '\x1b[90m',
};
const RESET = '\x1b[0m';
export class AuditCommand {
    async execute(ctx) {
        console.log('[street] Running npm audit...\n');
        let result;
        try {
            result = await this.runNpmAudit(ctx.cwd);
        }
        catch (err) {
            // Spawn failure: npm is not installed or could not be launched.
            console.error(`[street] Failed to run npm audit: ${err.message}`);
            process.exitCode = 1;
            return;
        }
        if (!result.output.trim()) {
            console.error('[street] npm audit produced no output — unable to audit dependencies');
            process.exitCode = 1;
            return;
        }
        let audit;
        try {
            audit = JSON.parse(result.output);
        }
        catch {
            console.error('[street] Failed to parse npm audit output');
            process.exitCode = 1;
            return;
        }
        // npm could not complete the audit (e.g. registry unreachable, offline).
        if (audit.error) {
            const summary = audit.error.summary ?? audit.error.detail ?? audit.error.code ?? 'unknown error';
            console.warn(`[street] npm audit could not complete: ${summary}`);
            console.warn('[street] Check your network connection or registry configuration and try again.');
            return;
        }
        const vulns = Object.values(audit.vulnerabilities ?? {});
        if (vulns.length === 0) {
            console.log('  ✓ No known vulnerabilities found\n');
            return;
        }
        this.printSummary(audit, vulns);
        this.printTable(vulns);
        // Per task scope, findings do NOT fail the process here; CI gating is
        // handled elsewhere. Print the report and return.
    }
    printSummary(audit, vulns) {
        const counts = audit.metadata?.vulnerabilities ?? this.countBySeverity(vulns);
        const total = 'total' in counts ? counts.total : vulns.length;
        console.log(`  Summary: ${counts.critical} critical, ${counts.high} high, ` +
            `${counts.moderate} moderate, ${counts.low} low (${total} total)\n`);
    }
    countBySeverity(vulns) {
        const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 };
        for (const v of vulns) {
            if (v.severity in counts) {
                counts[v.severity] += 1;
            }
            counts.total += 1;
        }
        return counts;
    }
    printTable(vulns) {
        const rows = vulns
            .map((v) => ({
            name: v.name,
            severity: v.severity,
            fix: this.describeFix(v.fixAvailable),
        }))
            .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5));
        const nameWidth = Math.max('Package'.length, ...rows.map((r) => r.name.length)) + 2;
        const severityWidth = Math.max('Severity'.length, ...rows.map((r) => r.severity.length)) + 2;
        const header = `  ${'Package'.padEnd(nameWidth)}${'Severity'.padEnd(severityWidth)}Fix`;
        const divider = `  ${'-'.repeat(nameWidth + severityWidth + 'Fix recommendation'.length)}`;
        console.log(header);
        console.log(divider);
        for (const row of rows) {
            const color = SEVERITY_COLORS[row.severity] ?? '';
            const severityCell = `${color}${row.severity.padEnd(severityWidth)}${RESET}`;
            console.log(`  ${row.name.padEnd(nameWidth)}${severityCell}${row.fix}`);
        }
        console.log('');
    }
    describeFix(fixAvailable) {
        if (fixAvailable === false) {
            return 'no fix available';
        }
        if (fixAvailable === true) {
            return 'run `npm audit fix`';
        }
        const breaking = fixAvailable.isSemVerMajor ? ' (breaking change)' : '';
        return `upgrade to ${fixAvailable.name}@${fixAvailable.version}${breaking}`;
    }
    runNpmAudit(cwd) {
        return new Promise((resolve, reject) => {
            const child = spawn('npm', ['audit', '--json'], {
                cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
            });
            let out = '';
            let err = '';
            child.stdout.on('data', (chunk) => {
                out += chunk.toString();
            });
            child.stderr.on('data', (chunk) => {
                err += chunk.toString();
            });
            child.on('error', (e) => {
                reject(e);
            });
            child.on('close', (code) => {
                // `npm audit` exits non-zero when vulnerabilities are found. That is
                // expected — resolve with whatever stdout we captured and let the
                // caller parse it. Only surface an error when there is no output.
                if (out.trim()) {
                    resolve({ output: out, code: code ?? 0 });
                }
                else {
                    reject(new Error(err.trim() || 'npm audit produced no output'));
                }
            });
        });
    }
}
//# sourceMappingURL=audit.js.map