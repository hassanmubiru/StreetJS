// src/devx/migration-examples.ts
// Migration examples for the Upgrade System (Req 8.8). Each example is a real
// before/after source pair for a registered codemod: applying the named codemod
// to `before` yields `after` exactly, and re-applying it to `after` is a
// byte-for-byte no-op (idempotence, Req 8.6).
//
// These examples are the fixtures the codemod test suite is executed against
// (`codemods-migration-examples.test.ts`); that run is recorded in the
// `upgrade.codemods` Verification Artifact. Keeping them as compiled data
// (rather than loose fixture files) means they travel with both build layouts
// and never drift out of type-check.
//
// Dependency-free (no imports, pure data).

import type { CodemodArea } from './codemods.js';

/** A single migration example: a codemod applied to `before` produces `after`. */
export interface MigrationExample {
  /** Stable identifier for the example. */
  id: string;
  /** The migration area the example demonstrates. */
  area: CodemodArea;
  /** The registered codemod id that performs this migration. */
  codemodId: string;
  /** Short human-readable description of what the example migrates. */
  description: string;
  /** Source before the migration. */
  before: string;
  /** Expected source after the migration. */
  after: string;
}

/**
 * The migration examples, one or more per registered codemod, covering all
 * three breaking-change areas (routing, middleware, plugin-api). The codemod
 * test suite runs every example through `applyCodemods` and asserts the result
 * equals `after` and that re-application is a no-op.
 */
export const MIGRATION_EXAMPLES: readonly MigrationExample[] = [
  // ── routing ────────────────────────────────────────────────────────────────
  {
    id: 'routing/router-context',
    area: 'routing',
    codemodId: 'rename-router-context',
    description: 'Rename the routing handler context type RouterContext to RouteContext.',
    before: [
      "import type { RouterContext } from 'streetjs';",
      '',
      'export function getUser(ctx: RouterContext) {',
      '  const id = ctx.params.id;',
      '  return ctx.json({ id });',
      '}',
      '',
      'export const listUsers = (ctx: RouterContext) => ctx.json([]);',
      '',
    ].join('\n'),
    after: [
      "import type { RouteContext } from 'streetjs';",
      '',
      'export function getUser(ctx: RouteContext) {',
      '  const id = ctx.params.id;',
      '  return ctx.json({ id });',
      '}',
      '',
      'export const listUsers = (ctx: RouteContext) => ctx.json([]);',
      '',
    ].join('\n'),
  },
  {
    id: 'routing/route-handler-type',
    area: 'routing',
    codemodId: 'rename-route-handler-type',
    description: 'Rename the deprecated RouteHandlerFn type alias to RouteHandler.',
    before: [
      "import type { RouteHandlerFn } from 'streetjs';",
      '',
      'const handler: RouteHandlerFn = (ctx) => ctx.text(`ok`);',
      'export const routes: RouteHandlerFn[] = [handler];',
      '',
    ].join('\n'),
    after: [
      "import type { RouteHandler } from 'streetjs';",
      '',
      'const handler: RouteHandler = (ctx) => ctx.text(`ok`);',
      'export const routes: RouteHandler[] = [handler];',
      '',
    ].join('\n'),
  },

  // ── middleware ───────────────────────────────────────────────────────────────
  {
    id: 'middleware/middleware-next',
    area: 'middleware',
    codemodId: 'rename-middleware-next',
    description: 'Rename the MiddlewareNext callback type to the canonical NextFunction.',
    before: [
      "import type { MiddlewareNext } from 'streetjs';",
      '',
      'export async function auth(ctx: unknown, next: MiddlewareNext) {',
      '  await next();',
      '}',
      '',
    ].join('\n'),
    after: [
      "import type { NextFunction } from 'streetjs';",
      '',
      'export async function auth(ctx: unknown, next: NextFunction) {',
      '  await next();',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'middleware/use-middleware',
    area: 'middleware',
    codemodId: 'rename-use-middleware',
    description: 'Rename the deprecated app.useMiddleware registration method to app.use.',
    before: [
      'export function register(app: { useMiddleware(fn: unknown): void }) {',
      '  app.useMiddleware(logger);',
      '  app.useMiddleware(cors);',
      '}',
      '',
    ].join('\n'),
    after: [
      'export function register(app: { use(fn: unknown): void }) {',
      '  app.use(logger);',
      '  app.use(cors);',
      '}',
      '',
    ].join('\n'),
  },

  // ── plugin-api ─────────────────────────────────────────────────────────────
  {
    id: 'plugin-api/rabbitmq-transport',
    area: 'plugin-api',
    codemodId: 'rename-rabbitmq-transport',
    description: 'Rename the deprecated RabbitMQTransport alias to RabbitMqTransport.',
    before: [
      "import { RabbitMQTransport } from 'streetjs';",
      '',
      "const transport = new RabbitMQTransport({ host: 'localhost' });",
      'export default transport;',
      '',
    ].join('\n'),
    after: [
      "import { RabbitMqTransport } from 'streetjs';",
      '',
      "const transport = new RabbitMqTransport({ host: 'localhost' });",
      'export default transport;',
      '',
    ].join('\n'),
  },
  {
    id: 'plugin-api/plugin-register',
    area: 'plugin-api',
    codemodId: 'rename-plugin-register',
    description: 'Rename the deprecated registerPlugin host method to usePlugin.',
    before: [
      'export function bootstrap(host: { registerPlugin(p: unknown): void }) {',
      '  host.registerPlugin(metricsPlugin);',
      '}',
      '',
    ].join('\n'),
    after: [
      'export function bootstrap(host: { usePlugin(p: unknown): void }) {',
      '  host.usePlugin(metricsPlugin);',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'plugin-api/plugin-context',
    area: 'plugin-api',
    codemodId: 'rename-plugin-context',
    description: 'Rename the PluginContext type to the canonical PluginHost.',
    before: [
      "import type { PluginContext } from 'streetjs';",
      '',
      'export function activate(host: PluginContext) {',
      '  host.logger.info(`ready`);',
      '}',
      '',
    ].join('\n'),
    after: [
      "import type { PluginHost } from 'streetjs';",
      '',
      'export function activate(host: PluginHost) {',
      '  host.logger.info(`ready`);',
      '}',
      '',
    ].join('\n'),
  },
];
