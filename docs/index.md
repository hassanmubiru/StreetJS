---
layout:      default
title:       Home
nav_order:   1
permalink:   /
description: "Street — production-grade, memory-safe TypeScript backend framework. Native PostgreSQL, JWT, WebSockets, clustering. 2 dependencies."
---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

<style>
:root{--a:#3B82F6;--a-h:#2563EB;--a-d:rgba(59,130,246,.08);--a-b:rgba(59,130,246,.14);--bg:#080C14;--s0:#0C1220;--s1:#101828;--s2:#141F30;--bd:#1C2A3E;--bd-h:rgba(59,130,246,.22);--t1:#C8D3E0;--t2:#5A6A80;--t3:#3A4A5E;--ac:#93B4D4;--cbg:rgba(59,130,246,.07);--r:10px;--rl:14px;--rx:18px;--fh:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;--fm:'JetBrains Mono','SFMono-Regular',Consolas,monospace;--tr:all .18s cubic-bezier(.4,0,.2,1);--sha:0 4px 20px rgba(59,130,246,.16);--shl:0 8px 40px rgba(0,0,0,.8);--shc:0 2px 8px rgba(0,0,0,.6)}
.sp *{box-sizing:border-box}.sp{font-family:var(--fh);color:var(--t1);line-height:1.6}
.gt{background:linear-gradient(135deg,#C8D3E0 0%,#8BA3C0 60%,#60A5FA 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.ey{display:inline-flex;align-items:center;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--a);background:var(--a-d);border:1px solid var(--a-b);border-radius:100px;padding:.25rem .8rem;margin-bottom:.7rem}
.sh2{font-family:var(--fh);font-size:clamp(1.4rem,3.5vw,1.9rem);font-weight:700;letter-spacing:-.025em;line-height:1.2;color:var(--t1);margin:0 0 .55rem}
.ssub{font-size:.9rem;color:var(--t2);line-height:1.7;margin:0 0 2.25rem;max-width:540px}
.sec{margin-bottom:5.5rem}
</style>

<style>
.hero{position:relative;text-align:center;padding:5.5rem 1.5rem 4.5rem;background:var(--bg);border:1px solid var(--bd);border-radius:var(--rx);margin-bottom:0;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background-image:radial-gradient(circle,rgba(59,130,246,.07) 1px,transparent 1px);background-size:30px 30px;mask-image:radial-gradient(ellipse 75% 65% at 50% 50%,black 20%,transparent 100%);-webkit-mask-image:radial-gradient(ellipse 75% 65% at 50% 50%,black 20%,transparent 100%);pointer-events:none}
.hero::after{content:'';position:absolute;top:-150px;left:50%;transform:translateX(-50%);width:700px;height:500px;background:radial-gradient(ellipse,rgba(59,130,246,.07) 0%,transparent 60%);pointer-events:none;animation:hg 12s ease-in-out infinite alternate}
@keyframes hg{0%{opacity:.7;transform:translateX(-50%) scale(1)}100%{opacity:1;transform:translateX(-50%) scale(1.05)}}
.hero-in{position:relative;z-index:1}
.pill{display:inline-flex;align-items:center;gap:.45rem;background:var(--a-d);border:1px solid var(--a-b);border-radius:100px;padding:.28rem .9rem;font-size:.72rem;font-weight:600;color:var(--ac);letter-spacing:.05em;text-transform:uppercase;margin-bottom:1.75rem}
.pill .dot{width:6px;height:6px;border-radius:50%;background:var(--a);opacity:.8;animation:bk 3s ease-in-out infinite}
@keyframes bk{0%,100%{opacity:.8}50%{opacity:.3}}
.hero h1{font-family:var(--fh);font-size:clamp(2.4rem,6.5vw,4.4rem);font-weight:800;letter-spacing:-.045em;line-height:1.06;margin:0 0 1.4rem}
.hero-sub{font-size:clamp(.95rem,2.2vw,1.1rem);color:var(--t2);line-height:1.75;max-width:520px;margin:0 auto .7rem}
.hero-nd{font-family:var(--fm);font-size:.78rem;color:var(--t3);letter-spacing:.03em;margin-bottom:2.25rem}
.hero-nd span{color:var(--ac)}
.btns{display:flex;gap:.65rem;justify-content:center;flex-wrap:wrap;margin-bottom:2.25rem}
.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.68rem 1.45rem;border-radius:var(--r);font-size:.9rem;font-weight:600;text-decoration:none!important;transition:var(--tr);white-space:nowrap}
.btn-p{background:var(--a);color:#fff!important;border:1px solid rgba(255,255,255,.08);box-shadow:var(--sha)}
.btn-p:hover{background:var(--a-h);transform:translateY(-2px);box-shadow:0 6px 24px rgba(59,130,246,.28)}
.btn-g{background:rgba(255,255,255,.03);color:var(--t1)!important;border:1px solid var(--bd)}
.btn-g:hover{background:rgba(255,255,255,.06);border-color:var(--bd-h);transform:translateY(-2px);color:var(--ac)!important}
.badges{display:flex;gap:.35rem;justify-content:center;flex-wrap:wrap}
</style>

<style>
.term{background:#060A12;border:1px solid var(--bd);border-radius:var(--rl);overflow:hidden;box-shadow:var(--shl);margin:2.25rem 0}
.term-bar{background:#0A1020;border-bottom:1px solid var(--bd);padding:.6rem 1.1rem;display:flex;align-items:center;gap:.4rem}
.term-bar .d{width:11px;height:11px;border-radius:50%;background:var(--bd);flex-shrink:0}
.term-bar .ti{font-family:var(--fm);font-size:.72rem;color:var(--t3);margin-left:.5rem;flex:1;text-align:center}
.term-body{padding:1.3rem 1.5rem;font-family:var(--fm);font-size:.86rem;line-height:2.1}
.term-body .p{color:var(--a);user-select:none}.term-body .c{color:var(--t1)}.term-body .cm{color:var(--t3)}.term-body .ok{color:var(--ac)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1px;background:var(--bd);border:1px solid var(--bd);border-radius:var(--rl);overflow:hidden;margin:2.25rem 0}
.stat{background:var(--s0);padding:1.3rem 1rem;text-align:center;transition:var(--tr)}.stat:hover{background:var(--s1)}
.stat .sv{font-family:var(--fm);font-size:1.35rem;font-weight:700;color:var(--ac);line-height:1;margin-bottom:.3rem;display:block}
.stat .sl{font-size:.72rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em}
</style>

<style>
.feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:.9rem}
.feat{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rl);padding:1.5rem;transition:var(--tr)}
.feat:hover{border-color:var(--bd-h);background:var(--s2);transform:translateY(-2px);box-shadow:var(--shc)}
.feat .fi{font-size:1.6rem;margin-bottom:.8rem;display:block;line-height:1;filter:grayscale(.3) brightness(.85)}
.feat h3{font-size:.95rem;font-weight:700;color:var(--t1);margin:0 0 .45rem;letter-spacing:-.01em}
.feat p{font-size:.84rem;color:var(--t2);margin:0;line-height:1.65}
.feat code{font-family:var(--fm);font-size:.78rem;background:var(--cbg);color:var(--ac);padding:.1em .35em;border-radius:4px}
.cwin{background:#060A12;border:1px solid var(--bd);border-radius:var(--rl);overflow:hidden;box-shadow:var(--shl),0 0 40px rgba(59,130,246,.05)}
.cwin-bar{background:#0A1020;border-bottom:1px solid var(--bd);padding:.65rem 1.2rem;display:flex;align-items:center;gap:.4rem}
.cwin-bar .d{width:11px;height:11px;border-radius:50%;background:var(--bd);flex-shrink:0}
.cwin-bar .fn{font-family:var(--fm);font-size:.73rem;color:var(--t3);margin-left:.5rem}
.cwin-bar .lb{margin-left:auto;font-size:.67rem;font-weight:600;background:var(--a-d);color:var(--ac);padding:.14rem .5rem;border-radius:4px;border:1px solid var(--a-b);text-transform:uppercase;letter-spacing:.07em}
.cwin div.highlighter-rouge,.cwin figure.highlight{margin:0!important;border:none!important;border-radius:0!important;box-shadow:none!important}
.cwin pre.highlight{border-radius:0 0 var(--rl) var(--rl)!important;margin:0!important;border:none!important}
</style>

<style>
.docs{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:.7rem}
.dc{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rl);padding:1.05rem 1.2rem;text-decoration:none!important;display:block;transition:var(--tr);position:relative;overflow:hidden}
.dc::after{content:'›';position:absolute;right:1rem;top:50%;transform:translateY(-50%) translateX(5px);color:var(--a);font-size:1.1rem;opacity:0;transition:var(--tr)}
.dc:hover{border-color:var(--bd-h);background:var(--s2);transform:translateY(-2px);box-shadow:var(--sha);text-decoration:none!important}
.dc:hover::after{opacity:1;transform:translateY(-50%) translateX(0)}
.dc .di{font-size:1.25rem;margin-bottom:.4rem;display:block;line-height:1;filter:grayscale(.3) brightness(.8)}
.dc .dt{font-size:.86rem;font-weight:700;color:var(--ac);margin-bottom:.25rem;display:block}
.dc:hover .dt{color:var(--t1)}
.dc .dd{font-size:.77rem;color:var(--t2);line-height:1.5}
.cta{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rx);padding:3.25rem 2rem;text-align:center;position:relative;overflow:hidden}
.cta::before{content:'';position:absolute;inset:0;background-image:radial-gradient(circle,rgba(59,130,246,.05) 1px,transparent 1px);background-size:26px 26px;mask-image:radial-gradient(ellipse 65% 65% at 50% 50%,black 10%,transparent 100%);-webkit-mask-image:radial-gradient(ellipse 65% 65% at 50% 50%,black 10%,transparent 100%);pointer-events:none}
.cta h2{font-family:var(--fh);font-size:clamp(1.5rem,3.5vw,2.1rem);font-weight:700;letter-spacing:-.025em;line-height:1.2;margin:0 0 .7rem;position:relative;z-index:1}
.cta p{font-size:.9rem;color:var(--t2);max-width:440px;margin:0 auto 1.75rem;line-height:1.7;position:relative;z-index:1}
.cta-links{display:flex;gap:.65rem;justify-content:center;flex-wrap:wrap;position:relative;z-index:1}
.cl{display:inline-flex;align-items:center;gap:.4rem;padding:.58rem 1.1rem;background:var(--s0);border:1px solid var(--bd);border-radius:var(--r);font-size:.84rem;font-weight:600;color:var(--t1)!important;text-decoration:none!important;transition:var(--tr)}
.cl:hover{border-color:var(--bd-h);background:var(--a-d);transform:translateY(-2px);color:var(--ac)!important}
@media(max-width:640px){.hero{padding:4rem 1rem 3.5rem}.hero h1{font-size:2.1rem}.stats{grid-template-columns:repeat(2,1fr)}.cta{padding:2.5rem 1.25rem}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>

<div class="sp">

<div class="hero"><div class="hero-in">
  <div class="pill"><span class="dot"></span>v1.0.5 &nbsp;·&nbsp; MIT &nbsp;·&nbsp; Node 20+ &nbsp;·&nbsp; TypeScript 5</div>
  <h1><span class="gt">Build TypeScript Backends<br>Without the Bloat</span></h1>
  <p class="hero-sub">Production-grade. Memory-safe. Native Node.js.<br>Every feature built from core modules — no Express, no pg, no Prisma.</p>
  <p class="hero-nd"><span>No Express</span> &nbsp;·&nbsp; <span>No pg</span> &nbsp;·&nbsp; <span>No Prisma</span> &nbsp;·&nbsp; <span>No jsonwebtoken</span> &nbsp;·&nbsp; <span>No bcrypt</span> &nbsp;·&nbsp; <span>No multer</span></p>
  <div class="btns">
    <a href="{{ site.baseurl }}/getting-started/installation/" class="btn btn-p">Get Started →</a>
    <a href="https://github.com/hassanmubiru/street" class="btn btn-g" target="_blank" rel="noopener">GitHub ↗</a>
    <a href="{{ site.baseurl }}/examples/" class="btn btn-g">Examples</a>
  </div>
  <div class="badges">
    <img src="https://img.shields.io/npm/v/streetjs?label=%40streetjs%2Fcore&color=3B82F6&style=flat-square" alt="core">
    <img src="https://img.shields.io/npm/v/@streetjs/cli?label=%40streetjs%2Fcli&color=3B82F6&style=flat-square" alt="cli">
    <img src="https://img.shields.io/badge/node-%3E%3D20-3B82F6?style=flat-square" alt="Node 20+">
    <img src="https://img.shields.io/badge/TypeScript-5.0%2B-3B82F6?style=flat-square" alt="TypeScript 5+">
    <img src="https://img.shields.io/badge/deps-2-3B82F6?style=flat-square" alt="2 deps">
    <img src="https://img.shields.io/badge/license-MIT-475569?style=flat-square" alt="MIT">
    <img src="https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg" alt="CI">
  </div>
</div></div>

<div class="term">
  <div class="term-bar"><div class="d"></div><div class="d"></div><div class="d"></div><span class="ti">bash — Quick Start</span></div>
  <div class="term-body">
    <div><span class="p">$</span> <span class="c">npm install -g @streetjs/cli</span></div>
    <div><span class="cm"># installs the street CLI globally</span></div>
    <div><span class="p">$</span> <span class="c">street create my-api</span></div>
    <div><span class="cm"># scaffolds TypeScript project with PostgreSQL, JWT, Docker</span></div>
    <div><span class="p">$</span> <span class="c">cd my-api &amp;&amp; npm install &amp;&amp; street dev</span></div>
    <div><span class="ok">[street] Listening on http://0.0.0.0:3000 · Node 20 · ESM · OpenAPI at /openapi.json</span></div>
  </div>
</div>

<div class="stats">
  <div class="stat"><span class="sv">2</span><span class="sl">Runtime Deps</span></div>
  <div class="stat"><span class="sv">PG v3</span><span class="sl">Wire Protocol</span></div>
  <div class="stat"><span class="sv">AES-256</span><span class="sl">Session Crypto</span></div>
  <div class="stat"><span class="sv">MIT</span><span class="sl">Open Source</span></div>
</div>

<div class="sec">
  <div class="ey">Core Capabilities</div>
  <div class="sh2">Everything you need. Nothing you don't.</div>
  <p class="ssub">Every feature is implemented directly from Node.js core modules with explicit memory bounds.</p>
  <div class="feats">
    <div class="feat"><span class="fi">🔷</span><h3>TypeScript First</h3><p>Strict mode, NodeNext ESM, decorator metadata, full type inference. Zero <code>any</code> in the framework source.</p></div>
    <div class="feat"><span class="fi">🛡️</span><h3>Memory-Safe by Design</h3><p>Bounded body limits, connection pools, ring-buffer telemetry, LRU eviction, WebSocket caps. Every component has an explicit ceiling.</p></div>
    <div class="feat"><span class="fi">🐘</span><h3>Native PostgreSQL Driver</h3><p>Wire protocol v3 over <code>node:net</code>. SCRAM-SHA-256 auth. Streaming rows with socket-level backpressure. No <code>pg</code>.</p></div>
    <div class="feat"><span class="fi">💉</span><h3>Dependency Injection</h3><p>IoC container with constructor injection, singleton registry, and circular dependency detection via <code>reflect-metadata</code>.</p></div>
    <div class="feat"><span class="fi">🔐</span><h3>Security Built-in</h3><p>JWT, AES-256-GCM sessions, scrypt vault, sliding-window rate limiter, XSS sanitizer, CSRF, CORS, CSP — all included.</p></div>
    <div class="feat"><span class="fi">⚡</span><h3>Real-Time Ready</h3><p>Bounded WebSocket server with heartbeat, typed event emitter, and SSE with keep-alive. Auth hook on upgrade.</p></div>
    <div class="feat"><span class="fi">📋</span><h3>OpenAPI 3.1 Auto-gen</h3><p>Spec generated from <code>@ApiOperation</code> decorators. Always in sync. Served at <code>/openapi.json</code>.</p></div>
    <div class="feat"><span class="fi">🔄</span><h3>Clustering &amp; Telemetry</h3><p><code>node:cluster</code> coordinator with IPC heartbeat, auto-restart, graceful shutdown, and P50/P99 latency tracking.</p></div>
    <div class="feat"><span class="fi">🚀</span><h3>CLI Tooling</h3><p><code>street create</code>, <code>street dev</code>, <code>street generate</code>, <code>street migrate:create</code> — full lifecycle from one binary.</p></div>
  </div>
</div>

</div>

<!-- CODE EXAMPLE -->
<div class="sp sec">
  <div class="ey">Quick Example</div>
  <div class="sh2">A complete production API. One file. No extra packages.</div>
  <p class="ssub">PostgreSQL, JWT auth, rate limiting, and auto-generated OpenAPI — all from <code style="font-family:var(--fm);font-size:.82em;background:var(--cbg);color:var(--ac);padding:.1em .4em;border-radius:4px">streetjs</code>.</p>
  <div class="cwin">
    <div class="cwin-bar"><div class="d"></div><div class="d"></div><div class="d"></div><span class="fn">src/main.ts</span><span class="lb">TypeScript</span></div>
</div>

```typescript
import 'reflect-metadata';
import {
  streetApp, Injectable, Controller, Get, Post,
  PgPool, securityHeaders, corsMiddleware,
  RateLimiter, authMiddleware, JwtService, ApiOperation,
} from 'streetjs';
import type { StreetContext } from 'streetjs';

@Injectable()
class ItemService {
  constructor(private readonly pool: PgPool) {}
  async findAll() {
    const { rows } = await this.pool.query(
      'SELECT id, name, created_at FROM items ORDER BY created_at DESC'
    );
    return rows;
  }
  async create(name: string) {
    const { rows } = await this.pool.query(
      'INSERT INTO items (name) VALUES ($1) RETURNING *', [name]
    );
    return rows[0];
  }
}

@Controller('/api/items')
class ItemController {
  constructor(private readonly svc: ItemService) {}

  @Get('/')
  @ApiOperation({ summary: 'List items', tags: ['items'] })
  async list(ctx: StreetContext): Promise<void> {
    ctx.json({ items: await this.svc.findAll() });
  }

  @Post('/')
  @ApiOperation({ summary: 'Create item', tags: ['items'] })
  async create(ctx: StreetContext): Promise<void> {
    const { name } = ctx.body as { name: string };
    ctx.json(await this.svc.create(name), 201);
  }
}

const jwt     = new JwtService(process.env.JWT_SECRET!);
const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 100 });
const app     = streetApp({ port: 3000 });

app.use(securityHeaders);
app.use(corsMiddleware(['https://app.example.com']));
app.use(limiter.middleware());
app.use(authMiddleware(jwt));
app.registerController(ItemController);

await app.listen();
// [street] Listening on http://0.0.0.0:3000
// [street] OpenAPI → http://0.0.0.0:3000/openapi.json
```

<div class="sp sec">
  <div class="ey">Documentation</div>
  <div class="sh2">Everything you need to ship.</div>
  <p class="ssub">Comprehensive guides, API references, and real-world examples for every part of the framework.</p>
  <div class="docs">
    <a href="{{ site.baseurl }}/getting-started/installation/" class="dc"><span class="di">🚀</span><span class="dt">Getting Started</span><span class="dd">Install, scaffold, configure, and run in 60 seconds</span></a>
    <a href="{{ site.baseurl }}/core/controllers/" class="dc"><span class="di">🎮</span><span class="dt">Controllers</span><span class="dd">HTTP handlers, routing, context API, validation</span></a>
    <a href="{{ site.baseurl }}/core/dependency-injection/" class="dc"><span class="di">💉</span><span class="dt">Dependency Injection</span><span class="dd">IoC container, constructor injection, singletons</span></a>
    <a href="{{ site.baseurl }}/database/postgres-wire-driver/" class="dc"><span class="di">🐘</span><span class="dt">PostgreSQL</span><span class="dd">Wire driver, connection pool, repositories, migrations</span></a>
    <a href="{{ site.baseurl }}/security/" class="dc"><span class="di">🔐</span><span class="dt">Security</span><span class="dd">JWT, sessions, rate limiting, XSS, vault, CSRF</span></a>
    <a href="{{ site.baseurl }}/realtime/websocket/" class="dc"><span class="di">⚡</span><span class="dt">Real-Time</span><span class="dd">WebSocket server, SSE, typed events, heartbeat</span></a>
    <a href="{{ site.baseurl }}/deployment/docker/" class="dc"><span class="di">🐳</span><span class="dt">Deployment</span><span class="dd">Docker, production config, environment variables</span></a>
    <a href="{{ site.baseurl }}/examples/" class="dc"><span class="di">📦</span><span class="dt">Examples</span><span class="dd">REST API, WebSocket chat, file upload, auth flow</span></a>
    <a href="{{ site.baseurl }}/use-cases/" class="dc"><span class="di">🌍</span><span class="dt">Use Cases</span><span class="dd">16 industry verticals — fintech, IoT, AI, gaming</span></a>
    <a href="{{ site.baseurl }}/cli/commands/" class="dc"><span class="di">🛠️</span><span class="dt">CLI Reference</span><span class="dd">All street commands, flags, and options</span></a>
    <a href="{{ site.baseurl }}/testing/" class="dc"><span class="di">🧪</span><span class="dt">Testing</span><span class="dd">Integration tests, test runner, real PostgreSQL</span></a>
    <a href="{{ site.baseurl }}/faq/" class="dc"><span class="di">❓</span><span class="dt">FAQ</span><span class="dd">Common questions, migration guides, troubleshooting</span></a>
  </div>
</div>

<div class="sp">
<div class="cta">
  <h2><span class="gt">Built in the open. Improved together.</span></h2>
  <p>Street is MIT-licensed and actively developed. Bug reports, feature requests, and contributions are welcome.</p>
  <div class="cta-links">
    <a href="https://github.com/hassanmubiru/street" class="cl" target="_blank" rel="noopener">⭐ Star on GitHub</a>
    <a href="https://github.com/hassanmubiru/street/issues" class="cl" target="_blank" rel="noopener">🐛 Issues</a>
    <a href="https://github.com/hassanmubiru/street/discussions" class="cl" target="_blank" rel="noopener">💬 Discussions</a>
    <a href="{{ site.baseurl }}/contributing/" class="cl">🤝 Contribute</a>
    <a href="{{ site.baseurl }}/changelog/" class="cl">📋 Changelog</a>
    <a href="{{ site.baseurl }}/roadmap/" class="cl">🗺️ Roadmap</a>
  </div>
</div>
</div>
