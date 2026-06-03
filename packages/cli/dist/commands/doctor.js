// packages/cli/src/commands/doctor.ts
// `street doctor` — checks runtime compatibility, env vars, and DB connectivity.
// `street env validate` — validates env vars against street.config.ts.
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
export class DoctorCommand {
    async execute(ctx) {
        const checks = [];
        // ── Node.js version ≥ 20 ─────────────────────────────────────────────
        const nodeMajor = parseInt(process.version.slice(1).split('.')[0] ?? '0', 10);
        checks.push({
            name: 'Node.js version ≥ 20',
            pass: nodeMajor >= 20,
            detail: nodeMajor >= 20
                ? `${process.version} ✓`
                : `${process.version} — upgrade to Node.js ≥ 20 (https://nodejs.org)`,
        });
        // ── TypeScript version ≥ 5.0 ─────────────────────────────────────────
        const tsVersion = await this.readTsVersion(ctx.cwd);
        const tsMajor = tsVersion ? parseInt(tsVersion.split('.')[0] ?? '0', 10) : 0;
        const tsMinor = tsVersion ? parseInt(tsVersion.split('.')[1] ?? '0', 10) : 0;
        const tsOk = tsMajor > 5 || (tsMajor === 5 && tsMinor >= 0);
        checks.push({
            name: 'TypeScript version ≥ 5.0',
            pass: tsOk,
            detail: tsVersion
                ? (tsOk ? `v${tsVersion} ✓` : `v${tsVersion} — upgrade to TypeScript ≥ 5.0 (npm install typescript@latest)`)
                : 'not found — install TypeScript: npm install --save-dev typescript',
        });
        // ── Required env vars from .env.example ──────────────────────────────
        const envCheck = await this.checkEnvVars(ctx.cwd);
        checks.push(envCheck);
        // ── DB connectivity ───────────────────────────────────────────────────
        checks.push(await this.checkDbConnectivity());
        // ── Print results ─────────────────────────────────────────────────────
        console.log('\n  Street Framework — Doctor\n');
        let allPass = true;
        for (const check of checks) {
            const icon = check.pass ? '✓' : '✗';
            const color = check.pass ? '\x1b[32m' : '\x1b[31m';
            const reset = '\x1b[0m';
            console.log(`  ${color}${icon}${reset}  ${check.name}`);
            if (!check.pass || check.detail) {
                console.log(`     ${check.detail}`);
            }
            if (!check.pass)
                allPass = false;
        }
        console.log('');
        if (!allPass) {
            process.exitCode = 1;
        }
    }
    async readTsVersion(cwd) {
        const paths = [
            resolve(cwd, 'node_modules', 'typescript', 'package.json'),
            resolve(cwd, '..', '..', 'node_modules', 'typescript', 'package.json'),
        ];
        for (const p of paths) {
            try {
                const raw = await readFile(p, 'utf8');
                const pkg = JSON.parse(raw);
                if (pkg.version)
                    return pkg.version;
            }
            catch { /* continue */ }
        }
        return null;
    }
    async checkEnvVars(cwd) {
        const examplePath = resolve(cwd, '.env.example');
        try {
            await access(examplePath);
        }
        catch {
            return { name: 'Required env vars (.env.example)', pass: true, detail: '(no .env.example found — skipped)' };
        }
        const raw = await readFile(examplePath, 'utf8');
        const required = [];
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                continue;
            const key = trimmed.split('=')[0]?.trim();
            if (key)
                required.push(key);
        }
        const missing = required.filter((k) => !process.env[k]);
        if (missing.length === 0) {
            return { name: 'Required env vars (.env.example)', pass: true, detail: `All ${required.length} vars present ✓` };
        }
        return {
            name: 'Required env vars (.env.example)',
            pass: false,
            detail: `Missing: ${missing.join(', ')}`,
        };
    }
    async checkDbConnectivity() {
        const host = process.env['PG_HOST'] ?? process.env['PGHOST'] ?? 'localhost';
        const portStr = process.env['PG_PORT'] ?? process.env['PGPORT'] ?? '5432';
        const port = parseInt(portStr, 10);
        const user = process.env['PG_USER'] ?? process.env['PGUSER'] ?? 'postgres';
        const password = process.env['PG_PASSWORD'] ?? process.env['PGPASSWORD'] ?? '';
        const database = process.env['PG_DATABASE'] ?? process.env['PGDATABASE'] ?? 'postgres';
        if (!host) {
            return { name: 'Database connectivity', pass: false, detail: 'PGHOST is not set' };
        }
        try {
            // Dynamic import avoids requiring @streetjs/core to be built
            const { PgConnection } = await import('@streetjs/core');
            const conn = await PgConnection.connect({ host, port, user, password, database, connectTimeoutMs: 3000 });
            await conn.close();
            return { name: 'Database connectivity', pass: true, detail: `Connected to ${host}:${port}/${database} ✓` };
        }
        catch (err) {
            return {
                name: 'Database connectivity',
                pass: false,
                detail: `Cannot connect to ${host}:${port}/${database} — ${err.message}`,
            };
        }
    }
}
export class EnvValidateCommand {
    async execute(ctx) {
        const configPath = resolve(ctx.cwd, 'street.config.js');
        let configModule = null;
        try {
            configModule = await import(configPath);
        }
        catch {
            // Try .ts compiled output
            try {
                configModule = await import(resolve(ctx.cwd, 'dist', 'street.config.js'));
            }
            catch {
                console.error('[street] Could not load street.config.js or dist/street.config.js');
                process.exitCode = 1;
                return;
            }
        }
        const schema = configModule?.default;
        if (!schema || typeof schema !== 'object') {
            console.error('[street] street.config.js must export a default config schema object');
            process.exitCode = 1;
            return;
        }
        const { defineConfig } = await import('@streetjs/core');
        let pass = true;
        try {
            defineConfig(schema);
            console.log('[street] All environment variables are valid ✓');
        }
        catch (err) {
            const { ConfigValidationError: CVE } = await import('@streetjs/core');
            if (err instanceof CVE) {
                console.error('[street] Environment validation failed:');
                for (const e of err.errors) {
                    console.error(`  ✗ ${e}`);
                }
            }
            else {
                console.error('[street] Unexpected error:', err.message);
            }
            pass = false;
        }
        if (!pass)
            process.exitCode = 1;
    }
}
//# sourceMappingURL=doctor.js.map