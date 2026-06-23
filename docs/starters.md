---
layout:      default
title:       "Starters"
nav_order:   14
permalink:   /starters/
description:  "StreetJS project starters — scaffold a SaaS, AI, realtime, or marketplace backend in one command with street create --starter."
---

<div class="doc-header" markdown="0">
<span class="dh-label">Starters</span>
<h1>Project Starters</h1>
<p>Scaffold a complete, opinionated backend in one command. Each starter overlays the relevant official packages and a wired-up feature module on top of the base app — pick one and start building.</p>
</div>

Use the `--starter` flag (alias of `--template`) with [`street create`](/StreetJS/cli-reference/):

```bash
npx @streetjs/cli create my-app --starter saas
```

Combine with `--frontend next|react|htmx` and `--database postgres|sqlite` as needed.

## Available starters

| Starter | Command | What you get |
|---------|---------|--------------|
| **SaaS** | `--starter saas` | Multi-tenant orgs & teams, RBAC (core `requireRoles`), invitations, API keys, audit logs, notifications, and billing placeholders — all on the base app, no extra runtime deps by default |
| **AI** | `--starter ai` | Provider-agnostic chat, embeddings and RAG scaffolding (`@streetjs/ai`) |
| **Realtime** | `--starter realtime` | WebSocket channels, presence and typing |
| **Marketplace** | `--starter marketplace` | Products, inventory, carts, orders, payments (`@streetjs/commerce`) |
| **Dating** | `--starter dating` | Encrypted profiles, likes, reciprocal matching (`@streetjs/dating-profiles`) |
| **Minimal** | _(no flag)_ | HTTP, DI, database and health checks — the base app |

Friendly aliases resolve automatically: `realtime` → `realtime-chat`,
`marketplace` → `ecommerce`, `dating` → `dating-app`.

## SaaS opt-in modules (`--with-*`)

The SaaS starter keeps the default scaffold dependency-minimal: orgs, RBAC,
multi-tenancy, audit and notifications are built on the core framework with **no
third-party runtime dependencies**. Richer integrations are opt-in flags that add
their package only when requested:

| Flag | Adds | Package(s) |
|------|------|------------|
| `--with-billing` | Signature-verified Stripe webhook controller + billing module | `@streetjs/plugin-stripe` |
| `--with-marzpay` | MarzPay billing, subscription, checkout/webhook modules + dashboard | `@streetjs/plugin-marzpay` |
| `--with-admin-ui` | Server-rendered auth + RBAC management screens | `@streetjs/auth-ui`, `@streetjs/admin-ui` |
| `--with-email` | Email delivery for notifications (injected `Mailer`) | `@streetjs/plugin-sendgrid` |

```bash
# SaaS with Stripe billing and the auth/RBAC management screens:
npx @streetjs/cli create my-saas --starter saas --with-billing --with-admin-ui
```

> The managed `@streetjs/admin` `AdminService` (wildcard permissions, `can()`,
> audit primitives) is an **optional enhancement** you install separately — the
> base SaaS starter does not depend on it.

## Next steps after scaffolding

```bash
cd my-app
npm install
street dev
```

- Browse the [Plugin Marketplace](/StreetJS/plugins/marketplace/) to add capabilities
  (payments, storage, search, messaging, auth).
- Read the [CLI reference](/StreetJS/cli-reference/) for `generate`, `migrate`, and `deploy`.
- See [Examples](/StreetJS/examples/) and the [Showcase](/StreetJS/showcase/) for full apps.

> Starters compose existing official packages and generators — no lock-in, no
> generated code you can't read or change.
