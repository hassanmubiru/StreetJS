// packages/cli/src/commands/deploy.ts
// `street deploy:init --platform <kubernetes|cloudrun|ecs|nomad>` — writes
// production deployment manifests to the deploy/ directory.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const PLATFORM_FILES = {
    kubernetes: 'deployment.yaml',
    cloudrun: 'service.yaml',
    ecs: 'task-definition.json',
    nomad: 'job.nomad.hcl',
};
export class DeployInitCommand {
    async execute(ctx) {
        const platform = String(ctx.args.flags['platform'] ?? '').toLowerCase();
        if (!(platform in PLATFORM_FILES)) {
            console.error('[street] Usage: street deploy:init --platform <kubernetes|cloudrun|ecs|nomad>');
            process.exitCode = 1;
            return;
        }
        const core = await import('@streetjs/core');
        const config = {
            name: 'street-app',
            image: 'street-app:latest',
            port: Number(process.env['PORT'] ?? 3000),
            replicas: 2,
            env: { NODE_ENV: 'production' },
        };
        const manifest = core.generateManifest(platform, config);
        const dir = resolve(ctx.cwd, 'deploy');
        await mkdir(dir, { recursive: true });
        const fileName = PLATFORM_FILES[platform];
        const content = typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2);
        await writeFile(resolve(dir, fileName), content, 'utf8');
        console.log(`[street] Wrote deploy/${fileName} for ${platform}`);
    }
}
//# sourceMappingURL=deploy.js.map