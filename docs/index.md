---
layout:      default
# SEO: the homepage <title> is the single most valuable ranking signal, so it
# leads with the primary keyword instead of "Home". The header logo links home,
# so the page is excluded from the sidebar nav to avoid a long, redundant label.
title:       "TypeScript Backend Framework"
nav_exclude: true
permalink:   /
description: "StreetJS — production-grade, memory-safe TypeScript backend framework. Native PostgreSQL, JWT, WebSockets, clustering. 2 dependencies."
---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">

<style>
/* ── Let the landing page break out of the narrow docs column ───────────── */
#main-content:has(.home){max-width:1080px!important}
@media(min-width:1500px){#main-content:has(.home){max-width:1180px!important}}

/* ── Tokens — mapped to the global light/dark design system ──────────────── */
.home{
  --ink:var(--text-primary);--body:var(--text-secondary);--muted:var(--text-muted);--faint:var(--text-muted);
  --a:var(--accent);--a2:var(--accent);--a-hover:var(--accent-hover);--a-soft:var(--accent-soft);--a-line:var(--accent-line);
  --bd:var(--border);--bd2:var(--border-strong);--card:var(--elevated);
  --code:var(--code-bg);--code-line:var(--code-border);
  --fh:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --fm:'JetBrains Mono','SFMono-Regular',Consolas,monospace;
  --tr:.18s cubic-bezier(.4,0,.2,1);--rs:9px;--rm:12px;--rl:16px;--rx:22px;
  font-family:var(--fh);color:var(--body);line-height:1.6}
.home *{box-sizing:border-box}
.home svg{display:block}

/* ── Section scaffolding ────────────────────────────────────────────────── */
.home .sec{margin:0 0 6rem}
/* Tinted panel to break up the white and add depth */
.home .band{position:relative;padding:3.25rem 2.75rem;border:1px solid var(--bd);border-radius:24px;
  background:linear-gradient(180deg,var(--surface) 0%,var(--canvas) 100%);overflow:hidden}
.home .band::before{content:'';position:absolute;inset:0;
  background-image:radial-gradient(circle at 1px 1px,rgba(37,99,235,.10) 1px,transparent 0);
  background-size:28px 28px;
  -webkit-mask-image:radial-gradient(ellipse 60% 70% at 85% 0%,#000,transparent 70%);
  mask-image:radial-gradient(ellipse 60% 70% at 85% 0%,#000,transparent 70%);
  opacity:.7;pointer-events:none}
.home .band>*{position:relative;z-index:1}
@media(max-width:640px){.home .band{padding:2rem 1.25rem;border-radius:18px}}
.home .eyebrow{display:inline-flex;align-items:center;gap:.55rem;font-size:.72rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.14em;color:var(--a);margin-bottom:.85rem}
.home .eyebrow::before{content:'';width:20px;height:2px;border-radius:2px;background:var(--a)}
.home .s-title{font-size:clamp(1.6rem,3.2vw,2.1rem);font-weight:800;letter-spacing:-.03em;
  line-height:1.18;color:var(--ink);margin:0 0 .6rem}
.home .s-sub{font-size:1.02rem;color:var(--muted);line-height:1.7;margin:0 0 2.5rem;max-width:620px}
.home code{font-family:var(--fm);font-size:.84em;background:var(--a-soft);color:#1D4ED8;
  padding:.12em .42em;border-radius:5px;border:1px solid var(--a-line)}

/* ── Hero ───────────────────────────────────────────────────────────────── */
.home .hero{position:relative;text-align:center;padding:5.5rem 1.5rem 4.75rem;overflow:hidden;
  border:1px solid var(--bd);border-radius:var(--rx);
  background:radial-gradient(ellipse 75% 75% at 50% -5%,var(--a-soft),var(--bg) 65%)}
.home .hero::before{content:'';position:absolute;inset:0;
  background-image:linear-gradient(var(--bd) 1px,transparent 1px),linear-gradient(90deg,var(--bd) 1px,transparent 1px);
  background-size:52px 52px;opacity:.6;
  -webkit-mask-image:radial-gradient(ellipse 70% 55% at 50% 30%,#000 5%,transparent 72%);
  mask-image:radial-gradient(ellipse 70% 55% at 50% 30%,#000 5%,transparent 72%);pointer-events:none}
.home .hero-in{position:relative;z-index:1;max-width:760px;margin:0 auto}
.home .tag{display:inline-flex;align-items:center;gap:.55rem;background:var(--card);
  border:1px solid var(--a-line);border-radius:100px;padding:.36rem .9rem;font-size:.75rem;
  font-weight:600;color:var(--a-hover);letter-spacing:.01em;margin-bottom:1.9rem;
  box-shadow:0 1px 3px rgba(37,99,235,.08)}
.home .tag .dot{width:7px;height:7px;border-radius:50%;background:var(--a);
  box-shadow:0 0 0 3px rgba(37,99,235,.18);animation:pulse 2.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.home .hero h1{font-size:clamp(2.5rem,6vw,4.1rem);font-weight:800;letter-spacing:-.045em;
  line-height:1.05;margin:0 0 1.5rem;color:var(--ink)}
.home .grad{background:linear-gradient(115deg,var(--text-primary) 0%,var(--accent) 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.home .hero-sub{font-size:clamp(1.02rem,2vw,1.2rem);color:var(--muted);line-height:1.7;
  max-width:580px;margin:0 auto 1.6rem}
.home .nots{display:flex;flex-wrap:wrap;gap:.45rem;justify-content:center;margin-bottom:2.4rem}
.home .not{font-family:var(--fm);font-size:.76rem;color:var(--muted);font-weight:500;
  border:1px solid var(--bd);border-radius:7px;padding:.26rem .65rem;background:var(--card)}
.home .not s{color:#EF4444;text-decoration:none;margin-right:.25rem;font-weight:700}

/* ── Buttons ────────────────────────────────────────────────────────────── */
.home .btns{display:flex;gap:.7rem;justify-content:center;flex-wrap:wrap;margin-bottom:2.6rem}
.home .btn{display:inline-flex;align-items:center;gap:.5rem;padding:.74rem 1.5rem;border-radius:var(--rs);
  font-size:.94rem;font-weight:600;text-decoration:none!important;transition:var(--tr);white-space:nowrap;border:1px solid transparent}
.home .btn svg{width:16px;height:16px}
.home .btn-p{background:var(--a);color:#fff!important;border-color:var(--a);
  box-shadow:0 6px 18px -5px rgba(37,99,235,.5)}
.home .btn-p:hover{background:var(--a-hover);border-color:var(--a-hover);transform:translateY(-2px);box-shadow:0 10px 26px -6px rgba(37,99,235,.55)}
.home .btn-g{background:var(--card);color:var(--ink)!important;border-color:var(--bd)}
.home .btn-g:hover{border-color:var(--bd2);background:var(--surface);transform:translateY(-2px);color:var(--a)!important}
.home .badges{display:flex;gap:.4rem;justify-content:center;flex-wrap:wrap}
.home .badges img{height:20px}

/* ── Window chrome (terminal + code) ────────────────────────────────────── */
.home .win{background:var(--code);border:1px solid var(--code-line);border-radius:var(--rm);overflow:hidden;
  box-shadow:0 24px 50px -24px rgba(15,23,42,.45)}
.home .win-bar{background:var(--code-header);border-bottom:1px solid var(--code-line);padding:.7rem 1.1rem;
  display:flex;align-items:center;gap:.45rem}
.home .win-bar .d{width:11px;height:11px;border-radius:50%}
.home .win-bar .d.r{background:#FF5F57}.home .win-bar .d.y{background:#FEBC2E}.home .win-bar .d.g{background:#28C840}
.home .win-bar .fn{font-family:var(--fm);font-size:.74rem;color:var(--muted);margin-left:.6rem}
.home .win-bar .lb{margin-left:auto;font-size:.66rem;font-weight:600;background:var(--a-soft);color:var(--a);
  padding:.16rem .55rem;border-radius:5px;text-transform:uppercase;letter-spacing:.08em}
.home .term{margin:0 0 5rem}
.home .term-body{padding:1.4rem 1.6rem;font-family:var(--fm);font-size:.875rem;line-height:2.05}
.home .term-body .p{color:var(--accent);user-select:none;margin-right:.3rem}
.home .term-body .c{color:var(--code-text)}.home .term-body .cm{color:var(--syn-comment)}.home .term-body .ok{color:var(--syn-string)}

/* ── Stats ──────────────────────────────────────────────────────────────── */
.home .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;
  background:var(--bd);border:1px solid var(--bd);border-radius:var(--rm);overflow:hidden;margin:0 0 5rem;
  box-shadow:0 1px 3px rgba(15,23,42,.06),0 10px 30px -18px rgba(37,99,235,.25)}
.home .stat{background:var(--surface);padding:1.6rem 1rem;text-align:center;transition:var(--tr)}
.home .stat:hover{background:var(--a-soft)}
.home .stat .v{font-family:var(--fm);font-size:1.45rem;font-weight:700;color:var(--ink);line-height:1;margin-bottom:.5rem;display:block}
.home .stat .v .u{color:var(--a)}
.home .stat .l{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.09em;font-weight:600}

/* ── Feature grid ───────────────────────────────────────────────────────── */
.home .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}
.home .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--rl);
  padding:1.7rem;transition:var(--tr);box-shadow:0 1px 2px rgba(15,23,42,.04)}
.home .card:hover{border-color:var(--a-line);transform:translateY(-3px);box-shadow:0 18px 36px -18px rgba(37,99,235,.35)}
.home .ic{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  background:var(--a-soft);border:1px solid var(--a-line);color:var(--a);margin-bottom:1.15rem}
.home .ic svg{width:22px;height:22px}
.home .card h3{font-size:1.02rem;font-weight:700;color:var(--ink);margin:0 0 .5rem;letter-spacing:-.01em}
.home .card p{font-size:.9rem;color:var(--muted);margin:0;line-height:1.65}

/* ── Code window (fixed: code renders INSIDE the frame) ──────────────────── */
.home .codewin{margin:0 0 5rem}
.home .codewin figure.highlight,.home .codewin div.highlighter-rouge{margin:0!important;border:none!important;
  border-radius:0!important;box-shadow:none!important;background:var(--code)!important}
.home .codewin pre.highlight{margin:0!important;border:none!important;border-radius:0!important;
  box-shadow:none!important;padding:1.5rem 1.7rem!important;background:var(--code)!important;
  max-height:none!important;overflow-x:auto!important}

/* ── Doc cards ──────────────────────────────────────────────────────────── */
.home .dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:.85rem}
.home .dc{background:var(--card);border:1px solid var(--bd);border-radius:var(--rl);padding:1.35rem;
  text-decoration:none!important;display:flex;gap:.95rem;align-items:flex-start;transition:var(--tr);box-shadow:0 1px 2px rgba(15,23,42,.04)}
.home .dc:hover{border-color:var(--a-line);transform:translateY(-3px);box-shadow:0 18px 36px -18px rgba(37,99,235,.35)}
.home .dc .dic{flex-shrink:0;width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;
  background:var(--a-soft);border:1px solid var(--a-line);color:var(--a);transition:var(--tr)}
.home .dc .dic svg{width:19px;height:19px}
.home .dc:hover .dic{background:var(--a);border-color:var(--a);color:#fff}
.home .dc .dt{font-size:.94rem;font-weight:700;color:var(--ink);margin:0 0 .25rem;display:flex;align-items:center;gap:.35rem}
.home .dc .dt .arr{opacity:0;transform:translateX(-4px);transition:var(--tr);color:var(--a)}
.home .dc:hover .dt .arr{opacity:1;transform:translateX(0)}
.home .dc .dd{font-size:.83rem;color:var(--muted);line-height:1.55;margin:0}

/* ── CTA ────────────────────────────────────────────────────────────────── */
.home .cta{position:relative;text-align:center;padding:4rem 2rem;overflow:hidden;
  border:1px solid var(--bd);border-radius:var(--rx);
  background:radial-gradient(ellipse 70% 100% at 50% 0%,var(--a-soft),var(--bg) 70%)}
.home .cta::before{content:'';position:absolute;inset:0;
  background-image:radial-gradient(circle at 1px 1px,rgba(37,99,235,.12) 1px,transparent 0);
  background-size:28px 28px;
  -webkit-mask-image:radial-gradient(ellipse 70% 80% at 50% 0%,#000,transparent 72%);
  mask-image:radial-gradient(ellipse 70% 80% at 50% 0%,#000,transparent 72%);
  opacity:.7;pointer-events:none}
.home .cta>*{position:relative;z-index:1}
.home .cta h2{font-size:clamp(1.6rem,3.4vw,2.2rem);font-weight:800;letter-spacing:-.03em;margin:0 0 .7rem;color:var(--ink)}
.home .cta p{font-size:1.02rem;color:var(--muted);max-width:500px;margin:0 auto 2rem;line-height:1.7}
.home .cta-links{display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap}
.home .cl{display:inline-flex;align-items:center;gap:.45rem;padding:.64rem 1.2rem;background:var(--card);
  border:1px solid var(--bd);border-radius:var(--rs);font-size:.87rem;font-weight:600;
  color:var(--ink)!important;text-decoration:none!important;transition:var(--tr)}
.home .cl svg{width:15px;height:15px}
.home .cl:hover{border-color:var(--a-line);background:var(--a-soft);transform:translateY(-2px);color:var(--a)!important}

@media(max-width:640px){
  .home .hero{padding:4rem 1.1rem 3.5rem}
  .home .sec{margin-bottom:4rem}
  .home .stats{grid-template-columns:repeat(2,1fr)}
  .home .cta{padding:2.75rem 1.25rem}
}
@media(prefers-reduced-motion:reduce){.home *,.home *::before,.home *::after{animation:none!important;transition:none!important}}
</style>

<div class="home" markdown="0">

<!-- ════════════════════════ HERO ════════════════════════ -->
<section class="hero">
  <div class="hero-in">
    <span class="tag"><span class="dot"></span>v1.0.16 · MIT · Node 20+ · TypeScript 5</span>
    <h1><span class="grad">TypeScript backends,<br>without the bloat</span></h1>
    <p class="hero-sub">Production-grade and memory-safe, built straight from Node.js core. Every feature implemented in-house — no Express, no pg, no Prisma.</p>
    <div class="nots">
      <span class="not"><s>✕</s>Express</span>
      <span class="not"><s>✕</s>pg</span>
      <span class="not"><s>✕</s>Prisma</span>
      <span class="not"><s>✕</s>jsonwebtoken</span>
      <span class="not"><s>✕</s>bcrypt</span>
      <span class="not"><s>✕</s>multer</span>
    </div>
    <div class="btns">
      <a href="{{ site.baseurl }}/getting-started/installation/" class="btn btn-p">Get started
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      <a href="https://github.com/hassanmubiru/StreetJS" class="btn btn-g" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.16.58.67.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z"/></svg>GitHub</a>
      <a href="{{ site.baseurl }}/examples/" class="btn btn-g">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>Examples</a>
    </div>
    <div class="badges">
      <img src="https://img.shields.io/npm/v/streetjs?label=streetjs&color=2563EB&style=flat-square" alt="streetjs version" loading="lazy">
      <img src="https://img.shields.io/npm/v/@streetjs/cli?label=%40streetjs%2Fcli&color=2563EB&style=flat-square" alt="cli version" loading="lazy">
      <img src="https://img.shields.io/badge/deps-2-2563EB?style=flat-square" alt="2 dependencies">
      <img src="https://img.shields.io/badge/license-MIT-64748B?style=flat-square" alt="MIT">
    </div>
  </div>
</section>

<!-- ════════════════════════ TERMINAL ════════════════════════ -->
<div class="win term">
  <div class="win-bar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="fn">bash — quick start</span></div>
  <div class="term-body">
    <div><span class="p">$</span><span class="c">npm install -g @streetjs/cli</span></div>
    <div><span class="cm"># installs the street CLI globally</span></div>
    <div><span class="p">$</span><span class="c">street create my-api</span></div>
    <div><span class="cm"># scaffolds a TypeScript project with PostgreSQL, JWT &amp; Docker</span></div>
    <div><span class="p">$</span><span class="c">cd my-api &amp;&amp; npm install &amp;&amp; street dev</span></div>
    <div><span class="ok">[street] Listening on http://0.0.0.0:3000 · Node 20 · ESM · OpenAPI at /openapi.json</span></div>
  </div>
</div>

<!-- ════════════════════════ STATS ════════════════════════ -->
<div class="stats">
  <div class="stat"><span class="v">2</span><span class="l">Runtime deps</span></div>
  <div class="stat"><span class="v">PG&nbsp;<span class="u">v3</span></span><span class="l">Wire protocol</span></div>
  <div class="stat"><span class="v">AES&#8209;<span class="u">256</span></span><span class="l">Session crypto</span></div>
  <div class="stat"><span class="v">100<span class="u">%</span></span><span class="l">TypeScript</span></div>
</div>

<!-- ════════════════════════ FEATURES ════════════════════════ -->
<section class="sec band">
  <span class="eyebrow">Core capabilities</span>
  <h2 class="s-title">Everything you need. Nothing you don't.</h2>
  <p class="s-sub">Every feature is implemented directly from Node.js core modules, with explicit memory bounds on every component.</p>
  <div class="grid">

    <div class="card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg></div>
      <h3>TypeScript first</h3>
      <p>Strict mode, NodeNext ESM, decorator metadata, and full type inference. Zero <code>any</code> in the framework source.</p>
    </div>

    <div class="card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></div>
      <h3>Memory-safe by design</h3>
      <p>Bounded body limits, connection pools, ring-buffer telemetry, LRU eviction and WebSocket caps. Every component has a ceiling.</p>
    </div>

    <div class="card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg></div>
      <h3>Native PostgreSQL driver</h3>
      <p>Wire protocol v3 over <code>node:net</code> with SCRAM-SHA-256 auth and socket-level streaming backpressure. No <code>pg</code>.</p>
    </div>

    <div class="card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg></div>
      <h3>Dependency injection</h3>
      <p>IoC container with constructor injection, a singleton registry and circular-dependency detection via <code>reflect-metadata</code>.</p>
    </div>

    <div class="card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
      <h3>Security built in</h3>
      <p>JWT, AES-256-GCM sessions, scrypt vault, sliding-window rate limiting, XSS sanitiser, CSRF, CORS and CSP — all included.</p>
    </div>

    <div class="card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
      <h3>Real-time ready</h3>
      <p>A bounded WebSocket server with heartbeat, a typed event emitter, and SSE with keep-alive. Auth hook runs on upgrade.</p>
    </div>

    <div class="card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg></div>
      <h3>OpenAPI 3.1 auto-gen</h3>
      <p>The spec is generated from <code>@ApiOperation</code> decorators, always in sync, and served at <code>/openapi.json</code>.</p>
    </div>

    <div class="card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/></svg></div>
      <h3>Clustering &amp; telemetry</h3>
      <p>A <code>node:cluster</code> coordinator with IPC heartbeat, auto-restart, graceful shutdown and P50/P99 latency tracking.</p>
    </div>

    <div class="card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3M13 15h4"/></svg></div>
      <h3>CLI tooling</h3>
      <p><code>create</code>, <code>dev</code>, <code>generate</code> and <code>migrate</code> — the full project lifecycle from a single binary.</p>
    </div>

  </div>
</section>

<!-- ════════════════════════ CODE EXAMPLE ════════════════════════ -->
<section class="sec">
  <span class="eyebrow">Quick example</span>
  <h2 class="s-title">A complete production API. One file.</h2>
  <p class="s-sub">PostgreSQL, JWT auth, rate limiting and auto-generated OpenAPI — every import comes from <code>streetjs</code>.</p>
  <div class="win codewin">
    <div class="win-bar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="fn">src/main.ts</span><span class="lb">TypeScript</span></div>
{% highlight typescript %}
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
{% endhighlight %}
  </div>
</section>

<!-- ════════════════════════ DOCS ════════════════════════ -->
<section class="sec band">
  <span class="eyebrow">Documentation</span>
  <h2 class="s-title">Everything you need to ship.</h2>
  <p class="s-sub">Comprehensive guides, API references and real-world examples for every part of the framework.</p>
  <div class="dgrid">

    <a href="{{ site.baseurl }}/getting-started/installation/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5 3 21l4.5-1.5M14 7l3 3M9.5 14.5 16 8a3.5 3.5 0 0 0 0-5L18 1M5 19c-1.5 0-3-.5-3-2 0-2 2-3 3-4"/><path d="M12 15s5-1 8-4 3-8 3-8-5 0-8 3-4 8-4 8z"/></svg></span>
      <div><div class="dt">Getting started <span class="arr">→</span></div><p class="dd">Install, scaffold, configure and run in 60 seconds.</p></div>
    </a>

    <a href="{{ site.baseurl }}/core/controllers/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h6a3 3 0 0 0 3-3V8"/></svg></span>
      <div><div class="dt">Controllers <span class="arr">→</span></div><p class="dd">HTTP handlers, routing, the context API and validation.</p></div>
    </a>

    <a href="{{ site.baseurl }}/core/dependency-injection/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg></span>
      <div><div class="dt">Dependency injection <span class="arr">→</span></div><p class="dd">IoC container, constructor injection and singletons.</p></div>
    </a>

    <a href="{{ site.baseurl }}/database/postgres-wire-driver/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg></span>
      <div><div class="dt">PostgreSQL <span class="arr">→</span></div><p class="dd">Wire driver, connection pool, repositories, migrations.</p></div>
    </a>

    <a href="{{ site.baseurl }}/security/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
      <div><div class="dt">Security <span class="arr">→</span></div><p class="dd">JWT, sessions, rate limiting, XSS, vault and CSRF.</p></div>
    </a>

    <a href="{{ site.baseurl }}/realtime/websocket/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>
      <div><div class="dt">Real-time <span class="arr">→</span></div><p class="dd">WebSocket server, SSE, typed events and heartbeat.</p></div>
    </a>

    <a href="{{ site.baseurl }}/deployment/docker/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0 0-9 5.8 5.8 0 0 0-11.3-1.6A4 4 0 0 0 6.5 19z"/></svg></span>
      <div><div class="dt">Deployment <span class="arr">→</span></div><p class="dd">Docker, production config and environment variables.</p></div>
    </a>

    <a href="{{ site.baseurl }}/examples/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></span>
      <div><div class="dt">Examples <span class="arr">→</span></div><p class="dd">REST API, WebSocket chat, file upload and auth flow.</p></div>
    </a>

    <a href="{{ site.baseurl }}/use-cases/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z"/></svg></span>
      <div><div class="dt">Use cases <span class="arr">→</span></div><p class="dd">16 industry verticals — fintech, IoT, AI and gaming.</p></div>
    </a>

    <a href="{{ site.baseurl }}/cli/commands/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3M13 15h4"/></svg></span>
      <div><div class="dt">CLI reference <span class="arr">→</span></div><p class="dd">All street commands, flags and options.</p></div>
    </a>

    <a href="{{ site.baseurl }}/testing/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V2"/><path d="M7 2h10M8 14h8"/></svg></span>
      <div><div class="dt">Testing <span class="arr">→</span></div><p class="dd">Integration tests, the test runner and real PostgreSQL.</p></div>
    </a>

    <a href="{{ site.baseurl }}/devtools/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a2 2 0 0 0 2.8 2.8l6-6a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.2-.4-.4-2.2z"/></svg></span>
      <div><div class="dt">Interactive DevTools <span class="arr">→</span></div><p class="dd">Token-gated, read-only Playground, Route Explorer, dependency graph and API Inspector.</p></div>
    </a>

    <a href="{{ site.baseurl }}/faq/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg></span>
      <div><div class="dt">FAQ <span class="arr">→</span></div><p class="dd">Common questions, migration guides and troubleshooting.</p></div>
    </a>

  </div>
</section>

<!-- ════════════════════════ CTA ════════════════════════ -->
<section class="cta">
  <h2><span class="grad">Built in the open. Improved together.</span></h2>
  <p>StreetJS is MIT-licensed and actively developed. Bug reports, feature requests and contributions are all welcome.</p>
  <div class="cta-links">
    <a href="https://github.com/hassanmubiru/StreetJS" class="cl" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.16.58.67.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z"/></svg>Star on GitHub</a>
    <a href="https://github.com/hassanmubiru/StreetJS/issues" class="cl" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>Issues</a>
    <a href="https://github.com/hassanmubiru/StreetJS/discussions" class="cl" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Discussions</a>
    <a href="{{ site.baseurl }}/contributing/" class="cl">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Contribute</a>
    <a href="{{ site.baseurl }}/changelog/" class="cl">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>Changelog</a>
  </div>
</section>

</div>
