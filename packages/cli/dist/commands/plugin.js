// packages/cli/src/commands/plugin.ts
// `street plugin:install <name>@<version>` and `street plugin:list`.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export class PluginInstallCommand {
    async execute(ctx) {
        const spec = ctx.args.positional[0];
        if (!spec) {
            console.error('[street] Usage: street plugin:install <name>@<version>');
            process.exitCode = 1;
            return;
        }
        const atIdx = spec.lastIndexOf('@');
        const name = atIdx > 0 ? spec.slice(0, atIdx) : spec;
        const version = atIdx > 0 ? spec.slice(atIdx + 1) : 'latest';
        const registryUrl = String(ctx.args.flags['registry'] ?? process.env['STREET_PLUGIN_REGISTRY'] ?? 'https://plugins.streetjs.dev');
        const pluginsDir = resolve(ctx.cwd, 'plugins');
        const core = await import('@streetjs/core');
        const installer = new core.PluginInstaller({ registryUrl, pluginsDir });
        try {
            await installer.install(name, version);
            console.log(`[street] Installed plugin ${name}@${version} (signature + checksum verified)`);
        }
        catch (err) {
            console.error(`[street] Plugin install failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exitCode = 1;
        }
    }
}
export class PluginListCommand {
    async execute(ctx) {
        const pluginsDir = resolve(ctx.cwd, 'plugins');
        let entries;
        try {
            entries = await readdir(pluginsDir);
        }
        catch {
            console.log('[street] No plugins installed (plugins/ directory not found).');
            return;
        }
        const rows = [];
        for (const entry of entries) {
            try {
                const pkgRaw = await readFile(join(pluginsDir, entry, 'package.json'), 'utf8');
                const pkg = JSON.parse(pkgRaw);
                rows.push({
                    name: pkg.name ?? entry,
                    version: pkg.version ?? '?',
                    status: pkg.street?.verified ? 'verified' : 'unverified',
                });
            }
            catch {
                rows.push({ name: entry, version: '?', status: 'invalid' });
            }
        }
        if (rows.length === 0) {
            console.log('[street] No plugins installed.');
            return;
        }
        console.log('\n  Installed plugins\n');
        for (const r of rows) {
            console.log(`  ${r.name.padEnd(28)} ${r.version.padEnd(10)} ${r.status}`);
        }
        console.log('');
    }
}
//# sourceMappingURL=plugin.js.map