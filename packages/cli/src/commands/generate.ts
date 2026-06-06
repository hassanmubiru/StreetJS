// packages/cli/src/commands/generate.ts
// `street generate <type> <name>` — scaffolds controllers, services, repositories,
// middleware, gateways, and migrations.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliContext } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Regex for valid generator name: lowercase letter + lowercase alphanumeric/dash/underscore */
const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

type GenerateType = 'controller' | 'service' | 'repository' | 'middleware' | 'gateway' | 'migration';

const VALID_TYPES: GenerateType[] = ['controller', 'service', 'repository', 'middleware', 'gateway', 'migration'];

export class GenerateCommand {
  async execute(ctx: CliContext): Promise<void> {
    const genType = ctx.args.positional[0]?.toLowerCase() as GenerateType | undefined;
    const name = ctx.args.positional[1];

    // ── Flag-driven generators (no <name> positional) ──────────────────────
    if (genType === 'sdk') {
      await this.generateSdk(ctx);
      return;
    }
    if (genType === 'grpc') {
      await this.generateGrpc(ctx);
      return;
    }

    if (!genType || !VALID_TYPES.includes(genType)) {
      console.error('[street] Usage: street generate <type> <name>');
      console.error('  Valid types: controller, service, repository, middleware, gateway, migration, sdk, grpc');
      console.error('  Example: street generate controller users');
      process.exitCode = 1;
      return;
    }

    if (!name) {
      console.error('[street] Usage: street generate <type> <name>');
      console.error(`  Example: street generate ${genType} users`);
      process.exitCode = 1;
      return;
    }

    await this.generate(ctx.cwd, genType, name);
  }

  private async generate(cwd: string, type: GenerateType, name: string): Promise<void> {
    const className = this.toPascalCase(name);
    const fileName = this.toKebabCase(name);
    const pluralName = this.toPlural(name);

    switch (type) {
      case 'controller':
        await this.generateController(cwd, className, fileName, pluralName);
        break;
      case 'service':
        await this.generateService(cwd, className, fileName, pluralName);
        break;
      case 'repository':
        await this.generateRepository(cwd, className, fileName, pluralName);
        break;
      case 'middleware':
        await generateMiddleware(name, cwd);
        break;
      case 'gateway':
        await generateGateway(name, cwd);
        break;
      case 'migration':
        await generateMigration(name, cwd);
        break;
    }

    if (type !== 'middleware' && type !== 'gateway' && type !== 'migration') {
      console.log(`[street] Generated ${type}: src/${this.toPlural(type)}/${fileName}.${type}.ts`);
    }
  }

  /** `street generate sdk --lang <typescript|python> --spec <openapi.json> --output <dir>` */
  private async generateSdk(ctx: CliContext): Promise<void> {
    const lang = String(ctx.args.flags['lang'] ?? 'typescript');
    const specPath = String(ctx.args.flags['spec'] ?? 'openapi.json');
    const output = String(ctx.args.flags['output'] ?? './sdk');
    const core = await import('@streetjs/core');

    let specRaw: string;
    try {
      specRaw = await readFile(resolve(ctx.cwd, specPath), 'utf8');
    } catch {
      console.error(`[street] Could not read OpenAPI spec at "${specPath}". Pass --spec <path>.`);
      process.exitCode = 1;
      return;
    }
    const spec = JSON.parse(specRaw) as Parameters<typeof core.generateTypescriptSdk>[0];
    const outDir = resolve(ctx.cwd, output);

    if (lang === 'python') {
      await core.generatePythonSdk(spec, outDir);
      console.log(`[street] Generated Python SDK in ${output}/ (models.py, client.py)`);
    } else {
      await core.generateTypescriptSdk(spec, outDir);
      console.log(`[street] Generated TypeScript SDK in ${output}/ (types.ts, api-client.ts)`);
    }
  }

