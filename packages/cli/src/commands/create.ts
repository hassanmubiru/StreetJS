// packages/cli/src/commands/create.ts
// `street create <name>` — scaffolds a complete Street project from embedded templates.

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CliContext } from '../index.js';

/** Template variants: extra @streetjs deps + a starter module + a description. */
interface TemplateSpec {
  packages: Record<string, string>;
  description: string;
  starter: { path: string; content: string };
}

export const TEMPLATES: Record<string, TemplateSpec> = {
  app: {
    packages: {},
    description: 'Minimal Street app (HTTP, DI, Postgres, health checks).',
    starter: { path: '', content: '' },
  },
  saas: {
    packages: { '@streetjs/admin': '^1.0.0' },
    description: 'SaaS starter: user/role admin + audit log on top of the base app.',
    starter: {
      path: 'src/features/saas.ts',
      content: `// SaaS feature wiring — admin users, roles (RBAC), and an audit log.
import { AdminService } from '@streetjs/admin';

export const admin = new AdminService();
// await admin.createRole('system', { name: 'owner', permissions: ['*'] });
`,
    },
  },
  ecommerce: {
    packages: { '@streetjs/commerce': '^1.0.0' },
    description: 'Ecommerce starter: products, inventory, carts, orders, payments.',
    starter: {
      path: 'src/features/ecommerce.ts',
      content: `// Ecommerce feature wiring — catalog, inventory (no-oversell), checkout.
import { CommerceService } from '@streetjs/commerce';

export const shop = new CommerceService();
// const p = await shop.createProduct({ name: 'Widget', priceCents: 1500 });
`,
    },
  },
  'realtime-chat': {
    packages: { '@streetjs/social-users': '^1.0.0' },
    description: 'Realtime chat starter: WebSocket channels, presence, typing.',
    starter: {
      path: 'src/features/chat.ts',
      content: `// Realtime chat wiring — channels, presence, typing over WebSockets.
import { StreetWebSocketServer, ChannelHub } from 'streetjs';

export const hub = new ChannelHub({ typingTtlMs: 5000 });
export const wss = new StreetWebSocketServer();
`,
    },
  },
  'dating-app': {
    packages: { '@streetjs/dating-profiles': '^1.0.0' },
    description: 'Dating-app starter: profiles, likes, reciprocal matching.',
    starter: {
      path: 'src/features/dating.ts',
      content: `// Dating-app wiring — encrypted profiles, likes, reciprocal matches.
import { ProfileService } from '@streetjs/dating-profiles';
import { FieldCipher, Keyring } from 'streetjs';
import { randomBytes } from 'node:crypto';

export const profiles = new ProfileService({ cipher: new FieldCipher(Keyring.fromKey(randomBytes(32))) });
`,
    },
  },
};



export class CreateCommand {
  async execute(ctx: CliContext): Promise<void> {
    const projectName = ctx.args.positional[0];

    if (!projectName) {
      console.error('[street] Usage: street create <project-name>');
      process.exitCode = 1;
      return;
    }

    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(projectName)) {
      console.error('[street] Project name must start with a letter or number and contain only letters, numbers, hyphens, and underscores.');
      process.exitCode = 1;
      return;
    }

    const targetDir = resolve(ctx.cwd, projectName);

    // Template variant (default 'app'). Variants overlay extra @streetjs
    // packages + a starter module on top of the base scaffold.
    const template = String(ctx.args.flags['template'] ?? 'app');
    if (!TEMPLATES[template]) {
      console.error(`[street] Unknown template "${template}". Available: ${Object.keys(TEMPLATES).join(', ')}`);
      process.exitCode = 1;
      return;
    }

