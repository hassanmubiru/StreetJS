// packages/cli/src/commands/info.ts
// `street info` — prints framework, runtime, and project diagnostics.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { platform, arch, release } from 'node:os';
export class InfoCommand {
    async execute(ctx) {
        const rows = [];
        // ── Street version ────────────────────────────────────────────────────
        const streetVersion = await this.readPackageVersion(resolve(ctx.cwd, 'node_modules', '@streetjs', 'core', 'package.json')) ?? await this.readPackageVersion(resolve(ctx.cwd, '..', 'core', 'package.json')) ?? '(unknown)';
        rows.push({ label: 'Street version', value: streetVersion });
        // ── Node.js version ───────────────────────────────────────────────────
        rows.push({ label: 'Node.js version', value: process.version });
        // ── TypeScript version ────────────────────────────────────────────────
        // readPackageVersion already returns "v<version>" or null; fall back to a
        // plain string so we don't accidentally prefix "(not found)" with "v".
        const tsVersion = await this.readPackageVersion(resolve(ctx.cwd, 'node_modules', 'typescript', 'package.json')) ?? '(not found)';
        rows.push({ label: 'TypeScript version', value: tsVersion });
        // ── Operating system ──────────────────────────────────────────────────
        rows.push({ label: 'OS', value: `${platform()} ${arch()} (${release()})` });
        // ── Project config ────────────────────────────────────────────────────
        const projectPkg = await this.readJson(resolve(ctx.cwd, 'package.json'));
        if (projectPkg) {
            rows.push({ label: 'Project', value: `${projectPkg.name ?? '?'} v${projectPkg.version ?? '?'}` });
        }
        // ── Print aligned table ───────────────────────────────────────────────
        const labelWidth = Math.max(...rows.map((r) => r.label.length)) + 2;
        console.log('\n  Street Framework — Info\n');
        for (const { label, value } of rows) {
            console.log(`  ${label.padEnd(labelWidth)}${value}`);
        }
        console.log('');
    }
    async readPackageVersion(pkgPath) {
        const pkg = await this.readJson(pkgPath);
        return pkg?.version ? `v${pkg.version}` : null;
    }
    async readJson(filePath) {
        try {
            const raw = await readFile(filePath, 'utf8');
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=info.js.map