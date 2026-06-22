# SaaS starter

This project was scaffolded with `street create --starter saas`. It overlays a
multi-tenant SaaS structure on top of the base StreetJS app.

## Dependency-minimal by default

The default `--starter saas` scaffold is **dependency-minimal**: on top of the
`streetjs` core it adds only the server-rendered dashboard runtime
(`@streetjs/plugin-htmx`). Every default-scaffolded source file imports only
from `streetjs`, Node builtins, local files, or `@streetjs/plugin-htmx`, so the
project **installs cleanly from npm** and **type-checks with `tsc`** out of the
box.

Optional features are **opt-in** at scaffold time and pull in only the published
package(s) they need:

| Flag | Adds | Package(s) |
|------|------|------------|
| `--with-billing`  | Stripe webhook controller (`src/modules/billing/billing.controller.ts`) | `@streetjs/plugin-stripe` |
| `--with-admin-ui` | Auth + RBAC React screens (`src/modules/dashboard/auth-ui.controller.ts`) | `@streetjs/auth-ui`, `@streetjs/admin-ui` |
| `--with-email`    | Email delivery for notifications (injected `Mailer`) | `@streetjs/plugin-sendgrid` (install when wiring the transport) |

```bash
# Minimal default (installs + type-checks with zero extra @streetjs packages):
street create my-saas --starter saas

# Opt into billing and the auth/RBAC management screens:
street create my-saas --starter saas --with-billing --with-admin-ui
```

> The billing service (`billing.service.ts`) and the notification service
> (`notification.service.ts`) ship in the **default** scaffold — they import no
> third-party package (Stripe events are typed locally; email is delivered
> through an injected `Mailer` interface). Only the billing **webhook
> controller** and the auth/RBAC **UI controller** are flag-gated, because only
> they statically import an optional `@streetjs/*` package.

## What's included

- **Auth** — email/password + sessions (core JWT/session primitives).
- **Organizations, teams & RBAC** — `organizations`, `memberships` (roles:
  owner/admin/member). RBAC is composed from the core `requireRoles(...)`
  middleware (see `src/features/saas.ts`); the managed `@streetjs/admin`
  `AdminService` is an optional enhancement you can install separately.
- **Multi-tenancy** — row-level scoping by `org_id` + `tenantResolver`
  middleware (see below).
- **Invitations** — tokenized org invites (`invitations`).
- **Billing placeholders** — `subscriptions` table + a Stripe webhook handler.
  Scaffold the webhook controller with `--with-billing` (adds
  `@streetjs/plugin-stripe`) and wire your keys to go live.
- **API keys** — hashed-at-rest programmatic keys (`api_keys`) + `apiKeyAuth`
  middleware (see below).
- **Settings** — per-org and per-user key/value settings (`org_settings`,
  `user_settings`).
- **Audit logs** — `audit_logs` for every privileged action.
- **Notifications** — `notifications` per user (in-app always; email via
  `--with-email` + `@streetjs/plugin-sendgrid`).

## Schema

The starter ships an **additive** migration set. Apply it with:

```bash
street migrate:run
```

Migrations are applied in ascending order by the core `StreetMigrationRunner`:

- `migrations/001_saas.sql` — base SaaS schema (users, organizations,
  memberships, invitations, subscriptions, audit_logs, notifications).
  **Preserved unchanged.**
- `migrations/002_api_keys.sql` — `api_keys` table (additive).
- `migrations/003_settings.sql` — `org_settings` + `user_settings` tables
  (additive).

`001_saas.sql` is never modified; API keys and settings are layered on top via
`002`/`003` so existing scaffolded projects can adopt them incrementally.

## Suggested module layout

```
src/
  features/saas.ts        # admin/RBAC wiring (this overlay)
  middleware/
    tenant.ts             # tenantResolver — scope requests by active org
    apiKeyAuth.ts         # X-API-Key authentication
  modules/
    auth/                 # sign-up, login, sessions
    orgs/                 # create org, switch org
    members/              # list/invite/remove members
    invitations/          # accept invite
    billing/              # Stripe webhook + subscription state
    apikeys/              # create/list/revoke API keys
    audit/                # audit-log writer + viewer
    settings/             # org + user settings
    notifications/        # email + in-app notifications
```

Generate modules with `street generate controller|service|repository <name>`.

## Multi-tenancy

The starter uses a **shared database, shared schema** model with **row-level
tenant scoping by `org_id`**. Every tenant-scoped table carries an `org_id`
column, and every read/write is constrained to the active organization.

- **`tenantResolver` middleware** resolves the active organization for each
  request (in order: path/subdomain org slug, `X-Org-Slug` / `X-Org-Id`
  header, then the active org stored in the session) and populates `ctx.org`.
- **Membership gate**: the authenticated user MUST have a `memberships` row for
  the resolved org. If not, the request is rejected with `403` — there is **no
  cross-tenant access**. A tenant-scoped request that cannot resolve exactly one
  org for which the requester holds a membership also returns `403`.
