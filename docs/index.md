---
layout:      home
title:       Home
nav_order:   1
permalink:   /
description: "Street Framework — production-grade, memory-safe TypeScript backend framework built on Node.js core modules. No Express. No pg. No Prisma."
---

<style>
/* ── Hero ──────────────────────────────────────────────────────────────── */
.street-hero {
  text-align: center;
  padding: 4rem 1rem 3rem;
  background: linear-gradient(160deg, #0d1117 0%, #161b22 60%, #0d1117 100%);
  border-radius: 12px;
  margin-bottom: 3rem;
  border: 1px solid #21262d;
  position: relative;
  overflow: hidden;
}
.street-hero::before {
  content: '';
  position: absolute;
  top: -60px; left: 50%; transform: translateX(-50%);
  width: 600px; height: 300px;
  background: radial-gradient(ellipse, rgba(88,166,255,0.08) 0%, transparent 70%);
  pointer-events: none;
}
.street-hero h1 {
  font-size: clamp(2.4rem, 6vw, 3.8rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  margin: 0 0 0.5rem;
  background: linear-gradient(135deg, #e6edf3 30%, #58a6ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.street-hero .tagline {
  font-size: clamp(1rem, 2.5vw, 1.25rem);
  color: #8b949e;
  max-width: 600px;
  margin: 0 auto 0.75rem;
  line-height: 1.6;
}
.street-hero .sub-tagline {
  font-size: 0.95rem;
  color: #6e7681;
  margin-bottom: 2rem;
  font-family: 'SFMono-Regular', Consolas, monospace;
}
.street-hero .sub-tagline span {
  color: #58a6ff;
}
.hero-btns {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 2rem;
}
.hero-btns a {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.65rem 1.4rem;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.15s ease;
}
.btn-primary-hero {
  background: #1f6feb;
  color: #fff !important;
  border: 1px solid #388bfd;
}
.btn-primary-hero:hover { background: #388bfd; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(56,139,253,0.3); }
.btn-ghost-hero {
  background: transparent;
  color: #e6edf3 !important;
  border: 1px solid #30363d;
}
.btn-ghost-hero:hover { background: #21262d; border-color: #58a6ff; transform: translateY(-1px); }
.hero-badges {
  display: flex;
  gap: 0.4rem;
  justify-content: center;
  flex-wrap: wrap;
}
/* ── Install strip ─────────────────────────────────────────────────────── */
.install-strip {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 3rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.install-strip .label {
  color: #6e7681;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.install-strip code {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 0.95rem;
  color: #58a6ff;
  background: transparent;
  border: none;
  padding: 0;
}
/* ── Stat bar ──────────────────────────────────────────────────────────── */
.stat-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1px;
  background: #21262d;
  border: 1px solid #21262d;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 3rem;
}
.stat-item {
  background: #0d1117;
  padding: 1.25rem 1rem;
  text-align: center;
}
.stat-item .num {
  font-size: 1.75rem;
  font-weight: 800;
  color: #58a6ff;
  line-height: 1;
  margin-bottom: 0.25rem;
}
.stat-item .desc {
  font-size: 0.78rem;
  color: #6e7681;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
/* ── Section headings ──────────────────────────────────────────────────── */
.section-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #58a6ff;
  margin-bottom: 0.5rem;
}
.section-title {
  font-size: clamp(1.4rem, 3vw, 1.9rem);
  font-weight: 700;
  color: #e6edf3;
  margin: 0 0 0.5rem;
}
.section-sub {
  color: #8b949e;
  margin-bottom: 2rem;
  font-size: 1rem;
}
/* ── Feature grid ──────────────────────────────────────────────────────── */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  margin-bottom: 3rem;
}
.feature-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 10px;
  padding: 1.4rem;
  transition: border-color 0.15s, transform 0.15s;
}
.feature-card:hover { border-color: #58a6ff; transform: translateY(-2px); }
.feature-card .icon {
  font-size: 1.6rem;
  margin-bottom: 0.75rem;
  display: block;
}
.feature-card h3 {
  font-size: 1rem;
  font-weight: 700;
  color: #e6edf3;
  margin: 0 0 0.5rem;
}
.feature-card p {
  font-size: 0.875rem;
  color: #8b949e;
  margin: 0;
  line-height: 1.6;
}
/* ── No-dep table ──────────────────────────────────────────────────────── */
.nodep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 0.75rem;
  margin-bottom: 3rem;
}
.nodep-item {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}
.nodep-item .cross {
  color: #f85149;
  font-weight: 800;
  font-size: 1rem;
  flex-shrink: 0;
  margin-top: 2px;
}
.nodep-item .arrow {
  color: #3fb950;
  font-weight: 800;
  font-size: 0.9rem;
  flex-shrink: 0;
  margin-top: 2px;
}
.nodep-item .content strong {
  color: #e6edf3;
  font-size: 0.9rem;
}
.nodep-item .content span {
  color: #8b949e;
  font-size: 0.82rem;
  display: block;
  margin-top: 0.15rem;
}
/* ── Code block ────────────────────────────────────────────────────────── */
.code-section {
  margin-bottom: 3rem;
}
/* ── Memory table ──────────────────────────────────────────────────────── */
.memory-section { margin-bottom: 3rem; }
/* ── Comparison ────────────────────────────────────────────────────────── */
.compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
  margin-bottom: 3rem;
}
.compare-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
}
.compare-card .fw { font-size: 0.85rem; font-weight: 700; color: #8b949e; margin-bottom: 0.5rem; }
.compare-card .advantage { font-size: 0.8rem; color: #3fb950; line-height: 1.5; }
/* ── Doc links ─────────────────────────────────────────────────────────── */
.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
  margin-bottom: 3rem;
}
.doc-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  text-decoration: none;
  display: block;
  transition: border-color 0.15s, background 0.15s;
}
.doc-card:hover { border-color: #58a6ff; background: #1c2128; text-decoration: none; }
.doc-card .doc-title { font-size: 0.9rem; font-weight: 700; color: #58a6ff; margin-bottom: 0.25rem; }
.doc-card .doc-desc { font-size: 0.8rem; color: #8b949e; }
</style>

<!-- ── HERO ──────────────────────────────────────────────────────────────── -->
<div class="street-hero">
  <h1>Street Framework</h1>
  <p class="tagline">Production-grade TypeScript backend framework.<br>Built on Node.js core. Zero bloat. Maximum control.</p>
  <p class="sub-tagline">
    <span>No Express.</span> &nbsp;·&nbsp;
    <span>No pg.</span> &nbsp;·&nbsp;
    <span>No Prisma.</span> &nbsp;·&nbsp;
    <span>No Zod.</span> &nbsp;·&nbsp;
    <span>No bcrypt.</span>
  </p>
  <div class="hero-btns">
    <a href="{{ site.baseurl }}/getting-started/installation/" class="btn-primary-hero">Get Started →</a>
    <a href="{{ site.baseurl }}/examples/" class="btn-ghost-hero">View Examples</a>
    <a href="https://github.com/hassanmubiru/street" class="btn-ghost-hero" target="_blank">GitHub ↗</a>
    <a href="https://www.npmjs.com/package/@streetjs/core" class="btn-ghost-hero" target="_blank">npm ↗</a>
  </div>
  <div class="hero-badges">
    <img src="https://img.shields.io/npm/v/@streetjs/core?label=%40streetjs%2Fcore&color=1f6feb&style=flat-square" alt="npm version">
    <img src="https://img.shields.io/npm/v/@streetjs/cli?label=%40streetjs%2Fcli&color=1f6feb&style=flat-square" alt="cli version">
    <img src="https://img.shields.io/badge/node-%3E%3D20-3fb950?style=flat-square" alt="Node.js">
    <img src="https://img.shields.io/badge/TypeScript-5.0%2B-3178c6?style=flat-square" alt="TypeScript">
    <img src="https://img.shields.io/badge/license-MIT-8b949e?style=flat-square" alt="MIT">
    <img src="https://img.shields.io/badge/deps-2-3fb950?style=flat-square" alt="2 dependencies">
    <img src="https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg?style=flat-square" alt="CI">
  </div>
</div>

<!-- ── INSTALL STRIP ─────────────────────────────────────────────────────── -->
<div class="install-strip">
  <span class="label">Quick start</span>
  <code>npm install -g @streetjs/cli</code>
  <span style="color:#30363d">│</span>
  <code>street create my-api</code>
  <span style="color:#30363d">│</span>
  <code>cd my-api && npm install && street dev</code>
</div>

<!-- ── STATS ─────────────────────────────────────────────────────────────── -->
<div class="stat-bar">
  <div class="stat-item"><div class="num">2</div><div class="desc">Runtime deps</div></div>
  <div class="stat-item"><div class="num">0</div><div class="desc">Express / Fastify</div></div>
  <div class="stat-item"><div class="num">v3</div><div class="desc">PG wire protocol</div></div>
  <div class="stat-item"><div class="num">AES-256</div><div class="desc">Session encryption</div></div>
  <div class="stat-item"><div class="num">100K</div><div class="desc">IP rate limit cap</div></div>
  <div class="stat-item"><div class="num">Node 20+</div><div class="desc">ESM native</div></div>
</div>

<!-- ── FEATURES ──────────────────────────────────────────────────────────── -->
<div class="section-label">Core capabilities</div>
<div class="section-title">Everything you need. Nothing you don't.</div>
<p class="section-sub">Every feature is built from Node.js core modules with explicit memory bounds.</p>

<div class="feature-grid">
  <div class="feature-card">
    <span class="icon">🔷</span>
    <h3>TypeScript First</h3>
    <p>Strict mode, NodeNext ESM, decorator metadata, full type inference. Zero <code>any</code> in the framework source.</p>
  </div>
  <div class="feature-card">
    <span class="icon">🛡️</span>
    <h3>Memory-Safe by Design</h3>
    <p>Bounded body limits, connection pools, ring-buffer telemetry, LRU eviction, WebSocket caps. No unbounded collections.</p>
  </div>
  <div class="feature-card">
    <span class="icon">🐘</span>
    <h3>Native PostgreSQL Driver</h3>
    <p>Wire protocol v3 over <code>node:net</code>. SCRAM-SHA-256 auth. Streaming rows with socket-level backpressure. No <code>pg</code>.</p>
  </div>
  <div class="feature-card">
    <span class="icon">💉</span>
    <h3>Dependency Injection</h3>
    <p>IoC container with constructor injection, singleton registry, and circular dependency detection via <code>reflect-metadata</code>.</p>
  </div>
  <div class="feature-card">
    <span class="icon">🔐</span>
    <h3>Security Built-in</h3>
    <p>JWT (HMAC-SHA256), AES-256-GCM sessions, scrypt vault, sliding-window rate limiter, XSS sanitizer, CSRF, CORS, CSP.</p>
  </div>
  <div class="feature-card">
    <span class="icon">⚡</span>
    <h3>Real-Time Ready</h3>
    <p>Bounded WebSocket server with heartbeat, typed event emitter, and SSE with keep-alive. Auth hook on upgrade.</p>
  </div>
  <div class="feature-card">
    <span class="icon">📋</span>
    <h3>OpenAPI 3.1 Auto-gen</h3>
    <p>Spec generated from <code>@ApiOperation</code> decorators. Always in sync. Served at <code>/openapi.json</code>. No separate schema files.</p>
  </div>
  <div class="feature-card">
    <span class="icon">🔄</span>
    <h3>Clustering & Telemetry</h3>
    <p><code>node:cluster</code> coordinator with IPC heartbeat, auto-restart, graceful shutdown, and P50/P99 latency tracking.</p>
  </div>
  <div class="feature-card">
    <span class="icon">🚀</span>
    <h3>CLI Tooling</h3>
    <p><code>street create</code>, <code>street dev</code>, <code>street generate</code>, <code>street migrate:create</code> — full lifecycle from one binary.</p>
  </div>
</div>

<!-- ── NO DEPENDENCIES ───────────────────────────────────────────────────── -->
<div class="section-label">Zero bloat</div>
<div class="section-title">No third-party middleware stack.</div>
<p class="section-sub">Every capability is implemented directly from Node.js core modules.</p>

<div class="nodep-grid">
  <div class="nodep-item">
    <span class="cross">✕</span>
    <span class="arrow">→</span>
    <div class="content"><strong>No Express / Fastify</strong><span>Native <code>node:http</code> server with compiled-regex router</span></div>
  </div>
  <div class="nodep-item">
    <span class="cross">✕</span>
    <span class="arrow">→</span>
    <div class="content"><strong>No pg / postgres.js</strong><span>PostgreSQL wire protocol v3 over <code>node:net</code></span></div>
  </div>
  <div class="nodep-item">
    <span class="cross">✕</span>
    <span class="arrow">→</span>
    <div class="content"><strong>No Prisma / Zod</strong><span>Parameterized queries + <code>@Validate</code> decorator</span></div>
  </div>
  <div class="nodep-item">
    <span class="cross">✕</span>
    <span class="arrow">→</span>
    <div class="content"><strong>No jsonwebtoken</strong><span>HMAC-SHA256 via <code>node:crypto</code> with <code>timingSafeEqual</code></span></div>
  </div>
  <div class="nodep-item">
    <span class="cross">✕</span>
    <span class="arrow">→</span>
    <div class="content"><strong>No bcrypt / argon2</strong><span>scrypt via <code>node:crypto</code> for password hashing</span></div>
  </div>
  <div class="nodep-item">
    <span class="cross">✕</span>
    <span class="arrow">→</span>
    <div class="content"><strong>No multer / busboy</strong><span>Streaming multipart parser — ≤128 KB heap per upload</span></div>
  </div>
</div>

<!-- ── CODE EXAMPLE ──────────────────────────────────────────────────────── -->
<div class="section-label">Quick example</div>
<div class="section-title">From zero to production API in minutes.</div>

```typescript
import 'reflect-metadata';
import {
  streetApp, Injectable, Controller, Get, Post,
  PgPool, container, securityHeaders, corsMiddleware,
  RateLimiter, authMiddleware, JwtService,
} from '@streetjs/core';
import type { StreetContext } from '@streetjs/core';

@Injectable()
class ItemService {
  constructor(private readonly pool: PgPool) {}

  async findAll() {
    const result = await this.pool.query('SELECT * FROM items ORDER BY created_at DESC');
    return result.rows;
  }

  async create(name: string) {
    const result = await this.pool.query(
      'INSERT INTO items (name) VALUES ($1) RETURNING *', [name]
    );
    return result.rows[0];
  }
}

@Controller('/api/items')
class ItemController {
  constructor(private readonly svc: ItemService) {}

  @Get('/')
  async list(ctx: StreetContext): Promise<void> {
    ctx.json({ items: await this.svc.findAll() });
  }

  @Post('/')
  async create(ctx: StreetContext): Promise<void> {
    const { name } = ctx.body as { name: string };
    ctx.json(await this.svc.create(name), 201);
  }
}

const jwt = new JwtService(process.env.JWT_SECRET!);
const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 100 });
const app = streetApp({ port: 3000 });

app.use(securityHeaders);
app.use(corsMiddleware(['https://app.example.com']));
app.use(limiter.middleware());
app.use(authMiddleware(jwt));
app.registerController(ItemController);

await app.listen();
// [street] Listening on http://0.0.0.0:3000
```

<!-- ── MEMORY BOUNDS ───────────────────────────────────────────────────────── -->
<div class="section-label">Memory safety</div>
<div class="section-title">Every component has explicit bounds.</div>

| Component | Bound | Mechanism |
|:---|:---|:---|
| HTTP request body | 1 MB (configurable) | Stream abort on overflow |
| File uploads | Disk only | Streamed chunk-by-chunk, ≤128 KB heap |
| DB result buffer | 256 rows | Socket-level backpressure |
| LRU cache | `maxEntries` cap | O(1) LRU eviction |
| Rate limiter | 100K IPs · 1K timestamps/IP | Periodic stale sweep |
| Telemetry history | 1,440 samples | Ring buffer |
| WebSocket connections | `maxConnections` | Reject with 1013 |
| Connection pool | `maxConnections` | Bounded acquire queue |
| Auth buffer (wire) | 64 KB | Hard cap during auth phase |

<!-- ── VS OTHERS ──────────────────────────────────────────────────────────── -->
<div class="section-label" style="margin-top:2.5rem">Comparison</div>
<div class="section-title">General-purpose. Production-grade.</div>
<p class="section-sub">Street is comparable in scope to Express, NestJS, Spring Boot, and ASP.NET Core — with a security-first, memory-conscious design.</p>

<div class="compare-grid">
  <div class="compare-card"><div class="fw">vs Express</div><div class="advantage">TypeScript-first · memory bounds · built-in security · native PostgreSQL</div></div>
  <div class="compare-card"><div class="fw">vs Fastify</div><div class="advantage">Built-in auth · sessions · WebSocket · PostgreSQL — no plugin ecosystem needed</div></div>
  <div class="compare-card"><div class="fw">vs NestJS</div><div class="advantage">Lighter DI · no class-validator · native wire protocol · 2 deps total</div></div>
  <div class="compare-card"><div class="fw">vs Spring Boot</div><div class="advantage">Same production depth · Node.js ecosystem · faster cold start</div></div>
  <div class="compare-card"><div class="fw">vs Laravel</div><div class="advantage">Statically typed · memory-safe · no ORM overhead · native async</div></div>
  <div class="compare-card"><div class="fw">vs Django</div><div class="advantage">Async-native · TypeScript types · no GIL · horizontal scaling via clustering</div></div>
</div>

<!-- ── DOCS ──────────────────────────────────────────────────────────────── -->
<div class="section-label">Documentation</div>
<div class="section-title">Everything you need to ship.</div>

<div class="doc-grid">
  <a href="{{ site.baseurl }}/getting-started/installation/" class="doc-card">
    <div class="doc-title">🚀 Getting Started</div>
    <div class="doc-desc">Install, scaffold, configure, run in 60 seconds</div>
  </a>
  <a href="{{ site.baseurl }}/core/controllers/" class="doc-card">
    <div class="doc-title">🎮 Controllers</div>
    <div class="doc-desc">HTTP handlers, routing, context API, validation</div>
  </a>
  <a href="{{ site.baseurl }}/core/dependency-injection/" class="doc-card">
    <div class="doc-title">💉 Dependency Injection</div>
    <div class="doc-desc">IoC container, constructor injection, singletons</div>
  </a>
  <a href="{{ site.baseurl }}/database/postgres-wire-driver/" class="doc-card">
    <div class="doc-title">🐘 PostgreSQL</div>
    <div class="doc-desc">Wire driver, pool, repositories, migrations</div>
  </a>
  <a href="{{ site.baseurl }}/security/" class="doc-card">
    <div class="doc-title">🔐 Security</div>
    <div class="doc-desc">JWT, sessions, rate limiting, XSS, vault, CSRF</div>
  </a>
  <a href="{{ site.baseurl }}/realtime/websocket/" class="doc-card">
    <div class="doc-title">⚡ Real-Time</div>
    <div class="doc-desc">WebSocket server, SSE, typed events, heartbeat</div>
  </a>
  <a href="{{ site.baseurl }}/deployment/docker/" class="doc-card">
    <div class="doc-title">🐳 Deployment</div>
    <div class="doc-desc">Docker, production config, hosting guide</div>
  </a>
  <a href="{{ site.baseurl }}/examples/" class="doc-card">
    <div class="doc-title">📦 Examples</div>
    <div class="doc-desc">REST API, WebSocket chat, file upload, auth</div>
  </a>
  <a href="{{ site.baseurl }}/use-cases/" class="doc-card">
    <div class="doc-title">🌍 Use Cases</div>
    <div class="doc-desc">16 industry verticals — fintech, IoT, AI, gaming…</div>
  </a>
  <a href="{{ site.baseurl }}/cli/commands/" class="doc-card">
    <div class="doc-title">🛠️ CLI Reference</div>
    <div class="doc-desc">All street commands and options</div>
  </a>
  <a href="{{ site.baseurl }}/testing/" class="doc-card">
    <div class="doc-title">🧪 Testing</div>
    <div class="doc-desc">Integration tests, test runner, real PostgreSQL</div>
  </a>
  <a href="{{ site.baseurl }}/faq/" class="doc-card">
    <div class="doc-title">❓ FAQ</div>
    <div class="doc-desc">Common questions and answers</div>
  </a>
</div>

<!-- ── PACKAGES ──────────────────────────────────────────────────────────── -->
<div class="section-label">Packages</div>

| Package | Version | Description |
|:---|:---|:---|
| [`@streetjs/core`](https://www.npmjs.com/package/@streetjs/core) | [![npm](https://img.shields.io/npm/v/@streetjs/core?style=flat-square)](https://www.npmjs.com/package/@streetjs/core) | Framework runtime — HTTP, router, DI, database, security, WebSocket, SSE, clustering |
| [`@streetjs/cli`](https://www.npmjs.com/package/@streetjs/cli) | [![npm](https://img.shields.io/npm/v/@streetjs/cli?style=flat-square)](https://www.npmjs.com/package/@streetjs/cli) | CLI — scaffolding, code generation, dev server, migrations |

<!-- ── COMMUNITY ───────────────────────────────────────────────────────────── -->
<div class="section-label" style="margin-top:2rem">Community</div>

- [GitHub Issues](https://github.com/hassanmubiru/street/issues) — bug reports and feature requests
- [GitHub Discussions](https://github.com/hassanmubiru/street/discussions) — questions and ideas
- [Contributing Guide]({{ site.baseurl }}/contributing/) — how to contribute
- [Changelog]({{ site.baseurl }}/changelog/) — what changed in each release