    // Optional frontend scaffold (default 'none'). Adds a `web/` app wired to
    // @streetjs/client + @streetjs/react, plus a CI workflow that builds both.
    const frontend = String(ctx.args.flags['frontend'] ?? 'none').toLowerCase();
    const FRONTENDS = ['none', 'react', 'next'];
    if (!FRONTENDS.includes(frontend)) {
      console.error(`[street] Unknown frontend "${frontend}". Available: ${FRONTENDS.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    // Database driver (default 'sqlite' — zero-config, works out of the box with
    // no local database server or credentials). 'postgres' is for production;
    // its generated startup validates credentials and degrades gracefully rather
    // than crashing when the database is unreachable.
    const database = String(ctx.args.flags['database'] ?? 'sqlite').toLowerCase();
    const DATABASES = ['sqlite', 'postgres'];
    if (!DATABASES.includes(database)) {
      console.error(`[street] Unknown database "${database}". Available: ${DATABASES.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    // Check if target already exists
    try {
      const existing = await stat(targetDir);
      if (existing.isDirectory()) {
        console.error(`[street] Directory "${projectName}" already exists.`);
        process.exitCode = 1;
        return;
      }
    } catch {
      // Directory does not exist — proceed
    }

    console.log(`[street] Creating new Street project: ${projectName}`);
    console.log(`[street] Target: ${targetDir}\n`);

    // Create project directory
    await mkdir(targetDir, { recursive: true });

    // Scaffold all files
    await this.scaffoldProject(targetDir, projectName, database);

    // Apply the template overlay (extra deps + starter module + notes).
    await this.applyTemplate(targetDir, template);

    // Scaffold an optional frontend app + a CI workflow that builds both tiers.
    if (frontend !== 'none') {
      await this.scaffoldFrontend(targetDir, frontend, projectName);
    }
    await this.scaffoldCI(targetDir, frontend);

    console.log(`\n[street] Project "${projectName}" created successfully!\n`);

    // Optional: auto-install dependencies
    const shouldInstall = ctx.args.flags['install'] || ctx.args.flags['i'];
    if (shouldInstall) {
      console.log('[street] Installing dependencies...\n');
      await this.installDependencies(targetDir);
    } else {
      // Generate a package-lock.json so the scaffolded Dockerfile's `npm ci`
      // works out of the box and installs are reproducible. Skip with
      // --no-lockfile (e.g. offline scaffolding). Fail-soft: never blocks the
      // scaffold if npm/network is unavailable.
      if (!ctx.args.flags['no-lockfile']) {
        await this.generateLockfile(targetDir);
      }
      console.log('Next steps:');
      console.log(`  cd ${projectName}`);
      console.log('  npm install');
      console.log('  street dev');
      console.log('');
      console.log('Tip: use --install (or -i) to auto-install dependencies.\n');
    }
  }

  private async scaffoldProject(targetDir: string, projectName: string, database = 'sqlite'): Promise<void> {
    // ── Create all directories first ────────────────────────────────────────
    await mkdir(join(targetDir, 'src', 'controllers'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'services'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'repositories'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'middleware'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'gateways'), { recursive: true });
    await mkdir(join(targetDir, 'migrations'), { recursive: true });
    await mkdir(join(targetDir, 'tests'), { recursive: true });
    await mkdir(join(targetDir, 'uploads'), { recursive: true });
    await mkdir(join(targetDir, 'docker-init'), { recursive: true });

    // ── Generate project files ────────────────────────────────────────────

    // package.json
    await writeFile(
      join(targetDir, 'package.json'),
      this.renderPackageJson(projectName),
      'utf8'
    );

    // street.config.ts
    await writeFile(
      join(targetDir, 'street.config.ts'),
      this.renderStreetConfig(projectName, database),
      'utf8'
    );

    // src/main.ts
    await writeFile(
      join(targetDir, 'src/main.ts'),
      this.renderMainTs(database),
      'utf8'
    );

    // src/controllers/example.controller.ts
    await writeFile(
      join(targetDir, 'src/controllers/example.controller.ts'),
      this.renderExampleController(),
      'utf8'
    );

    // src/controllers/health.controller.ts
    await writeFile(
      join(targetDir, 'src/controllers/health.controller.ts'),
      this.renderHealthController(),
      'utf8'
    );

    // src/services/example.service.ts
    await writeFile(
      join(targetDir, 'src/services/example.service.ts'),
      this.renderExampleService(),
      'utf8'
    );

    // src/repositories/example.repository.ts
    await writeFile(
      join(targetDir, 'src/repositories/example.repository.ts'),
      this.renderExampleRepository(database),
      'utf8'
    );

    // src/middleware/auth.ts
    await writeFile(
      join(targetDir, 'src/middleware/auth.ts'),
      this.renderAuthMiddleware(),
      'utf8'
    );

    // src/gateways/chat.gateway.ts
    await writeFile(
      join(targetDir, 'src/gateways/chat.gateway.ts'),
      this.renderChatGateway(),
      'utf8'
    );

    // tsconfig.json
    await writeFile(
      join(targetDir, 'tsconfig.json'),
      this.renderTsconfig(),
      'utf8'
    );

    // Dockerfile
    await writeFile(
      join(targetDir, 'Dockerfile'),
      this.renderDockerfile(),
      'utf8'
    );

    // docker-compose.yml
    await writeFile(
      join(targetDir, 'docker-compose.yml'),
      this.renderDockerCompose(database),
      'utf8'
    );

    // docker-init/001_enable_pgcrypto.sql
    await writeFile(
      join(targetDir, 'docker-init/001_enable_pgcrypto.sql'),
      'CREATE EXTENSION IF NOT EXISTS pgcrypto;\n',
      'utf8'
    );

    // .env.example
    await writeFile(
      join(targetDir, '.env.example'),
      this.renderEnvExample(database),
      'utf8'
    );

    // .gitignore
    await writeFile(
      join(targetDir, '.gitignore'),
      this.renderGitignore(),
      'utf8'
    );

    // tests/integration.test.ts
    await writeFile(
      join(targetDir, 'tests/integration.test.ts'),
      this.renderTestFile(),
      'utf8'
    );

    // migrations/.gitkeep
    await writeFile(join(targetDir, 'migrations', '.gitkeep'), '', 'utf8');

    // uploads/.gitkeep
    await writeFile(join(targetDir, 'uploads', '.gitkeep'), '', 'utf8');

    // README.md
    await writeFile(
      join(targetDir, 'README.md'),
      this.renderReadme(projectName),
      'utf8'
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /**
   * Generate a `package-lock.json` for the freshly scaffolded project without
   * installing node_modules (`npm install --package-lock-only`). This makes the
   * scaffolded Dockerfile's `npm ci` work out of the box and gives reproducible,
   * integrity-pinned installs. Fail-soft: if npm or the network is unavailable
   * the scaffold still succeeds (the user can run `npm install` later).
   */
  /**
   * Overlay a template variant on top of the base scaffold: merge extra
   * @streetjs dependencies into package.json, write a starter module, and a
   * TEMPLATE.md note. The 'app' template is a no-op overlay.
   */
  private async applyTemplate(targetDir: string, template: string): Promise<void> {
    const spec = TEMPLATES[template];
    if (!spec || template === 'app') return;

    // Merge dependencies into package.json.
    const pkgPath = join(targetDir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
    pkg.dependencies = { ...(pkg.dependencies ?? {}), ...spec.packages };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    // Write the starter module.
    if (spec.starter.path) {
      const starterAbs = join(targetDir, spec.starter.path);
      await mkdir(join(starterAbs, '..'), { recursive: true });
      await writeFile(starterAbs, spec.starter.content, 'utf8');
    }

    // Write a TEMPLATE.md note.
    await writeFile(
      join(targetDir, 'TEMPLATE.md'),
      `# Template: ${template}\n\n${spec.description}\n\nAdded packages: ${Object.keys(spec.packages).join(', ') || '(none)'}\nStarter module: ${spec.starter.path || '(none)'}\n`,
      'utf8',
    );

    console.log(`[street] Applied "${template}" template: ${spec.description}`);
  }

  /**
   * Scaffold an optional frontend app under `web/`, wired to the backend via
   * @streetjs/client + @streetjs/react. 'react' produces a Vite SPA; 'next'
   * produces a minimal App-Router Next.js app. The frontend is a sibling app
   * (its own package.json) — it never becomes a dependency of the backend.
   */
  private async scaffoldFrontend(targetDir: string, frontend: string, projectName: string): Promise<void> {
    const webDir = join(targetDir, 'web');
    if (frontend === 'react') {
      await mkdir(join(webDir, 'src'), { recursive: true });
      await writeFile(join(webDir, 'package.json'), this.renderWebReactPackageJson(projectName), 'utf8');
      await writeFile(join(webDir, 'tsconfig.json'), this.renderWebReactTsconfig(), 'utf8');
      await writeFile(join(webDir, 'vite.config.ts'), this.renderViteConfig(), 'utf8');
      await writeFile(join(webDir, 'index.html'), this.renderWebIndexHtml(projectName), 'utf8');
      await writeFile(join(webDir, 'src', 'main.tsx'), this.renderWebReactMain(), 'utf8');
      await writeFile(join(webDir, 'src', 'App.tsx'), this.renderWebReactApp(projectName), 'utf8');
      await writeFile(join(webDir, '.env.example'), 'VITE_API_URL=http://localhost:3000\n', 'utf8');
      console.log('[street] Scaffolded React (Vite) frontend in web/.');
    } else if (frontend === 'next') {
      await mkdir(join(webDir, 'app'), { recursive: true });
      await writeFile(join(webDir, 'package.json'), this.renderWebNextPackageJson(projectName), 'utf8');
      await writeFile(join(webDir, 'tsconfig.json'), this.renderWebNextTsconfig(), 'utf8');
      await writeFile(join(webDir, 'next.config.mjs'), this.renderNextConfig(), 'utf8');
      await writeFile(join(webDir, 'app', 'layout.tsx'), this.renderNextLayout(projectName), 'utf8');
      await writeFile(join(webDir, 'app', 'page.tsx'), this.renderNextPage(projectName), 'utf8');
      await writeFile(join(webDir, 'app', 'providers.tsx'), this.renderNextProviders(), 'utf8');
      await writeFile(join(webDir, 'app', 'globals.css'), this.renderNextGlobalsCss(), 'utf8');
      await writeFile(join(webDir, '.env.example'), 'NEXT_PUBLIC_API_URL=http://localhost:3000\n', 'utf8');
      console.log('[street] Scaffolded Next.js (App Router) frontend in web/.');
    }
  }

  /** Write a GitHub Actions workflow that builds (and tests) the backend, and the web app when present. */
  private async scaffoldCI(targetDir: string, frontend: string): Promise<void> {
    await mkdir(join(targetDir, '.github', 'workflows'), { recursive: true });
    await writeFile(join(targetDir, '.github', 'workflows', 'ci.yml'), this.renderCIWorkflow(frontend), 'utf8');
    console.log('[street] Added GitHub Actions CI workflow (.github/workflows/ci.yml).');
  }

  private renderWebReactPackageJson(projectName: string): string {
    return JSON.stringify({
      name: `${projectName}-web`,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
        lint: 'tsc --noEmit',
      },
      dependencies: {
        '@streetjs/client': '^0.1.0',
        '@streetjs/react': '^0.1.0',
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
      devDependencies: {
        '@types/react': '^18.3.0',
        '@types/react-dom': '^18.3.0',
        '@vitejs/plugin-react': '^4.3.1',
        typescript: '^5.4.5',
        vite: '^5.4.0',
      },
      // Force a patched transitive postcss (build tooling pins an older one):
      // GHSA-qx2v-qp2m-jg93 (XSS in CSS stringify) is fixed in 8.5.10.
      overrides: {
        postcss: '^8.5.10',
      },
    }, null, 2) + '\n';
  }

  private renderWebReactTsconfig(): string {
    return `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
`;
  }

  private renderViteConfig(): string {
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxies /api and /auth to the Street backend during development.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/search': 'http://localhost:3000',
    },
  },
});
`;
  }

  private renderWebIndexHtml(projectName: string): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
  }

  private renderWebReactMain(): string {
    return `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createStreetClient } from '@streetjs/client';
import { StreetProvider } from '@streetjs/react';
import { App } from './App';

const client = createStreetClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  credentials: 'include',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StreetProvider client={client}>
      <App />
    </StreetProvider>
  </StrictMode>,
);
`;
  }

  private renderWebReactApp(projectName: string): string {
    return `import { useQuery, useAuth } from '@streetjs/react';

interface Health { status: string; uptime: number }

export function App() {
  const { session, loading } = useAuth();
  const health = useQuery<Health>(() =>
    fetch((import.meta.env.VITE_API_URL ?? '') + '/health').then((r) => r.json()),
  );

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>${projectName}</h1>
      <p>Frontend wired to the Street backend via <code>@streetjs/client</code> + <code>@streetjs/react</code>.</p>
      <section>
        <h2>Backend health</h2>
        {health.loading ? <p>Checking…</p> : <pre>{JSON.stringify(health.data, null, 2)}</pre>}
      </section>
      <section>
        <h2>Session</h2>
        {loading ? <p>Loading…</p> : <pre>{JSON.stringify(session ?? null, null, 2)}</pre>}
      </section>
    </main>
  );
}
`;
  }

  private renderWebNextPackageJson(projectName: string): string {
    return JSON.stringify({
      name: `${projectName}-web`,
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        lint: 'next lint',
      },
      dependencies: {
        '@streetjs/client': '^0.1.0',
        '@streetjs/react': '^0.1.0',
        '@streetjs/next': '^0.1.0',
        next: '^16.2.9',
        react: '^19.2.0',
        'react-dom': '^19.2.0',
      },
      devDependencies: {
        '@types/node': '^20.14.0',
        '@types/react': '^19.2.0',
        '@types/react-dom': '^19.2.0',
        typescript: '^5.4.5',
      },
      // Force a patched transitive postcss (next pins an older one):
      // GHSA-qx2v-qp2m-jg93 (XSS in CSS stringify) is fixed in 8.5.10.
      overrides: {
        postcss: '^8.5.10',
      },
    }, null, 2) + '\n';
  }

  private renderWebNextTsconfig(): string {
    return `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;
  }

  private renderNextConfig(): string {
    return `/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const nextConfig = {
  async rewrites() {
    // Proxy API/auth calls to the Street backend so cookies stay first-party.
    return [
      { source: '/api/:path*', destination: apiUrl + '/api/:path*' },
      { source: '/auth/:path*', destination: apiUrl + '/auth/:path*' },
      { source: '/search', destination: apiUrl + '/search' },
    ];
  },
};

export default nextConfig;
`;
  }

  private renderNextLayout(projectName: string): string {
    return `import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: '${projectName} — StreetJS + Next.js',
  description: 'Full-stack TypeScript app powered by StreetJS: auth, realtime, ORM, jobs, AI, and plugins.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
`;
  }

  private renderNextProviders(): string {
    return `'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { createStreetClient } from '@streetjs/client';
import { StreetProvider } from '@streetjs/react';

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(
    () => createStreetClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '', credentials: 'include' }),
    [],
  );
  return <StreetProvider client={client}>{children}</StreetProvider>;
}
`;
  }

  /** Best-effort: the CLI version that scaffolded this project (for display). */
  private cliVersion(): string {
    try {
      const url = new URL('../../package.json', import.meta.url);
      const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
      return pkg.version ? 'v' + pkg.version : '';
    } catch {
      return '';
    }
  }

  private renderNextPage(_projectName: string): string {
    return `'use client';

import { useEffect, useState } from 'react';
import { useQuery, useAuth } from '@streetjs/react';

const DOCS = 'https://hassanmubiru.github.io/StreetJS/';
const GITHUB = 'https://github.com/hassanmubiru/StreetJS';
const NPM = 'https://www.npmjs.com/package/streetjs';
const VERSION = '${this.cliVersion()}';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Health { status?: string; uptime?: number }

type RealtimeState = 'connecting' | 'connected' | 'disconnected' | 'unconfigured';

function useRealtimeStatus(apiUrl: string): RealtimeState {
  const [state, setState] = useState<RealtimeState>(apiUrl ? 'connecting' : 'unconfigured');
  useEffect(() => {
    if (!apiUrl || typeof WebSocket === 'undefined') { setState('unconfigured'); return; }
    const wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\\/$/, '') + '/realtime';
    let ws: WebSocket | null = null;
    try { ws = new WebSocket(wsUrl); } catch { setState('disconnected'); return; }
    const onOpen = () => setState('connected');
    const onDown = () => setState('disconnected');
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onDown);
    ws.addEventListener('close', onDown);
    return () => { ws?.removeEventListener('open', onOpen); ws?.removeEventListener('error', onDown); ws?.removeEventListener('close', onDown); ws?.close(); };
  }, [apiUrl]);
  return state;
}

const QUICKSTART = ['npx @streetjs/cli create my-app', 'cd my-app', 'npm install', 'npm run dev'];

const FEATURES: Array<{ title: string; desc: string }> = [
  { title: 'Authentication', desc: 'JWT authentication, sessions, permissions, and role-based access control.' },
  { title: 'Realtime', desc: 'WebSockets, channels, presence, and live updates.' },
  { title: 'Database', desc: 'SQLite and PostgreSQL support with ORM integration.' },
  { title: 'Jobs & Scheduling', desc: 'Background processing and scheduled workloads.' },
  { title: 'Security', desc: 'Plugin signing, provenance, SBOM generation, and a dependency-light architecture.' },
  { title: 'TypeScript First', desc: 'Built for modern TypeScript development from the ground up.' },
];

const WHY: string[] = [
  'Dependency-light architecture',
  'Self-host friendly deployment',
  'Built-in authentication support',
  'Built-in realtime capabilities',
  'Plugin ecosystem',
  'Supply-chain integrity features',
  'TypeScript-first development',
];

const DX: string[] = [
  'Fast project scaffolding',
  'Hot reload',
  'CLI tooling',
  'Modular architecture',
  'Plugin system',
  'API-first workflows',
];

const RESOURCES: Array<{ icon: string; title: string; desc: string; href: string }> = [
  { icon: '📘', title: 'Documentation', desc: 'Guides, references, and concepts.', href: DOCS },
  { icon: '🚀', title: 'Getting Started', desc: 'Build your first app step by step.', href: DOCS + 'getting-started/' },
  { icon: '💻', title: 'GitHub', desc: 'Source code and issues.', href: GITHUB },
  { icon: '🧩', title: 'Examples', desc: 'Reference apps and patterns.', href: DOCS + 'examples/' },
  { icon: '💬', title: 'Community', desc: 'Discussions and support.', href: GITHUB + '/discussions' },
];

export default function Home() {
  const auth = useAuth();
  const health = useQuery<Health>(() => fetch(API_URL + '/health').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }));
  const realtime = useRealtimeStatus(API_URL);
  const [copied, setCopied] = useState(false);

  const backendOk = !health.loading && !health.error;
  const hasSession = Boolean(auth.session);

  const copy = () => {
    try { void navigator.clipboard.writeText(QUICKSTART.join(String.fromCharCode(10))); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  const status: Array<{ label: string; state: 'ok' | 'pending' | 'idle'; detail: string }> = [
    { label: 'Backend Status', state: health.loading ? 'pending' : backendOk ? 'ok' : 'idle', detail: backendOk ? 'Ready' : health.loading ? 'Checking' : 'Not connected' },
    { label: 'API Connectivity', state: health.loading ? 'pending' : backendOk ? 'ok' : 'idle', detail: backendOk ? 'Connected' : health.loading ? 'Checking' : 'Offline' },
    { label: 'Authentication', state: 'ok', detail: hasSession ? 'Signed in' : 'Ready' },
    { label: 'Realtime', state: realtime === 'connected' ? 'ok' : realtime === 'connecting' ? 'pending' : 'idle', detail: realtime === 'connected' ? 'Connected' : realtime === 'connecting' ? 'Connecting' : realtime === 'unconfigured' ? 'Ready' : 'Offline' },
  ];

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">StreetJS</span>
        <nav className="topnav">
          <a href={DOCS}>Docs</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <section className="hero">
        {VERSION ? <span className="pill">{VERSION}</span> : null}
        <h1>Build Production Applications Faster</h1>
        <p className="lead">
          StreetJS is a modern TypeScript backend framework designed for authentication, realtime
          features, APIs, jobs, and databases with a focus on simplicity, performance, and security.
        </p>
        <div className="actions">
          <a className="btn btn-primary" href={DOCS + 'getting-started/'}>Get Started</a>
          <a className="btn btn-ghost" href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </section>

      <section className="quickstart">
        <div className="qs-head">
          <h2 className="section-title">Quick Start</h2>
          <button className="btn btn-small" onClick={copy} type="button">{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div className="codeblock">
          {QUICKSTART.map((line) => (<span key={line} className="code-line"><span className="prompt">$</span> {line}</span>))}
        </div>
        <p className="muted">Create and run a StreetJS application in minutes.</p>
      </section>

      <section>
        <h2 className="section-title">Core Features</h2>
        <div className="grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">Framework Status</h2>
        <div className="status-grid">
          {status.map((s) => (
            <div key={s.label} className="status-card">
              <span className={'dot dot-' + s.state} />
              <div>
                <div className="status-label">{s.label}</div>
                <div className="status-detail">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h2 className="section-title">Why StreetJS</h2>
          <ul className="checklist">
            {WHY.map((w) => (<li key={w}><span className="check">✓</span> {w}</li>))}
          </ul>
        </div>
        <div className="panel">
          <h2 className="section-title">Built for Developers</h2>
          <ul className="checklist">
            {DX.map((d) => (<li key={d}><span className="check">✓</span> {d}</li>))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className="section-title">Resources</h2>
        <div className="grid">
          {RESOURCES.map((r) => (
            <a key={r.title} className="card card-link" href={r.href} target="_blank" rel="noreferrer">
              <span className="card-icon" aria-hidden="true">{r.icon}</span>
              <h3>{r.title}</h3>
              <p>{r.desc}</p>
            </a>
          ))}
        </div>
      </section>

      <footer className="footer">
        <nav className="footer-links">
          <a href={DOCS} target="_blank" rel="noreferrer">Documentation</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
          <a href={NPM} target="_blank" rel="noreferrer">npm</a>
          <a href={DOCS + 'security/'} target="_blank" rel="noreferrer">Security</a>
          <a href={GITHUB + '/discussions'} target="_blank" rel="noreferrer">Community</a>
        </nav>
        <span className="muted">MIT Licensed{VERSION ? ' · StreetJS ' + VERSION : ''}</span>
      </footer>
    </div>
  );
}
`;
  }

  private renderNextGlobalsCss(): string {
    return `:root {
  --bg: #ffffff;
  --bg-soft: #f6f7f9;
  --surface: #ffffff;
  --border: #e6e8ec;
  --text: #0b1220;
  --muted: #5b667a;
  --brand: #4f46e5;
  --brand-2: #7c3aed;
  --ok: #16a34a;
  --idle: #94a3b8;
  --code-bg: #0f172a;
  --code-fg: #e2e8f0;
  --shadow: 0 1px 2px rgba(16,24,40,.06), 0 10px 30px rgba(16,24,40,.06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1020;
    --bg-soft: #0e1430;
    --surface: #121a33;
    --border: #243049;
    --text: #e7ecf5;
    --muted: #9aa6bd;
    --brand: #8b8cff;
    --brand-2: #b58bff;
    --ok: #34d399;
    --idle: #64748b;
    --code-bg: #060a17;
    --code-fg: #d7e0f0;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 12px 34px rgba(0,0,0,.35);
  }
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
code, .codeblock { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }

.page { max-width: 1040px; margin: 0 auto; padding: 24px 20px 72px; display: flex; flex-direction: column; gap: 44px; }

.topbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
.brand { font-weight: 800; letter-spacing: -.01em; font-size: 18px; }
.topnav { display: flex; gap: 18px; font-weight: 600; font-size: 14px; }
.topnav a { color: var(--muted); }

.hero { text-align: center; padding: 40px 8px 8px; background:
  radial-gradient(900px 400px at 50% -10%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 70%); border-radius: 20px; }
.pill { display: inline-block; font-size: 12px; font-weight: 700; color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, transparent); border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent); padding: 4px 12px; border-radius: 999px; }
.hero h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1.05; letter-spacing: -.03em; margin: 16px auto 12px; max-width: 18ch; }
.hero .lead { color: var(--muted); font-size: clamp(16px, 2.3vw, 19px); max-width: 64ch; margin: 0 auto 28px; }

.actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 11px 20px; border-radius: 11px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-weight: 650; font-size: 15px; cursor: pointer; transition: transform .05s ease, box-shadow .15s ease, background .15s ease; }
.btn:hover { text-decoration: none; box-shadow: var(--shadow); }
.btn:active { transform: translateY(1px); }
.btn-primary { background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #fff; border-color: transparent; }
.btn-ghost { background: transparent; }
.btn-small { padding: 6px 12px; font-size: 13px; }

.section-title { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 16px; }

.quickstart .qs-head { display: flex; align-items: center; justify-content: space-between; }
.codeblock { background: var(--code-bg); color: var(--code-fg); border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; overflow: auto; }
.code-line { white-space: pre; }
.prompt { color: #64748b; user-select: none; }
.muted { color: var(--muted); font-size: 14px; }

.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 22px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 8px; color: var(--text); }
.card h3 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
.card p { margin: 0; color: var(--muted); font-size: 14px; }
.card-link { transition: transform .08s ease, box-shadow .15s ease; }
.card-link:hover { text-decoration: none; transform: translateY(-2px); box-shadow: 0 14px 36px rgba(16,24,40,.12); }
.card-icon { font-size: 22px; }

.status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
.status-card { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; box-shadow: var(--shadow); }
.status-label { font-weight: 650; font-size: 14px; }
.status-detail { color: var(--muted); font-size: 13px; }
.dot { width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto; }
.dot-ok { background: var(--ok); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 18%, transparent); }
.dot-pending { background: var(--brand); box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 18%, transparent); }
.dot-idle { background: var(--idle); box-shadow: 0 0 0 4px color-mix(in srgb, var(--idle) 16%, transparent); }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 22px; box-shadow: var(--shadow); }
.checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.checklist li { display: flex; align-items: center; gap: 10px; font-size: 15px; }
.check { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); font-size: 12px; font-weight: 800; flex: 0 0 auto; }

.footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; border-top: 1px solid var(--border); padding-top: 24px; }
.footer-links { display: flex; flex-wrap: wrap; gap: 18px; font-weight: 600; font-size: 14px; }
.footer-links a { color: var(--muted); }

@media (max-width: 760px) {
  .two-col { grid-template-columns: 1fr; }
}
`;
  }

  private renderCIWorkflow(frontend: string): string {
    const webJob = frontend === 'none' ? '' : `
  web:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm run lint
      - run: npm run build
`;
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  backend:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm run build
${webJob}`;
  }

  private async generateLockfile(cwd: string): Promise<void> {
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolvePromise) => {
      const proc = spawn('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], {
        cwd,
        stdio: 'ignore',
        shell: true,
      });
      proc.on('close', (code) => {
        if (code === 0) {
          console.log('[street] Generated package-lock.json (reproducible installs; enables `npm ci`).');
        } else {
          console.warn('[street] Could not generate package-lock.json (offline?). Run `npm install` before `npm ci` / the Docker build.');
        }
        resolvePromise();
      });
      proc.on('error', () => {
        console.warn('[street] npm not available — skipped package-lock.json generation.');
        resolvePromise();
      });
    });
  }

  private async installDependencies(cwd: string): Promise<void> {
    const { spawn } = await import('node:child_process');
    return new Promise((resolvePromise, reject) => {
      const proc = spawn('npm', ['install'], {
        cwd,
        stdio: 'inherit',
        shell: true,
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log('\n[street] Dependencies installed. Ready to develop!');
          console.log(`  cd ${cwd.split('/').pop()}`);
          console.log('  street dev\n');
          resolvePromise();
        } else {
          reject(new Error(`npm install failed with exit code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run npm install: ${err.message}`));
      });
    });
  }

  private renderPackageJson(projectName: string): string {
    return JSON.stringify(
      {
        name: projectName,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'street dev',
          build: 'street build',
          start: 'street start',
          test: 'street test',
          migrate: 'street migrate:run',
          'migrate:create': 'street migrate:create',
        },
        dependencies: {
          'streetjs': '^1.0.6',
          'reflect-metadata': '^0.2.2',
          ws: '^8.18.0',
        },
        devDependencies: {
          '@types/node': '^20.14.0',
          '@types/ws': '^8.5.10',
          typescript: '^5.4.5',
        },
      },
      null,
      2
    );
  }

  private renderStreetConfig(_projectName: string, database = 'sqlite'): string {
    if (database === 'sqlite') {
      return `// street.config.ts
// Street framework configuration (SQLite — zero-config default).
// Environment variables are loaded automatically at runtime.

import type { StreetAppOptions } from 'streetjs';

export default {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  host: process.env['HOST'] ?? '0.0.0.0',
  // SQLite needs no server or credentials. ':memory:' is an ephemeral
  // in-process database (resets on restart) — perfect for first runs and tests.
  // Switch to PostgreSQL for production: recreate with \`--database postgres\`.
  dbDriver: process.env['DB_DRIVER'] ?? 'sqlite',
  sqlitePath: process.env['SQLITE_PATH'] ?? ':memory:',
  jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  sessionKey: process.env['SESSION_KEY'] ?? 'change-me-session-key',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  uploadsDir: process.env['UPLOADS_DIR'] ?? './uploads',
  migrationsDir: process.env['MIGRATIONS_DIR'] ?? './migrations',
  requestTimeoutMs: 30_000,
  maxBodyBytes: 1_048_576,
} satisfies Partial<StreetAppOptions>;
`;
    }
    return `// street.config.ts
// Street framework configuration (PostgreSQL).
// Environment variables are loaded automatically at runtime.
//
// PG_USER / PG_PASSWORD / PG_DATABASE have NO defaults on purpose — set them in
// your .env (see .env.example). The app validates these on startup and refuses
// to connect with guessed credentials.

import type { StreetAppOptions } from 'streetjs';

export default {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  host: process.env['HOST'] ?? '0.0.0.0',
  dbDriver: process.env['DB_DRIVER'] ?? 'postgres',
  pgHost: process.env['PG_HOST'] ?? 'localhost',
  pgPort: parseInt(process.env['PG_PORT'] ?? '5432', 10),
  pgDatabase: process.env['PG_DATABASE'],
  pgUser: process.env['PG_USER'],
  pgPassword: process.env['PG_PASSWORD'],
  jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  sessionKey: process.env['SESSION_KEY'] ?? 'change-me-session-key',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  uploadsDir: process.env['UPLOADS_DIR'] ?? './uploads',
  migrationsDir: process.env['MIGRATIONS_DIR'] ?? './migrations',
  requestTimeoutMs: 30_000,
  maxBodyBytes: 1_048_576,
} satisfies Partial<StreetAppOptions>;
`;
  }

  private renderMainTs(database = 'sqlite'): string {
    const isSqlite = database === 'sqlite';
    return `// src/main.ts
// Street application entry point.

import 'reflect-metadata';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  streetApp,
  container,
  securityHeaders,
  corsMiddleware,
  xssMiddleware,
  telemetryMiddleware,
  TelemetryTracker,
  RateLimiter,
  StreetWebSocketServer,
  ${isSqlite ? 'SqlitePool' : 'PgPool'},
  ${isSqlite ? '' : 'StreetMigrationRunner,\n  '}JwtService,
  SessionManager,
  WebhookDispatcher,
  LruCache,
} from 'streetjs';
import { HealthController } from './controllers/health.controller.js';
import { ExampleController } from './controllers/example.controller.js';