- **Repository scoping**: tenant-scoped repositories inject
  `WHERE org_id = ctx.org.id` on every read and stamp `org_id = ctx.org.id` on
  every write, overriding any `org_id` supplied in the request payload.

> **Advanced upgrade path.** The shared-schema model is the lowest-friction
> default. For stronger isolation you can layer on Postgres **row-level security
> (RLS)** policies or move to a **schema-per-tenant** topology. These are
> deliberately **not** baked into the starter; adopt them only if your
> compliance needs require it.

## API keys

Programmatic clients authenticate with API keys instead of a user session.

- **Hashed at rest**: only the key **prefix** (display-only, e.g.
  `sk_live_AB12`) and the **SHA-256 hash** of the secret are stored. The
  plaintext key is **never** persisted.
- **Shown once**: the full plaintext key is returned **exactly once** in the
  creation response. Store it securely — it cannot be recovered afterward.
- **Scopes**: each key carries a list of scopes (e.g.
  `["billing:read","members:write"]`); a request is limited to its key's
  scopes, and a request needing a scope the key lacks is denied.
- **Revocation & expiry**: revoking a key stamps `revoked_at`; a key may also
  carry an `expires_at`. Any request presenting a revoked or expired key — or a
  missing/empty/unknown key — is rejected with `401`.
- **Usage**: send the plaintext key in the `X-API-Key` request header. Listing
  keys returns metadata only (id, name, prefix, scopes, timestamps) and never
  the hash or plaintext.

## Settings

Flexible per-org and per-user configuration backed by `org_settings` and
`user_settings`.

- **Single value per (scope, key)**: a uniqueness constraint enforces at most one
  row per `(org_id, key)` and per `(user_id, key)`. Writing an existing key
  replaces the prior value in place rather than adding a row.
- **JSONB values**: values are stored as JSONB, so any JSON-serializable value
  is allowed. Reading a key with no stored row returns "no value" without
  creating a row.

## SQLite (dev) ↔ Postgres (production)

The starter runs the **same schema** on SQLite in development and Postgres in
production.

- **Zero-config SQLite default**: when no database configuration is provided, the
  app defaults to **SQLite** — no setup required to start developing.
- **Postgres in production**: providing the `PG_*` environment variables selects
  **Postgres** via `@streetjs/plugin-postgres` as the production driver:

  ```bash
  npm install @streetjs/plugin-postgres
  # set PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD (see .env.saas.example)
  ```

- **Invalid configuration fails fast**: if Postgres is selected but the required
  `PG_*` configuration is missing or invalid, the app emits a **startup error
  indicating the database configuration is invalid** rather than guessing
  credentials or silently falling back.

The migrations are written as PostgreSQL DDL. When running on SQLite, the core
runner applies the following type adjustments:

| PostgreSQL          | SQLite                                |
|---------------------|---------------------------------------|
| `BIGSERIAL`         | `INTEGER PRIMARY KEY AUTOINCREMENT`   |
| `TIMESTAMPTZ`       | `TEXT` / `DATETIME`                   |
| `JSONB`             | `TEXT`                                |
| `now()`             | `CURRENT_TIMESTAMP`                   |

Apply the full set the same way on either driver:

```bash
street migrate:run
```

`001_saas.sql` is preserved unchanged; `002_api_keys.sql` and
`003_settings.sql` are additive, so the migration order
(`001` → `002` → `003`) holds on both SQLite and Postgres.

## Billing (Stripe)

Scaffold the signature-verified Stripe webhook controller with the
`--with-billing` flag (adds `@streetjs/plugin-stripe`):

```bash
street create my-saas --starter saas --with-billing
# set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (see .env.saas.example)
```

If you scaffolded without the flag, add it later:

```bash
npm install @streetjs/plugin-stripe
```

The `subscriptions` table and `billing.service.ts` (which imports no third-party
package) ship in the default scaffold either way.

## Auth & RBAC management screens (admin UI)

Scaffold the server-rendered auth + RBAC React screens with `--with-admin-ui`
(adds `@streetjs/auth-ui` and `@streetjs/admin-ui`):

```bash
street create my-saas --starter saas --with-admin-ui
```

This emits `src/modules/dashboard/auth-ui.controller.ts`, which composes the
official React component packages (no client build step — they load from an ESM
CDN via an importmap). The core dashboard (`dashboard.controller.ts`) and its
htmx views ship in the default scaffold regardless.

## Email notifications

In-app notifications are always available. To deliver email as well, scaffold
with `--with-email` and provide a `Mailer` implementation backed by
`@streetjs/plugin-sendgrid`:

```bash
street create my-saas --starter saas --with-email
npm install @streetjs/plugin-sendgrid
# set SENDGRID_API_KEY (see .env.saas.example)
```

`notification.service.ts` takes the transport through an injected `Mailer`
interface, so the default scaffold imports no email package; email is simply
skipped until a `Mailer` is wired.

See the [SaaS starter docs](https://hassanmubiru.github.io/StreetJS/starters/).
