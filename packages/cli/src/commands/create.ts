// packages/cli/src/commands/create.ts
// `street create <name>` — scaffolds a complete Street project from embedded templates.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CliContext } from '../index.js';



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
    await this.scaffoldProject(targetDir, projectName);

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

  private async scaffoldProject(targetDir: string, projectName: string): Promise<void> {
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
      this.renderStreetConfig(projectName),
      'utf8'
    );

    // src/main.ts
    await writeFile(
      join(targetDir, 'src/main.ts'),
      this.renderMainTs(),
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
      this.renderExampleRepository(),
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
      this.renderDockerCompose(),
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
      this.renderEnvExample(),
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

  private renderStreetConfig(_projectName: string): string {
    return `// street.config.ts
// Street framework configuration.
// Environment variables are loaded automatically at runtime.

import type { StreetAppOptions } from 'streetjs';

export default {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  host: process.env['HOST'] ?? '0.0.0.0',
  pgHost: process.env['PG_HOST'] ?? 'localhost',
  pgPort: parseInt(process.env['PG_PORT'] ?? '5432', 10),
  pgDatabase: process.env['PG_DATABASE'] ?? '${_projectName}',
  pgUser: process.env['PG_USER'] ?? 'postgres',
  pgPassword: process.env['PG_PASSWORD'] ?? 'postgres',
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

  private renderMainTs(): string {
    return `// src/main.ts
// Street application entry point.

import 'reflect-metadata';
import { resolve } from 'node:path';
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
  PgPool,
  StreetMigrationRunner,
  JwtService,
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

  // ── Database pool ────────────────────────────────────────────────────
  const pool = new PgPool({
    host: process.env['PG_HOST'] ?? 'localhost',
    port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
    user: process.env['PG_USER'] ?? 'postgres',
    password: process.env['PG_PASSWORD'] ?? '',
    database: process.env['PG_DATABASE'] ?? 'street',
    minConnections: 2,
    maxConnections: 10,
    idleTimeoutMs: 30_000,
    acquireTimeoutMs: 5_000,
  });
  await pool.initialize();
  container.register(PgPool, pool);

  // ── Services ─────────────────────────────────────────────────────────
  const telemetry = new TelemetryTracker(60_000);
  container.register(TelemetryTracker, telemetry);

  const wsServer = new StreetWebSocketServer({
    heartbeatIntervalMs: 30_000,
    maxConnections: 10_000,
  });
  container.register(StreetWebSocketServer, wsServer);

  container.register(
    StreetMigrationRunner,
    new StreetMigrationRunner(pool)
  );
  container.register(JwtService, new JwtService(process.env['JWT_SECRET'] ?? 'dev-secret'));
  container.register(SessionManager, new SessionManager(process.env['SESSION_KEY'] ?? 'dev-session-key'));
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
  app.use(corsMiddleware(['*']));
  app.use(xssMiddleware);
  app.use(telemetryMiddleware(telemetry));
  app.use(rateLimiter.middleware());

  // Register controllers
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
      await pool.close();
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

  private renderExampleRepository(): string {
    return `// src/repositories/example.repository.ts
// Example repository using the Street framework's PostgreSQL pool directly.

import { Injectable, container, PgPool } from 'streetjs';
import type { PgRow } from 'streetjs';
import type { Item } from '../services/example.service.js';

/** Map a database row to an Item */
function rowToItem(row: PgRow): Item {
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
  private readonly pool = container.resolve(PgPool);

  async findAll(page: number, limit: number): Promise<{ items: Item[]; total: number }> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        'SELECT * FROM items ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
      this.pool.query('SELECT COUNT(*) AS total FROM items'),
    ]);

    const items = dataResult.rows.map(rowToItem);
    const total = parseInt(String(countResult.rows[0]?.['total'] ?? '0'), 10);

    return { items, total };
  }

  async findById(id: string): Promise<Item | null> {
    const result = await this.pool.query(
      'SELECT * FROM items WHERE id = $1',
      [id]
    );
    const row = result.rows[0];
    return row ? rowToItem(row) : null;
  }

  async create(item: Item): Promise<void> {
    await this.pool.query(
      \`INSERT INTO items (id, name, description, created_at, updated_at)\n       VALUES ($1, $2, $3, $4, $5)\`,
      [item.id, item.name, item.description, item.createdAt.toISOString(), item.updatedAt.toISOString()]
    );
  }

  async update(item: Item): Promise<void> {
    await this.pool.query(
      \`UPDATE items\n       SET name = $1, description = $2, updated_at = $3\n       WHERE id = $4\`,
      [item.name, item.description, item.updatedAt.toISOString(), item.id]
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM items WHERE id = $1', [id]);
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

  private renderDockerCompose(): string {
    return `# docker-compose.yml
# Development environment with PostgreSQL.

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
      PG_HOST: postgres
      PG_PORT: "5432"
      PG_DATABASE: street
      PG_USER: street
      PG_PASSWORD: street_pass
      JWT_SECRET: dev-jwt-secret-change-in-production
      SESSION_KEY: dev-session-key-change-in-production
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

  private renderEnvExample(): string {
    return `# .env.example — Copy to .env and fill in your values

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=street
PG_USER=postgres
PG_PASSWORD=postgres

# Security
JWT_SECRET=change-this-to-a-long-random-string
SESSION_KEY=change-this-to-another-random-string

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

A [Street](https://hassanmubiru.github.io/street) framework application.

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