async function bootstrap(): Promise<void> {
  // ── Configuration ────────────────────────────────────────────────────
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const uploadsDir = resolve(process.env['UPLOADS_DIR'] ?? './uploads');
  // Note: MIGRATIONS_DIR env var is used by the migration runner internally

  // ── Secrets ──────────────────────────────────────────────────────────
  // JwtService requires a secret ≥32 chars; SessionManager requires a 64-char
  // hex key. In development we generate a valid ephemeral key when one isn't
  // provided (so first run works with zero config). In production these MUST be
  // set explicitly — we fail fast rather than start with throwaway keys.
  const isProd = (process.env['NODE_ENV'] ?? 'development') === 'production';
  const resolveSecret = (name: string, bytes: number): string => {
    const provided = process.env[name];
    if (provided && provided.length > 0) return provided;
    if (isProd) {
      throw new Error(\`\${name} must be set in production. Generate one with: openssl rand -hex \${bytes}\`);
    }
    console.warn(\`[street] \${name} not set — using an ephemeral development key. Set it in .env for stable sessions/tokens and for production.\`);
    return randomBytes(bytes).toString('hex');
  };
  const jwtSecret = resolveSecret('JWT_SECRET', 24);   // 48 hex chars (≥32)
  const sessionKey = resolveSecret('SESSION_KEY', 32);  // 64 hex chars

  // ── CORS ─────────────────────────────────────────────────────────────
  // SECURITY: the default ['*'] allows requests from ANY origin, which is fine
  // for local development but UNSAFE in production — it lets any website call
  // your API with the user's credentials. Set CORS_ORIGINS to a comma-separated
  // allowlist (e.g. "https://app.example.com,https://admin.example.com") before
  // deploying. In production we refuse to fall back to the wildcard.
  const corsOrigins = (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (corsOrigins.length === 0) {
    if (isProd) {
      throw new Error('CORS_ORIGINS must be set in production (comma-separated allowlist of trusted origins).');
    }
    console.warn('[street] CORS_ORIGINS not set — allowing all origins (*) for development only. Set an allowlist before deploying.');
    corsOrigins.push('*');
  }

  // ── Database ─────────────────────────────────────────────────────────
${isSqlite ? `  // SQLite: zero-config, no server or credentials required. The default
  // ':memory:' database is ephemeral (resets on restart). Set SQLITE_PATH to a
  // file for local persistence, or recreate with \\\`--database postgres\\\` for
  // production.
  const pool = new SqlitePool({ filePath: process.env['SQLITE_PATH'] ?? ':memory:' });
  // Bootstrap the example schema so the app works out of the box.
  await pool.query(
    \`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )\`
  );
  container.register(SqlitePool, pool);
  console.log('[street] Database ready (sqlite).');` : `  // PostgreSQL: validate credentials BEFORE opening a connection. We never
  // guess a username/password — missing credentials are a configuration error,
  // not something to paper over with 'postgres'/'postgres'.
  function requireEnv(name: string): string | null {
    const v = process.env[name];
    return v && v.length > 0 ? v : null;
  }
  const pgUser = requireEnv('PG_USER');
  const pgPassword = requireEnv('PG_PASSWORD');
  const pgDatabase = requireEnv('PG_DATABASE');

  let pool: PgPool | null = null;
  if (!pgUser || !pgPassword || !pgDatabase) {
    const missing = [
      !pgUser ? 'PG_USER' : null,
      !pgPassword ? 'PG_PASSWORD' : null,
      !pgDatabase ? 'PG_DATABASE' : null,
    ].filter(Boolean).join(', ');
    console.warn(
      \`[street] Database not configured: missing \${missing}.\\n\` +
      '[street] Copy .env.example to .env and set your PostgreSQL credentials,\\n' +
      '[street] or recreate the project with: street create <name> --database sqlite\\n' +
      '[street] The server will start, but database-backed routes will return 503 until configured.'
    );
  } else {
    pool = new PgPool({
      host: process.env['PG_HOST'] ?? 'localhost',
      port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
      user: pgUser,
      password: pgPassword,
      database: pgDatabase,
      minConnections: 2,
      maxConnections: 10,
      idleTimeoutMs: 30_000,
      acquireTimeoutMs: 5_000,
    });
    try {
      await pool.initialize();
      container.register(PgPool, pool);
      container.register(StreetMigrationRunner, new StreetMigrationRunner(pool));
      console.log('[street] Database ready (postgres).');
    } catch (err) {
      // Do not crash the dev server on a database connection failure — surface a
      // clear, actionable message and keep serving (health + non-DB routes work).
      console.warn(
        \`[street] Could not connect to PostgreSQL: \${err instanceof Error ? err.message : String(err)}\\n\` +
        '[street] Check PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE in your .env.\\n' +
        '[street] The server will start, but database-backed routes will return 503 until the database is reachable.'
      );
      await pool.close().catch(() => {});
      pool = null;
    }
  }`}

  // ── Services ─────────────────────────────────────────────────────────
  const telemetry = new TelemetryTracker(60_000);
  container.register(TelemetryTracker, telemetry);

  const wsServer = new StreetWebSocketServer({
    heartbeatIntervalMs: 30_000,
    maxConnections: 10_000,
  });
  container.register(StreetWebSocketServer, wsServer);

  container.register(JwtService, new JwtService(jwtSecret));
  container.register(SessionManager, new SessionManager(sessionKey));
  container.register(WebhookDispatcher, new WebhookDispatcher());
  container.register(LruCache, new LruCache({ maxEntries: 1000, ttlMs: 60_000 }));

  // ── HTTP server ──────────────────────────────────────────────────────
  const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 300 });

  const app = streetApp({
    port,
    host,
    uploadsDir,
    requestTimeoutMs: 30_000,
    maxBodyBytes: 1_048_576,
  });

  // Global middleware
  app.use(securityHeaders);
  app.use(corsMiddleware(corsOrigins));
  app.use(xssMiddleware);
  app.use(telemetryMiddleware(telemetry));
  app.use(rateLimiter.middleware());

  // Register controllers
  // WARNING: The example routes below are UNAUTHENTICATED and must be protected
  // before public exposure. Use JwtService or SessionManager (see src/middleware/auth.ts)
  // to add authentication guards before deploying to production.
  app.registerController(HealthController);
  app.registerController(ExampleController);

  // ── OpenAPI spec ──────────────────────────────────────────────────────
  const openApiSpec = app.openApiSpec();
  app.use(async (ctx, next) => {
    if (ctx.path === '/openapi.json' && ctx.method === 'GET') {
      ctx.json(openApiSpec);
      return;
    }
    await next();
  });

  // ── Start server ─────────────────────────────────────────────────────
  await app.listen(port, host);

  // ── Graceful shutdown ────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(\`[street] Received \${signal}. Shutting down...\`);
    try {
      await app.close();
      await wsServer.close();
      ${isSqlite ? 'await pool.close();' : 'if (pool) await pool.close();'}
      telemetry.destroy();
      rateLimiter.destroy();
    } catch (err) {
      console.error('[street] Shutdown error:', err);
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[street] Fatal error:', err);
  process.exit(1);
});
`;
  }

  private renderExampleController(): string {
    return `// src/controllers/example.controller.ts
// Example REST controller demonstrating CRUD operations.

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  ApiOperation,
  container,
} from 'streetjs';
import type { StreetContext } from 'streetjs';
import { ExampleService, CreateItemInput, UpdateItemInput } from '../services/example.service.js';

