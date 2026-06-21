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
  /** Optional additional files written verbatim into the project (e.g. SQL migrations, docs). */
  extraFiles?: { path: string; content: string }[];
}

export const TEMPLATES: Record<string, TemplateSpec> = {
  app: {
    packages: {},
    description: 'Minimal Street app (HTTP, DI, Postgres, health checks).',
    starter: { path: '', content: '' },
  },
  saas: {
    // Always-on composition set for the production-grade SaaS starter. RBAC +
    // audit (@streetjs/admin), the admin/RBAC management screens
    // (@streetjs/admin-ui), the server-rendered dashboard runtime
    // (@streetjs/plugin-htmx), and the auth/session UI (@streetjs/auth-ui) ship
    // by default. Billing (@streetjs/plugin-stripe), email
    // (@streetjs/plugin-sendgrid), and the Postgres driver
    // (@streetjs/plugin-postgres) stay install-on-demand (see SAAS.md).
    packages: {
      '@streetjs/admin': '^1.0.0',
      '@streetjs/admin-ui': '^1.0.0',
      '@streetjs/plugin-htmx': '^1.0.0',
      '@streetjs/auth-ui': '^1.0.0',
    },
    description: 'SaaS starter: user/role admin + audit log on top of the base app.',
    starter: {
      path: 'src/features/saas.ts',
      content: `// SaaS feature wiring — admin users, roles (RBAC), and an audit log.
import { AdminService } from '@streetjs/admin';

export const admin = new AdminService();
// await admin.createRole('system', { name: 'owner', permissions: ['*'] });
`,
    },
    extraFiles: [
      {
        path: 'migrations/001_saas.sql',
        content: `-- SaaS starter schema — organizations, teams, RBAC, invitations, billing, audit.
-- Apply with: street migrate:run  (PostgreSQL syntax; adjust types for SQLite).

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  owner_id   BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id      BIGSERIAL PRIMARY KEY,
  org_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                 BIGSERIAL PRIMARY KEY,
  org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan               TEXT NOT NULL DEFAULT 'free',
  status             TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  current_period_end TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id   BIGINT REFERENCES users(id),
  action     TEXT NOT NULL,
  target     TEXT,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSONB,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
`,
      },
      {
        path: 'migrations/002_api_keys.sql',
        content: `-- API keys: per-organization, hashed at rest. The plaintext key is shown ONCE
-- on creation and never stored. \`prefix\` allows safe display/lookup.
-- PostgreSQL DDL; for SQLite see adjustments in SAAS.md.
CREATE TABLE IF NOT EXISTS api_keys (
  id           BIGSERIAL PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by   BIGINT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,                 -- e.g. "sk_live_AB12" (display only)
  key_hash     TEXT NOT NULL,                 -- SHA-256 of the full secret
  scopes       JSONB NOT NULL DEFAULT '[]',   -- ["billing:read","members:write"]
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org    ON api_keys(org_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
`,
      },
      {
        path: 'migrations/003_settings.sql',
        content: `-- Settings: typed key/value per org and per user. JSONB value keeps it flexible
-- without schema churn. One row per (scope, key).
-- PostgreSQL DDL; for SQLite see adjustments in SAAS.md.
CREATE TABLE IF NOT EXISTS org_settings (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS user_settings (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_org_settings  ON org_settings(org_id);
CREATE INDEX IF NOT EXISTS idx_user_settings ON user_settings(user_id);
`,
      },
      {
        path: 'src/middleware/tenant.ts',
        content: `// src/middleware/tenant.ts
// Multi-tenant request scoping for the SaaS starter (overlay code — NOT framework code).
//
// Responsibilities:
//   1. tenantResolver — resolve the active organization for a request and assert
//      the requester holds a membership in it (otherwise 403).
//   2. orgScopedRepo  — wrap a repository so every read is filtered by
//      org_id = ctx.org.id and every write is stamped with that org id,
//      overriding any org_id supplied in the payload. Cross-tenant row access
//      is denied with 403.

import {
  ForbiddenException,
  UnauthorizedException,
  type MiddlewareFn,
  type StreetContext,
} from 'streetjs';

/** The active organization attached to the request context by tenantResolver. */
export interface ActiveOrg {
  id: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';
}

/** Hints used to resolve the active org, in first-match-wins precedence order. */
export interface OrgResolutionHints {
  slug?: string;
  headerId?: string;
  sessionOrg?: string;
}

/** Minimal contract the resolver needs from the membership module. */
export interface MembershipResolver {
  // Returns the active org IFF a memberships(org_id, user_id) row exists; else null.
  resolveActiveOrg(userId: string, hints: OrgResolutionHints): Promise<ActiveOrg | null>;
}

/**
 * tenantResolver — determines the active organization and asserts membership.
 *
 * Resolution order (first match wins): path ':slug' or 'X-Org-Slug' header,
 * then 'X-Org-Id' header, then the session's active org. The resolved org is
 * set on ctx.org. If the user is not authenticated -> 401; if no org can be
 * resolved for which the user holds a membership -> 403 and no active org is
 * established (the membership gate is enforced inside resolveActiveOrg).
 */
export function tenantResolver(deps: { members: MembershipResolver }): MiddlewareFn {
  return async (ctx: StreetContext, next: () => Promise<void>): Promise<void> => {
    if (!ctx.user) throw new UnauthorizedException('authentication required');

    // First-match-wins precedence: slug (path param or X-Org-Slug header) ->
    // X-Org-Id header -> session active org.
    const slug =
      (ctx.params?.['slug'] as string | undefined) ??
      (ctx.headers?.['x-org-slug'] as string | undefined);
    const headerId = ctx.headers?.['x-org-id'] as string | undefined;
    const sessionOrg = (ctx.state?.['session'] as { activeOrgId?: string } | undefined)
      ?.activeOrgId;

    // resolveActiveOrg returns a non-null org ONLY when a memberships row links
    // the user to that org (membership gate). Otherwise it returns null and the
    // request is rejected with 403 without establishing an active organization.
    const org = await deps.members.resolveActiveOrg(ctx.user.id, { slug, headerId, sessionOrg });
    if (!org) throw new ForbiddenException('no active organization');

    ctx.org = org; // { id, slug, role } — exactly one active org per request.
    await next();
  };
}

/** A row that carries a tenant discriminator. */
interface OrgScopedRow {
  org_id: string;
}

/** The subset of a repository the org-scoped wrapper relies on. */
export interface ScopedRepository<T extends OrgScopedRow> {
  find(filter: Record<string, unknown>): Promise<T[]>;
  findOne(filter: Record<string, unknown>): Promise<T | null>;
  insert(values: Partial<T>): Promise<T>;
  update(filter: Record<string, unknown>, values: Partial<T>): Promise<T>;
}

/**
 * orgScopedRepo — wraps a repository so tenant scoping is unavoidable.
 *
 *   reads  : every filter gets org_id = ctx.org.id injected; rows whose org_id
 *            differs are excluded from results.
 *   writes : org_id is stamped to ctx.org.id, OVERRIDING any payload value.
 *   access : reading or updating an existing row whose org_id differs ->
 *            ForbiddenException (403), leaving the row unchanged.
 */
export function orgScopedRepo<T extends OrgScopedRow>(
  repo: ScopedRepository<T>,
  ctx: StreetContext,
): ScopedRepository<T> {
  const orgId = ctx.org?.id;
  if (!orgId) throw new ForbiddenException('no active organization');

  const assertSameTenant = (row: T | null): void => {
    if (row && row.org_id !== orgId) {
      // Cross-tenant access attempt: deny and leave the row untouched.
      throw new ForbiddenException('cross-tenant access denied');
    }
  };

  return {
    async find(filter) {
      // Inject the tenant predicate, then defensively exclude any stray rows.
      const rows = await repo.find({ ...filter, org_id: orgId });
      return rows.filter((r) => r.org_id === orgId);
    },
    async findOne(filter) {
      const row = await repo.findOne({ ...filter, org_id: orgId });
      assertSameTenant(row);
      return row;
    },
    async insert(values) {
      // Stamp org_id last so it overrides any org_id supplied in the payload.
      return repo.insert({ ...values, org_id: orgId } as Partial<T>);
    },
    async update(filter, values) {
      // Confirm the target row belongs to the active tenant before mutating it.
      const existing = await repo.findOne({ ...filter, org_id: orgId });
      assertSameTenant(existing);
      if (!existing) throw new ForbiddenException('cross-tenant access denied');
      // Stamp org_id last; a payload value cannot move a row to another tenant.
      return repo.update({ ...filter, org_id: orgId }, { ...values, org_id: orgId } as Partial<T>);
    },
  };
}
`,
      },
      {
        path: 'SAAS.md',
        content: `# SaaS starter

This project was scaffolded with \`street create --starter saas\`. It overlays a
multi-tenant SaaS structure on top of the base StreetJS app.

## What's included

- **Auth** — email/password + sessions (core JWT/session primitives).
- **Organizations, teams & RBAC** — \`organizations\`, \`memberships\` (roles:
  owner/admin/member) via \`@streetjs/admin\`.
- **Invitations** — tokenized org invites (\`invitations\`).
- **Billing placeholders** — \`subscriptions\` table + a Stripe webhook handler
  stub. Add \`@streetjs/plugin-stripe\` and wire your keys to go live.
- **Audit logs** — \`audit_logs\` for every privileged action.
- **Notifications** — \`notifications\` per user.

## Schema

See \`migrations/001_saas.sql\`. Apply it with:

\`\`\`bash
street migrate:run
\`\`\`

## Suggested module layout

\`\`\`
src/
  features/saas.ts        # admin/RBAC wiring (this overlay)
  modules/
    auth/                 # sign-up, login, sessions
    orgs/                 # create org, switch org
    members/              # list/invite/remove members
    invitations/          # accept invite
    billing/              # Stripe webhook + subscription state
    audit/                # audit-log writer + viewer
\`\`\`

Generate modules with \`street generate controller|service|repository <name>\`.

## Billing (Stripe)

\`\`\`bash
npm install @streetjs/plugin-stripe
# set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (see .env.saas.example)
\`\`\`

See the [SaaS starter docs](https://hassanmubiru.github.io/StreetJS/starters/).
`,
      },
      {
        path: '.env.saas.example',
        content: `# SaaS starter — billing (Stripe) placeholders. Copy values into your .env.
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
`,
      },
    ],
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
    extraFiles: [
      {
        path: 'migrations/001_commerce.sql',
        content: `-- Marketplace/ecommerce schema — catalog, inventory, carts, orders, payments.
-- Apply with: street migrate:run  (PostgreSQL syntax; adjust types for SQLite).

CREATE TABLE IF NOT EXISTS products (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency    TEXT NOT NULL DEFAULT 'usd',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0)
);

CREATE TABLE IF NOT EXISTS carts (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  status     TEXT NOT NULL DEFAULT 'open',  -- open | ordered | abandoned
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id         BIGSERIAL PRIMARY KEY,
  cart_id    BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  total_cents INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | shipped | cancelled
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      BIGINT NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id               BIGSERIAL PRIMARY KEY,
  order_id         BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'stripe',
  provider_ref     TEXT,
  amount_cents     INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'requires_payment',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
`,
      },
      {
        path: 'COMMERCE.md',
        content: `# Marketplace / ecommerce starter

Scaffolded with \`street create --starter marketplace\`. Overlays a catalog →
cart → checkout → payment flow on the base app.

## Included

- **Catalog & inventory** — \`products\`, \`inventory\` (no-oversell via a CHECK constraint).
- **Carts** — \`carts\`, \`cart_items\`.
- **Orders** — \`orders\`, \`order_items\` (immutable unit price at purchase time).
- **Payments** — \`payments\` (Stripe-ready; add \`@streetjs/plugin-stripe\`).
- **Search** — add \`@streetjs/search\` for product search (PG full-text default).

## Schema

See \`migrations/001_commerce.sql\` — apply with \`street migrate:run\`.

## Suggested order flow

1. \`POST /carts\` → open cart · 2. \`POST /carts/:id/items\` → add product
3. \`POST /orders\` → snapshot cart to order · 4. payment webhook marks order \`paid\`.

Generate modules with \`street generate controller|service|repository <name>\`.
See the [Starters guide](https://hassanmubiru.github.io/StreetJS/starters/).
`,
      },
    ],
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
    extraFiles: [
      {
        path: 'migrations/001_realtime.sql',
        content: `-- Realtime chat schema — channels, membership and message history.
-- Apply with: street migrate:run  (PostgreSQL syntax; adjust types for SQLite).

CREATE TABLE IF NOT EXISTS channels (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         BIGSERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id, created_at DESC);
`,
      },
      {
        path: 'REALTIME.md',
        content: `# Realtime chat starter

Scaffolded with \`street create --starter realtime\`. Overlays WebSocket channels,
presence and typing indicators on the base app.

## Included

- **WebSocket server** — bounded \`StreetWebSocketServer\` with heartbeat.
- **Channels & presence** — \`ChannelHub\` (typing TTL configurable) in \`src/features/chat.ts\`.
- **Message history** — \`channels\`, \`channel_members\`, \`messages\` (see migration).
- **Auth-on-upgrade** — gate the WS upgrade with the core auth middleware.

## Schema

See \`migrations/001_realtime.sql\` — apply with \`street migrate:run\`.

## Flow

Client connects → authenticates on upgrade → joins a channel → messages are
broadcast to channel members and persisted to \`messages\`. Presence/typing are
in-memory via \`ChannelHub\`. For multi-instance fan-out, add \`@streetjs/plugin-redis\`.

See the [Starters guide](https://hassanmubiru.github.io/StreetJS/starters/) and
[Realtime docs](https://hassanmubiru.github.io/StreetJS/realtime/).
`,
      },
    ],
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
  ai: {
    packages: { '@streetjs/ai': '^1.0.0' },
    description: 'AI starter: provider-agnostic chat, embeddings and RAG (OpenAI/Anthropic/Ollama).',
    starter: {
      path: 'src/features/ai.ts',
      content: `// AI feature wiring — provider-agnostic chat + retrieval (RAG).
import { InMemoryVectorStore } from '@streetjs/ai';

// In-memory vector store for local/dev; swap for a persistent store in production.
export const vectors = new InMemoryVectorStore();

// Configure a provider (OpenAI / Anthropic / Ollama) and uncomment to enable chat + RAG:
// import { ChatSession, RagPipeline } from '@streetjs/ai';
// export const chat = new ChatSession({ provider });
// export const rag = new RagPipeline({ store: vectors, provider });
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
    // packages + a starter module on top of the base scaffold. `--starter` is a
    // friendly alias of `--template` (the documented Phase-18 flag); both work.
    // Starter aliases map convenient names to the underlying template keys.
    const STARTER_ALIASES: Record<string, string> = {
      realtime: 'realtime-chat',
      chat: 'realtime-chat',
      marketplace: 'ecommerce',
      dating: 'dating-app',
    };
    const requested = String(ctx.args.flags['starter'] ?? ctx.args.flags['template'] ?? 'app');
    const template = STARTER_ALIASES[requested] ?? requested;
    if (!TEMPLATES[template]) {
      const available = [...Object.keys(TEMPLATES), ...Object.keys(STARTER_ALIASES)].join(', ');
      console.error(`[street] Unknown starter "${requested}". Available: ${available}`);
      process.exitCode = 1;
      return;
    }

    // Optional frontend scaffold (default 'none'). Adds a `web/` app wired to
    // @streetjs/client + @streetjs/react, plus a CI workflow that builds both.
    const frontend = String(ctx.args.flags['frontend'] ?? 'none').toLowerCase();
    const FRONTENDS = ['none', 'react', 'next', 'htmx'];
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

    // Write any additional overlay files (migrations, docs, env samples).
    for (const file of spec.extraFiles ?? []) {
      const abs = join(targetDir, file.path);
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, file.content, 'utf8');
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
    } else if (frontend === 'htmx') {
      await this.scaffoldHtmx(targetDir);
    }
  }

  /**
   * Scaffold an HTMX (server-rendered) frontend *into the backend* — HTMX has no
   * separate SPA, so this adds a views tree, a views controller, and the
   * @streetjs/plugin-htmx dependency. The app renders HTML; HTMX swaps fragments.
   */
  private async scaffoldHtmx(targetDir: string): Promise<void> {
    // Add the plugin dependency.
    const pkgPath = join(targetDir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
    pkg.dependencies = { ...(pkg.dependencies ?? {}), '@streetjs/plugin-htmx': '^1.0.0' };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    await mkdir(join(targetDir, 'src', 'views', 'layouts'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'views', 'partials'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'views', 'pages'), { recursive: true });
    await mkdir(join(targetDir, 'public'), { recursive: true });

    const layout = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ title }}</title>
  <script src="https://unpkg.com/htmx.org@2.0.4" crossorigin="anonymous"></script>
  <link rel="stylesheet" href="/public/app.css">
</head>
<body>
  {{> nav }}
  <main>{{{ body }}}</main>
</body>
</html>
`;
    const nav = `<nav><a href="/">Home</a> · <a href="/dashboard">Dashboard</a> · <a href="/login">Login</a></nav>\n`;
    const todoItem = `<li id="todo-{{ id }}">{{ text }}</li>\n`;
    const home = `<h1>{{ title }}</h1>
<p>A server-rendered StreetJS + HTMX app. No SPA, no build step.</p>
<form hx-post="/todos" hx-target="#todos" hx-swap="beforeend" hx-on::after-request="this.reset()">
  <input name="text" placeholder="Add a todo" required>
  <button type="submit">Add</button>
</form>
<ul id="todos">{{{ todos }}}</ul>
`;
    const login = `<h1>Log in</h1>
<form hx-post="/login" hx-target="#error">
  <div id="error"></div>
  <input name="email" type="email" placeholder="Email" required>
  <input name="password" type="password" placeholder="Password" required>
  <button type="submit">Log in</button>
</form>
`;
    const register = `<h1>Create account</h1>
<form hx-post="/register" hx-target="#error">
  <div id="error"></div>
  <input name="email" type="email" placeholder="Email" required>
  <input name="password" type="password" placeholder="Password" required>
  <button type="submit">Sign up</button>
</form>
`;
    const dashboard = `<h1>Dashboard</h1>
<p>Welcome, {{ user.email }}.</p>
<div hx-get="/notifications" hx-trigger="every 5s" hx-swap="innerHTML">Loading notifications…</div>
`;
    await writeFile(join(targetDir, 'src/views/layouts/main.html'), layout, 'utf8');
    await writeFile(join(targetDir, 'src/views/partials/nav.html'), nav, 'utf8');
    await writeFile(join(targetDir, 'src/views/partials/todo-item.html'), todoItem, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/home.html'), home, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/login.html'), login, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/register.html'), register, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/dashboard.html'), dashboard, 'utf8');
    await writeFile(join(targetDir, 'public', 'app.css'), 'body{font-family:system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;line-height:1.6}nav{margin-bottom:2rem}\n', 'utf8');

    const controller = `import 'reflect-metadata';
import { Controller, Get, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';

// HTMX views controller. \`ctx.htmx\` is attached by HtmxPlugin.middleware()
// (registered in main.ts). \`view()\` returns the full layout on navigation and
// just the page fragment on an HTMX request.
@Controller('/')
export class ViewsController {
  private todos: { id: number; text: string }[] = [];
  private nextId = 1;

  @Get('/')
  async home(ctx: StreetContext): Promise<void> {
    const todos = this.todos.map((t) => ctx.htmx.engine.partial('todo-item', t)).join('');
    ctx.htmx.view('home', { title: 'Home', todos });
  }

  @Post('/todos')
  async addTodo(ctx: StreetContext): Promise<void> {
    const { text } = ctx.body as { text: string };
    const todo = { id: this.nextId++, text };
    this.todos.push(todo);
    ctx.htmx.hx({ trigger: 'todoAdded' }).partial('todo-item', todo); // returns just the new <li>
  }

  @Get('/dashboard')
  async dashboard(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('dashboard', { title: 'Dashboard', user: { email: 'you@example.com' } });
  }

  @Get('/login')
  async login(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('login', { title: 'Log in' });
  }

  @Get('/register')
  async register(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('register', { title: 'Create account' });
  }
}
`;
    await writeFile(join(targetDir, 'src/controllers/views.controller.ts'), controller, 'utf8');

    const note = `# HTMX frontend

This project renders HTML on the server and uses [HTMX](https://htmx.org) to swap
fragments — no SPA, no client build step. Powered by \`@streetjs/plugin-htmx\`.

## Wire it up (one-time)

Add these lines to \`src/main.ts\`:

\`\`\`ts
import HtmxPlugin from '@streetjs/plugin-htmx';
import { ViewsController } from './controllers/views.controller.js';

// after the other app.use(...) middleware:
app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'main' }));
// with the other app.registerController(...) calls:
app.registerController(ViewsController);
\`\`\`

## Layout

\`\`\`
src/views/
  layouts/main.html      # contains {{{ body }}}; loads htmx
  partials/              # nav, todo-item
  pages/                 # home, login, register, dashboard
public/app.css
\`\`\`

Template syntax: \`{{ x }}\` (escaped), \`{{{ x }}}\` (raw), \`{{> name }}\` (partial).
Compose lists by rendering partials in the controller (see \`views.controller.ts\`).

Docs: https://hassanmubiru.github.io/StreetJS/starters/
`;
    await writeFile(join(targetDir, 'HTMX.md'), note, 'utf8');
    console.log('[street] Scaffolded HTMX (server-rendered) views in src/views/ + @streetjs/plugin-htmx.');
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
        dev: 'next dev -p 3001',
        build: 'next build',
        start: 'next start -p 3001',
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
    return `import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const nextConfig = {
  // Pin the workspace root to this app so Next does not infer a parent directory
  // when a sibling/parent lockfile exists (the backend ships its own lockfile).
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  async rewrites() {
    // Proxy API/auth/health calls to the Street backend so cookies stay
    // first-party. The dev server runs on a different port (see package.json)
    // so these never proxy back to Next itself.
    return [
      { source: '/api/:path*', destination: apiUrl + '/api/:path*' },
      { source: '/auth/:path*', destination: apiUrl + '/auth/:path*' },
      { source: '/health', destination: apiUrl + '/health' },
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
    const webJob = (frontend === 'none' || frontend === 'htmx') ? '' : `
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