  /** `street generate grpc --proto <file.proto> --output <dir>` */
  private async generateGrpc(ctx: CliContext): Promise<void> {
    const protoPath = ctx.args.flags['proto'];
    if (!protoPath || typeof protoPath !== 'string') {
      console.error('[street] Usage: street generate grpc --proto <file.proto> [--output <dir>]');
      process.exitCode = 1;
      return;
    }
    const output = String(ctx.args.flags['output'] ?? './src/grpc');
    const core = await import('@streetjs/core');
    const ast = await core.parseProtoFile(resolve(ctx.cwd, protoPath));
    const tsSource = core.generateGrpcTypes(ast);
    const outDir = resolve(ctx.cwd, output);
    await mkdir(outDir, { recursive: true });
    const baseName = protoPath.replace(/.*\//, '').replace(/\.proto$/, '');
    const outFile = resolve(outDir, `${baseName}.grpc.ts`);
    await writeFile(outFile, tsSource, 'utf8');
    console.log(`[street] Generated gRPC types: ${output}/${baseName}.grpc.ts`);
  }

  private async generateController(
    cwd: string,
    className: string,
    fileName: string,
    pluralName: string
  ): Promise<void> {
    const dir = resolve(cwd, 'src', 'controllers');
    await mkdir(dir, { recursive: true });

    const content = `// src/controllers/${fileName}.controller.ts
// ${className} controller — auto-generated by street generate.

import { Controller, Get, Post, Put, Delete, ApiOperation } from '@streetjs/core';
import type { StreetContext } from '@streetjs/core';
import { ${className}Service } from '../services/${fileName}.service.js';
import { container } from '@streetjs/core';

@Controller('/api/${pluralName}')
export class ${className}Controller {
  private readonly service = container.resolve(${className}Service);

  @Get('/')
  @ApiOperation({ summary: 'List all ${fileName}s', tags: ['${fileName}'] })
  async findAll(ctx: StreetContext): Promise<void> {
    const page = parseInt(ctx.query['page'] ?? '1', 10);
    const limit = parseInt(ctx.query['limit'] ?? '20', 10);
    const result = await this.service.findAll(page, limit);
    ctx.json(result);
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Get ${fileName} by ID', tags: ['${fileName}'] })
  async findById(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) {
      ctx.status(400).json({ error: 'Missing id parameter' });
      return;
    }
    const item = await this.service.findById(id);
    if (!item) {
      ctx.status(404).json({ error: '${className} not found' });
      return;
    }
    ctx.json(item);
  }

  @Post('/')
  @ApiOperation({ summary: 'Create a ${fileName}', tags: ['${fileName}'] })
  async create(ctx: StreetContext): Promise<void> {
    const data = ctx.body as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') {
      ctx.status(400).json({ error: 'Invalid request body' });
      return;
    }
    const item = await this.service.create(data);
    ctx.status(201).json(item);
  }

  @Put('/:id')
  @ApiOperation({ summary: 'Update a ${fileName}', tags: ['${fileName}'] })
  async update(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    const data = ctx.body as Record<string, unknown> | null;
    if (!id || !data) {
      ctx.status(400).json({ error: 'Missing id or body' });
      return;
    }
    const item = await this.service.update(id, data);
    if (!item) {
      ctx.status(404).json({ error: '${className} not found' });
      return;
    }
    ctx.json(item);
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete a ${fileName}', tags: ['${fileName}'] })
  async delete(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) {
      ctx.status(400).json({ error: 'Missing id parameter' });
      return;
    }
    await this.service.delete(id);
    ctx.status(204).send();
  }
}
`;

    await writeFile(resolve(dir, `${fileName}.controller.ts`), content, 'utf8');
  }

  private async generateService(
    cwd: string,
    className: string,
    fileName: string,
    _pluralName: string
  ): Promise<void> {
    const dir = resolve(cwd, 'src', 'services');
    await mkdir(dir, { recursive: true });

    const content = `// src/services/${fileName}.service.ts
// ${className} service — auto-generated by street generate.

import { Injectable } from '@streetjs/core';
import { ${className}Repository } from '../repositories/${fileName}.repository.js';

export interface ${className} {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

@Injectable()
export class ${className}Service {
  constructor(private readonly repository: ${className}Repository) {}

  async findAll(page: number, limit: number) {
    return this.repository.findAll(page, limit);
  }

  async findById(id: string): Promise<${className} | null> {
    return this.repository.findById(id);
  }

  async create(input: Record<string, unknown>): Promise<${className}> {
    const now = new Date();
    const item: ${className} = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(item);
    return item;
  }

  async update(id: string, input: Record<string, unknown>): Promise<${className} | null> {
    const existing = await this.repository.findById(id);
    if (!existing) return null;

    const updated: ${className} = {
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

    await writeFile(resolve(dir, `${fileName}.service.ts`), content, 'utf8');
  }

  private async generateRepository(
    cwd: string,
    className: string,
    fileName: string,
    _pluralName: string
  ): Promise<void> {
    const dir = resolve(cwd, 'src', 'repositories');
    await mkdir(dir, { recursive: true });

    const content = `// src/repositories/${fileName}.repository.ts
// ${className} repository — auto-generated by street generate.

import { Injectable, container, PgPool } from '@streetjs/core';
import type { ${className} } from '../services/${fileName}.service.js';

const TABLE_NAME = '${this.toSnakeCase(this.toPlural(fileName))}';

@Injectable()
export class ${className}Repository {
  private readonly pool = container.resolve(PgPool);

  async findAll(page: number, limit: number): Promise<{ items: ${className}[]; total: number }> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        \`SELECT * FROM \${TABLE_NAME} ORDER BY created_at DESC LIMIT \$1 OFFSET \$2\`,
        [limit, offset]
      ),
      this.pool.query(\`SELECT COUNT(*) AS total FROM \${TABLE_NAME}\`),
    ]);

    const items = dataResult.rows as ${className}[];
    const total = parseInt(String(countResult.rows[0]?.['total'] ?? '0'), 10);

    return { items, total };
  }

  async findById(id: string): Promise<${className} | null> {
    const result = await this.pool.query(
      \`SELECT * FROM \${TABLE_NAME} WHERE id = \$1\`,
      [id]
    );
    return (result.rows[0] as ${className}) ?? null;
  }

  async create(item: ${className}): Promise<void> {
    const keys = Object.keys(item);
    const columns = keys.join(', ');
    const values = keys.map((_, i) => \`\$\${i + 1}\`).join(', ');
    const params = keys.map((k) => item[k]);

    await this.pool.query(
      \`INSERT INTO \${TABLE_NAME} (\${columns}) VALUES (\${values})\`,
      params
    );
  }

  async update(item: ${className}): Promise<void> {
    const keys = Object.keys(item).filter((k) => k !== 'id');
    const setClause = keys.map((k, i) => \`\${k} = \$\${i + 1}\`).join(', ');
    const params = [...keys.map((k) => item[k]), item.id];

    await this.pool.query(
      \`UPDATE \${TABLE_NAME} SET \${setClause} WHERE id = \$\${keys.length + 1}\`,
      params
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(\`DELETE FROM \${TABLE_NAME} WHERE id = \$1\`, [id]);
  }
}
`;

    await writeFile(resolve(dir, `${fileName}.repository.ts`), content, 'utf8');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private toPascalCase(str: string): string {
    return str
      .replace(/[-_]/g, ' ')
      .replace(/\w+/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
      .replace(/\s+/g, '');
  }

  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[_\s]+/g, '-')
      .toLowerCase();
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .toLowerCase();
  }

  private toPlural(str: string): string {
    // If word already ends in 's', it's likely already plural — return as-is
    if (str.endsWith('s')) {
      return str;
    }
    if (str.endsWith('x') || str.endsWith('z') ||
        str.endsWith('ch') || str.endsWith('sh')) {
      return str + 'es';
    }
    if (str.endsWith('y') && !/[aeiou]y$/i.test(str)) {
      return str.slice(0, -1) + 'ies';
    }
    return str + 's';
  }
}

// ── Standalone generator functions (also used by sub-commands) ───────────────

/** Resolve the templates directory regardless of CJS/ESM layout. */
function templatesDir(): string {
  // When compiled to dist/, __dirname is packages/cli/dist/commands/
  // Templates are at packages/cli/templates/generate/
  return resolve(__dirname, '..', '..', 'templates', 'generate');
}

/**
 * Validate a generator name against /^[a-z][a-z0-9_-]*$/.
 * Exits process with code 1 if invalid.
 */
function assertValidName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    process.stderr.write(
      `[street] Invalid name "${name}". Name must match [a-z][a-z0-9_-]*\n`,
    );
    process.exit(1);
  }
}