@Controller('/api/items')
export class ExampleController {
  private readonly exampleService = container.resolve(ExampleService);

  @Get('/')
  @ApiOperation({ summary: 'List all items', tags: ['items'] })
  async findAll(ctx: StreetContext): Promise<void> {
    const page = parseInt(ctx.query['page'] ?? '1', 10);
    const limit = parseInt(ctx.query['limit'] ?? '20', 10);
    const result = await this.exampleService.findAll(page, limit);
    ctx.json(result);
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Get item by ID', tags: ['items'] })
  async findById(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) {
      ctx.json({ error: 'Missing id parameter' }, 400);
      return;
    }
    const item = await this.exampleService.findById(id);
    if (!item) {
      ctx.json({ error: 'Item not found' }, 404);
      return;
    }
    ctx.json(item);
  }

  @Post('/')
  @ApiOperation({ summary: 'Create a new item', tags: ['items'] })
  async create(ctx: StreetContext): Promise<void> {
    const data = ctx.body as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || !data['name'] || typeof data['name'] !== 'string') {
      ctx.json({ error: 'Invalid request body — name is required' }, 400);
      return;
    }
    const input: CreateItemInput = {
      name: data['name'],
      description: typeof data['description'] === 'string' ? data['description'] : undefined,
    };
    const item = await this.exampleService.create(input);
    ctx.json(item, 201);
  }

  @Put('/:id')
  @ApiOperation({ summary: 'Update an item', tags: ['items'] })
  async update(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    const data = ctx.body as Record<string, unknown> | null;
    if (!id || !data) {
      ctx.json({ error: 'Missing id or body' }, 400);
      return;
    }
    const item = await this.exampleService.update(id, data as UpdateItemInput);
    if (!item) {
      ctx.json({ error: 'Item not found' }, 404);
      return;
    }
    ctx.json(item);
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete an item', tags: ['items'] })
  async delete(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) {
      ctx.json({ error: 'Missing id parameter' }, 400);
      return;
    }
    await this.exampleService.delete(id);
    ctx.send(204);
  }
}
`;
  }

  private renderHealthController(): string {
    return `// src/controllers/health.controller.ts