/**
 * Ensure a target file does not already exist.
 * Exits process with code 1 if it does (non-destructive).
 */
async function assertNotExists(targetPath: string): Promise<void> {
  try {
    await access(targetPath);
    // If access() did not throw, the file exists.
    process.stderr.write(
      `[street] File already exists: ${targetPath}\nAbort — no files were overwritten.\n`,
    );
    process.exit(1);
  } catch {
    // File does not exist — continue.
  }
}

/**
 * Generate a typed StreetMiddleware scaffold.
 *
 * Output: `<cwd>/src/middleware/<name>.middleware.ts`
 */
export async function generateMiddleware(name: string, cwd: string): Promise<void> {
  assertValidName(name);

  const targetPath = resolve(cwd, 'src', 'middleware', `${name}.middleware.ts`);
  await assertNotExists(targetPath);

  const tplPath = resolve(templatesDir(), 'middleware.ts.tpl');
  const tpl = await readFile(tplPath, 'utf8');
  const content = tpl.replaceAll('{{NAME}}', name);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf8');

  process.stdout.write(`[street] Created middleware: src/middleware/${name}.middleware.ts\n`);
}

/**
 * Generate a typed WebSocket gateway scaffold.
 * Full implementation in task 2.3.
 *
 * Output: `<cwd>/src/gateways/<name>.gateway.ts`
 */
export async function generateGateway(name: string, cwd: string): Promise<void> {
  assertValidName(name);

  const targetPath = resolve(cwd, 'src', 'gateways', `${name}.gateway.ts`);
  await assertNotExists(targetPath);

  const tplPath = resolve(templatesDir(), 'gateway.ts.tpl');
  const tpl = await readFile(tplPath, 'utf8');
  const content = tpl.replaceAll('{{NAME}}', name);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf8');

  process.stdout.write(`[street] Created gateway: src/gateways/${name}.gateway.ts\n`);
}

/**
 * Generate a timestamped SQL migration pair (up + rollback).
 * Full implementation in task 2.4.
 *
 * Output: `<cwd>/migrations/<timestamp>_<name>.sql` + `.rollback.sql`
 */
export async function generateMigration(name: string, cwd: string): Promise<void> {
  assertValidName(name);

  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const base = `${timestamp}_${name}`;

  const upPath = resolve(cwd, 'migrations', `${base}.sql`);
  const downPath = resolve(cwd, 'migrations', `${base}.rollback.sql`);

  await assertNotExists(upPath);
  await assertNotExists(downPath);

  const upTplPath = resolve(templatesDir(), 'migration-up.sql.tpl');
  const downTplPath = resolve(templatesDir(), 'migration-rollback.sql.tpl');

  const [upTpl, downTpl] = await Promise.all([
    readFile(upTplPath, 'utf8'),
    readFile(downTplPath, 'utf8'),
  ]);

  const upContent = upTpl.replaceAll('{{NAME}}', name);
  const downContent = downTpl.replaceAll('{{NAME}}', name);

  await mkdir(dirname(upPath), { recursive: true });
  await Promise.all([
    writeFile(upPath, upContent, 'utf8'),
    writeFile(downPath, downContent, 'utf8'),
  ]);

  process.stdout.write(`[street] Created migration:\n  migrations/${base}.sql\n  migrations/${base}.rollback.sql\n`);
}