// Health check endpoint for monitoring and orchestration.

import { Controller, Get, ApiOperation } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/health')
export class HealthController {
  @Get('/')
  @ApiOperation({ summary: 'Health check', tags: ['system'] })
  async check(ctx: StreetContext): Promise<void> {
    ctx.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  }
}
`;
  }

  private renderExampleService(): string {
    return `// src/services/example.service.ts
// Example service with business logic layer.

import { Injectable } from 'streetjs';
import { ExampleRepository } from '../repositories/example.repository.js';

export interface Item {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateItemInput {
  name: string;
  description?: string;
}

export interface UpdateItemInput {
  name?: string;
  description?: string;
}

@Injectable()
export class ExampleService {
  constructor(private readonly repository: ExampleRepository) {}

  async findAll(page: number, limit: number) {
    return this.repository.findAll(page, limit);
  }

  async findById(id: string): Promise<Item | null> {
    return this.repository.findById(id);
  }

  async create(input: CreateItemInput): Promise<Item> {
    const now = new Date();
    const item: Item = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description ?? '',
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(item);
    return item;
  }

  async update(id: string, input: UpdateItemInput): Promise<Item | null> {
    const existing = await this.repository.findById(id);
    if (!existing) return null;

    const updated: Item = {
      ...existing,
      ...input,
      updatedAt: new Date(),
    };
    await this.repository.update(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
`;
  }

  private renderExampleRepository(database = 'sqlite'): string {
    const isSqlite = database === 'sqlite';
    const PoolType = isSqlite ? 'SqlitePool' : 'PgPool';
    // SQLite uses '?' positional placeholders; PostgreSQL uses '$1', '$2', …
    const ph = (n: number): string => (isSqlite ? '?' : `$${n}`);
    return `// src/repositories/example.repository.ts
// Example repository backed by the Street framework's ${isSqlite ? 'SQLite' : 'PostgreSQL'} pool.
//
// The pool is resolved LAZILY (inside each method), not in a field initializer,
// so the repository can be constructed even when the database is not yet
// configured. If it isn't, queries throw a clear error that the framework turns
// into an HTTP 503 — the server keeps running.

import { Injectable, container, ${PoolType}, ServiceUnavailableException } from 'streetjs';
import type { Item } from '../services/example.service.js';

type Row = Record<string, unknown>;

/** Map a database row to an Item */
function rowToItem(row: Row): Item {
  return {
    id: String(row['id'] ?? ''),
    name: String(row['name'] ?? ''),
    description: String(row['description'] ?? ''),
    createdAt: new Date(String(row['created_at'] ?? Date.now())),
    updatedAt: new Date(String(row['updated_at'] ?? Date.now())),
  };
}

@Injectable()
export class ExampleRepository {
  /** Lazily resolve the pool; throw a 503 (not a crash) if unconfigured. */
  private get pool(): ${PoolType} {
    try {
      return container.resolve(${PoolType});
    } catch {
      throw new ServiceUnavailableException('Database not configured — set credentials in .env (see .env.example).');
    }
  }

  async findAll(page: number, limit: number): Promise<{ items: Item[]; total: number }> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        'SELECT * FROM items ORDER BY created_at DESC LIMIT ${ph(1)} OFFSET ${ph(2)}',
        [limit, offset]
      ),
      this.pool.query('SELECT COUNT(*) AS total FROM items'),
    ]);

    const items = (dataResult.rows as Row[]).map(rowToItem);
    const total = parseInt(String(countResult.rows[0]?.['total'] ?? '0'), 10);

    return { items, total };
  }

  async findById(id: string): Promise<Item | null> {
    const result = await this.pool.query(
      'SELECT * FROM items WHERE id = ${ph(1)}',
      [id]
    );
    const row = result.rows[0] as Row | undefined;
    return row ? rowToItem(row) : null;
  }

  async create(item: Item): Promise<void> {
    await this.pool.query(
      \`INSERT INTO items (id, name, description, created_at, updated_at)\n       VALUES (${ph(1)}, ${ph(2)}, ${ph(3)}, ${ph(4)}, ${ph(5)})\`,
      [item.id, item.name, item.description, item.createdAt.toISOString(), item.updatedAt.toISOString()]
    );
  }

  async update(item: Item): Promise<void> {
    await this.pool.query(
      \`UPDATE items\n       SET name = ${ph(1)}, description = ${ph(2)}, updated_at = ${ph(3)}\n       WHERE id = ${ph(4)}\`,
      [item.name, item.description, item.updatedAt.toISOString(), item.id]
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM items WHERE id = ${ph(1)}', [id]);
  }
}
`;
  }

  private renderAuthMiddleware(): string {
    return `// src/middleware/auth.ts
// Custom authentication and authorization middleware examples.

import type { StreetContext } from 'streetjs';
import { container, JwtService, UnauthorizedException } from 'streetjs';

/**
 * JWT-based authentication middleware.
 * Extracts Bearer token from Authorization header and sets ctx.user.
 */
export async function authenticate(ctx: StreetContext, next: () => Promise<void>): Promise<void> {
  const authHeader = ctx.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedException('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);
  const jwtService = container.resolve(JwtService);

  try {
    const payload = jwtService.verify(token);
    ctx.user = payload as StreetContext['user'] ?? { id: '', email: '', roles: [] };
    await next();
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}

/**
 * Role-based authorization middleware.
 * Must be used after authenticate().
 */
export function requireRole(...roles: string[]) {
  return async (ctx: StreetContext, next: () => Promise<void>): Promise<void> => {
    const user = ctx.user;
    if (!user || !user.roles || !roles.some((r) => user.roles.includes(r))) {
      throw new UnauthorizedException('Insufficient permissions');
    }
    await next();
  };
}

/**
 * Request logging middleware.
 */
export async function requestLogger(ctx: StreetContext, next: () => Promise<void>): Promise<void> {
  const start = Date.now();
  const method = ctx.req.method ?? 'UNKNOWN';
  const url = ctx.req.url ?? '/';

  console.log(\`[http] --> \${method} \${url}\`);

  await next();

  const duration = Date.now() - start;
  const status = ctx.res.statusCode ?? 200;
  console.log(\`[http] <-- \${method} \${url} \${status} (\${duration}ms)\`);
}
`;
  }

  private renderChatGateway(): string {
    return `// src/gateways/chat.gateway.ts
// Example WebSocket gateway for real-time chat.
// Attached to the HTTP server via StreetWebSocketServer.attach().

import { StreetSocket } from 'streetjs';
import type { IncomingMessage } from 'node:http';

interface ChatMessage {
  type: 'message' | 'join' | 'leave';
  user: string;
  text: string;
  timestamp: number;
}

// Unique client ID generator
let nextClientId = 1;

const connections = new Map<number, { socket: StreetSocket; user: string; clientId: number }>();

// NOTE: In main.ts, wire up the WebSocket server with:
//   import { chatConnectionHandler } from './gateways/chat.gateway.js';
//   import { createServer } from 'node:http';
//   ...
//   const httpServer = createServer(...);
//   wss.attach(httpServer, chatConnectionHandler);
//   httpServer.listen(port, host);

/** WebSocket connection handler — called for each new connection */
export function chatConnectionHandler(socket: StreetSocket, _req: IncomingMessage): void {
  const clientId = nextClientId++;
  let userName = \`Anonymous-\${clientId}\`;

  socket.on('message', (data: unknown) => {
    try {
      const msg = data as ChatMessage;

      switch (msg.type) {
        case 'join':
          userName = msg.user || userName;
          connections.set(clientId, { socket, user: userName, clientId });
          broadcast({
            type: 'join',
            user: userName,
            text: \`\${userName} joined the chat\`,
            timestamp: Date.now(),
          });
          break;

        case 'message':
          broadcast({
            type: 'message',
            user: userName,
            text: msg.text,
            timestamp: Date.now(),
          });
          break;

        default:
          socket.emit('error', { message: 'Unknown message type' });
      }
    } catch (err) {
      socket.emit('error', { message: 'Invalid message format', detail: String(err) });
    }
  });

  socket.on('close', () => {
    connections.delete(clientId);
    broadcast({
      type: 'leave',
      user: userName,
      text: \`\${userName} left the chat\`,
      timestamp: Date.now(),
    });
  });
}

function broadcast(message: ChatMessage): void {
  const data = JSON.stringify(message);
  for (const [, conn] of connections) {
    try {
      conn.socket.emit('chat', data);
    } catch {
      // Socket may have closed — remove it
      connections.delete(conn.clientId);
    }
  }
}
`;
  }

  private renderTsconfig(): string {
    return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`;
  }

  private renderDockerfile(): string {
    return `# Dockerfile — Multi-stage build for Street applications

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 appuser \
  && adduser --system --uid 1001 appuser

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations

USER appuser

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/main.js"]
`;
  }

  private renderDockerCompose(database = 'sqlite'): string {
    if (database === 'sqlite') {
      return `# docker-compose.yml
# Development environment (SQLite — no database server required).

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: "3000"
      HOST: "0.0.0.0"
      DB_DRIVER: sqlite
      # ':memory:' is ephemeral. For production, switch to PostgreSQL:
      # recreate the project with \`--database postgres\`.
      SQLITE_PATH: ":memory:"
      # JWT_SECRET / SESSION_KEY are auto-generated as valid ephemeral dev keys
      # when unset (NODE_ENV=development). Set them for stable sessions / prod.
      # CORS_ORIGINS empty = allow all in development; set an allowlist for prod.
      CORS_ORIGINS: ""
    volumes:
      - ./uploads:/app/uploads
`;
    }
    return `# docker-compose.yml
# Development environment with PostgreSQL. Compose provisions the database with
# credentials that match the app — no host PostgreSQL or manual setup needed.

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: "3000"
      HOST: "0.0.0.0"
      DB_DRIVER: postgres
      PG_HOST: postgres
      PG_PORT: "5432"
      PG_DATABASE: street
      PG_USER: street
      PG_PASSWORD: street_pass
      # JWT_SECRET / SESSION_KEY are auto-generated as valid ephemeral dev keys
      # when unset (NODE_ENV=development). Set them for stable sessions / prod.
      # CORS_ORIGINS empty = allow all in development; set an allowlist for prod.
      CORS_ORIGINS: ""
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./uploads:/app/uploads

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: street
      POSTGRES_USER: street
      POSTGRES_PASSWORD: street_pass
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker-init:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U street -d street"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
`;
  }

  private renderEnvExample(database = 'sqlite'): string {
    if (database === 'sqlite') {
      return `# .env.example — Copy to .env. SQLite needs no credentials; this works as-is.

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database (SQLite — zero-config)
DB_DRIVER=sqlite
# ':memory:' is an ephemeral in-process database (resets on restart).
# Set a file path for local persistence, or switch to PostgreSQL for production
# by recreating with \`--database postgres\`.
SQLITE_PATH=:memory:

# Security — left empty so they are auto-generated as valid ephemeral dev keys
# (NODE_ENV=development). REQUIRED in production:
#   JWT_SECRET:  openssl rand -hex 24   (≥32 chars)
#   SESSION_KEY: openssl rand -hex 32   (exactly 64 hex chars)
JWT_SECRET=
SESSION_KEY=

# CORS — comma-separated allowlist of trusted origins. Leave empty in dev to
# allow all origins (*). REQUIRED in production (no wildcard fallback).
# Example: CORS_ORIGINS=https://app.example.com,https://admin.example.com
CORS_ORIGINS=

# Paths
UPLOADS_DIR=./uploads
MIGRATIONS_DIR=./migrations
`;
    }
    return `# .env.example — Copy to .env and fill in your values.
#
# PG_USER, PG_PASSWORD, and PG_DATABASE are REQUIRED and have no defaults — the
# app validates them on startup and will not guess credentials. If you don't
# have a PostgreSQL server, either run \`docker compose up\` (provisions one) or
# recreate the project with \`--database sqlite\` for a zero-config local database.

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database (PostgreSQL) — REQUIRED
DB_DRIVER=postgres
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=
PG_USER=
PG_PASSWORD=

# Security — left empty so they are auto-generated as valid ephemeral dev keys
# (NODE_ENV=development). REQUIRED in production:
#   JWT_SECRET:  openssl rand -hex 24   (≥32 chars)
#   SESSION_KEY: openssl rand -hex 32   (exactly 64 hex chars)
JWT_SECRET=
SESSION_KEY=

# CORS — comma-separated allowlist of trusted origins. Leave empty in dev to
# allow all origins (*). REQUIRED in production (no wildcard fallback).
# Example: CORS_ORIGINS=https://app.example.com,https://admin.example.com
CORS_ORIGINS=

# Paths
UPLOADS_DIR=./uploads
MIGRATIONS_DIR=./migrations
`;
  }

  private renderGitignore(): string {
    return `# Dependencies
node_modules/

# Build output
dist/

# Environment
.env
.env.local
.env.production

# Uploads (keep directory, ignore contents)
uploads/*
!uploads/.gitkeep

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Test coverage
coverage/

# Logs
*.log
npm-debug.log*
`;
  }

  private renderTestFile(): string {
    return `// tests/integration.test.ts
// Basic integration test for the Street application.

import { describe, it } from 'node:test';
import assert from 'node:assert';

// NOTE: These tests assume the server is running.
// In CI, start the server before running tests.

const BASE_URL = process.env['TEST_URL'] ?? 'http://localhost:3000';

describe('Street Application', () => {
  it('should return health check', async () => {
    const res = await fetch(\`\${BASE_URL}/health\`);
    assert.strictEqual(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assert.strictEqual(body['status'], 'ok');
    assert.ok(typeof body['timestamp'] === 'string');
  });

  it('should list items', async () => {
    const res = await fetch(\`\${BASE_URL}/api/items\`);
    assert.strictEqual(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(body['items']));
    assert.ok(typeof body['total'] === 'number');
  });

  it('should return 404 for unknown routes', async () => {
    const res = await fetch(\`\${BASE_URL}/nonexistent\`);
    assert.strictEqual(res.status, 404);
  });
});
`;
  }

  private renderReadme(projectName: string): string {
    return `# ${projectName}

A [Street](https://hassanmubiru.github.io/StreetJS) framework application.

## Prerequisites

- Node.js >= 20.0.0
- PostgreSQL >= 14 (optional, for database features)

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development server
street dev
\`\`\`

## Available Commands

| Command                    | Description                        |
| -------------------------- | ---------------------------------- |
| \`street dev\`              | Start development server           |
| \`street build\`            | Compile for production             |
| \`street start\`            | Start production server            |
| \`street test\`             | Run tests                          |
| \`street migrate:run\`      | Run pending migrations             |
| \`street migrate:create\`   | Create a new migration file        |

## Project Structure

\`\`\`
${projectName}/
├── src/
│   ├── controllers/    # HTTP request handlers
│   ├── services/       # Business logic
│   ├── repositories/   # Data access layer
│   ├── middleware/     # Custom middleware
│   ├── gateways/       # WebSocket handlers
│   └── main.ts         # Application entry point
├── tests/              # Integration and unit tests
├── migrations/         # SQL migration files
├── uploads/            # File upload storage
├── package.json
├── tsconfig.json
├── Dockerfile
├── street.config.ts
└── README.md
\`\`\`

## Scripts

\`\`\`bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Production start
npm run test         # Run tests
npm run migrate      # Run migrations
\`\`\`
`;
  }
}
