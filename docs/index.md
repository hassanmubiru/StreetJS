---
layout:      default
# SEO: the homepage <title> is the single most valuable ranking signal, so it
# leads with the primary keyword instead of "Home". The header logo links home,
# so the page is excluded from the sidebar nav to avoid a long, redundant label.
title:       "TypeScript Backend Framework"
nav_exclude: true
permalink:   /
description: "StreetJS — the TypeScript framework for modern backend applications. APIs, authentication, realtime, background jobs and AI on Node.js core."
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
  --ink:var(--heading);--body:var(--text-secondary);--muted:var(--text-muted);--faint:var(--text-muted);
  --a:var(--accent);--a2:var(--accent);--a-hover:var(--accent-hover);--a-soft:var(--accent-soft);--a-line:var(--accent-line);
  --bd:var(--border);--bd2:var(--border-strong);--card:var(--elevated);
  --code:var(--code-bg);--code-line:var(--code-border);
  --fh:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --fm:'JetBrains Mono','SFMono-Regular',Consolas,monospace;
  --tr:.18s cubic-bezier(.4,0,.2,1);--rs:9px;--rm:12px;--rl:16px;--rx:22px;
  font-family:var(--fh);color:var(--body);line-height:1.6}
.home *{box-sizing:border-box}
.home svg{display:block}

/* ── Section scaffolding — more air, fewer borders ──────────────────────── */
.home .sec{margin:0 0 7rem}
.home .eyebrow{display:inline-flex;align-items:center;gap:.55rem;font-size:.72rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.14em;color:var(--a);margin-bottom:.9rem}
.home .eyebrow::before{content:'';width:20px;height:2px;border-radius:2px;background:var(--a)}
.home .s-title{font-size:clamp(1.7rem,3.4vw,2.3rem);font-weight:800;letter-spacing:-.03em;
  line-height:1.16;color:var(--ink);margin:0 0 .7rem}
.home .s-sub{font-size:1.05rem;color:var(--muted);line-height:1.7;margin:0 0 2.6rem;max-width:640px}
.home code{font-family:var(--fm);font-size:.84em;background:var(--a-soft);color:var(--accent);
  padding:.12em .42em;border-radius:5px;border:1px solid var(--a-line)}

/* ── 1 · Hero ───────────────────────────────────────────────────────────── */
.home .hero{position:relative;text-align:center;padding:6.5rem 1.5rem 5.5rem;overflow:hidden;margin-bottom:6rem;
  background:radial-gradient(ellipse 75% 75% at 50% -10%,var(--a-soft),transparent 60%)}
.home .hero::before{content:'';position:absolute;inset:0;
  background-image:linear-gradient(var(--bd) 1px,transparent 1px),linear-gradient(90deg,var(--bd) 1px,transparent 1px);
  background-size:54px 54px;opacity:.45;
  -webkit-mask-image:radial-gradient(ellipse 70% 55% at 50% 25%,#000 5%,transparent 72%);
  mask-image:radial-gradient(ellipse 70% 55% at 50% 25%,#000 5%,transparent 72%);pointer-events:none}
.home .hero-in{position:relative;z-index:1;max-width:820px;margin:0 auto}
.home .tag{display:inline-flex;align-items:center;gap:.55rem;background:var(--card);
  border:1px solid var(--a-line);border-radius:100px;padding:.36rem .9rem;font-size:.74rem;
  font-weight:600;color:var(--a-hover);letter-spacing:.01em;margin-bottom:2rem}
.home .tag .dot{width:7px;height:7px;border-radius:50%;background:var(--a);
  box-shadow:0 0 0 3px rgba(37,99,235,.18);animation:pulse 2.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.home .hero h1{font-size:clamp(2.6rem,6.2vw,4.4rem);font-weight:800;letter-spacing:-.045em;
  line-height:1.04;margin:0 0 1.6rem;color:var(--ink);max-width:14ch;margin-left:auto;margin-right:auto}
.home .grad{background:linear-gradient(115deg,var(--heading) 0%,var(--accent) 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.home .hero-sub{font-size:clamp(1.05rem,2vw,1.25rem);color:var(--muted);line-height:1.7;
  max-width:640px;margin:0 auto 2.4rem}

/* ── Buttons ────────────────────────────────────────────────────────────── */
.home .btns{display:flex;gap:.7rem;justify-content:center;flex-wrap:wrap;margin-bottom:2.8rem}
.home .btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.6rem;border-radius:var(--rs);
  font-size:.96rem;font-weight:600;text-decoration:none!important;transition:var(--tr);white-space:nowrap;border:1px solid transparent}
.home .btn svg{width:16px;height:16px}
.home .btn-p{background:var(--accent-solid);color:#fff!important;border-color:var(--accent-solid);
  box-shadow:0 6px 18px -5px rgba(37,99,235,.5)}
.home .btn-p:hover{background:var(--accent-solid-hover);border-color:var(--accent-solid-hover);transform:translateY(-2px);box-shadow:0 10px 26px -6px rgba(37,99,235,.55)}
.home .btn-g{background:var(--card);color:var(--ink)!important;border-color:var(--bd)}
.home .btn-g:hover{border-color:var(--bd2);background:var(--surface);transform:translateY(-2px);color:var(--a)!important}

/* ── Hero command block (with copy button) ──────────────────────────────── */
.home .cmd{display:inline-flex;align-items:center;gap:1rem;max-width:100%;
  background:var(--code);border:1px solid var(--code-line);border-radius:var(--rm);
  padding:.55rem .65rem .55rem 1.15rem;box-shadow:0 16px 40px -22px rgba(15,23,42,.45)}
.home .cmd .cmd-text{font-family:var(--fm);font-size:.95rem;color:var(--code-text);background:none;
  border:none;padding:0;white-space:nowrap;overflow-x:auto}
.home .cmd .cmd-text::before{content:'$';color:var(--a);margin-right:.6rem;font-weight:600}
.home .cmd-copy{flex-shrink:0;display:inline-flex;align-items:center;gap:.4rem;cursor:pointer;
  font-family:var(--fh);font-size:.8rem;font-weight:600;color:var(--muted);
  background:var(--card);border:1px solid var(--bd);border-radius:7px;padding:.42rem .7rem;transition:var(--tr)}
.home .cmd-copy:hover{color:var(--a);border-color:var(--a-line);background:var(--a-soft)}
.home .cmd-copy svg{width:14px;height:14px}
.home .cmd-copy.ok{color:var(--a);border-color:var(--a-line);background:var(--a-soft)}
@media(max-width:560px){.home .cmd{width:100%;justify-content:space-between;gap:.5rem;padding-left:.9rem}
  .home .cmd .cmd-text{font-size:.82rem}}

/* ── Window chrome (code) ───────────────────────────────────────────────── */
.home .win{background:var(--code);border:1px solid var(--code-line);border-radius:var(--rm);overflow:hidden;
  box-shadow:0 24px 50px -24px rgba(15,23,42,.45)}
.home .win-bar{background:var(--code-header);border-bottom:1px solid var(--code-line);padding:.7rem 1.1rem;
  display:flex;align-items:center;gap:.45rem}
.home .win-bar .d{width:11px;height:11px;border-radius:50%}
.home .win-bar .d.r{background:#FF5F57}.home .win-bar .d.y{background:#FEBC2E}.home .win-bar .d.g{background:#28C840}
.home .win-bar .fn{font-family:var(--fm);font-size:.74rem;color:var(--muted);margin-left:.6rem}
.home .win-bar .lb{margin-left:auto;font-size:.66rem;font-weight:600;background:var(--a-soft);color:var(--a);
  padding:.16rem .55rem;border-radius:5px;text-transform:uppercase;letter-spacing:.08em}

/* ── 2 · Code example — feature badges ──────────────────────────────────── */
.home .fbadges{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.75rem}
.home .fbadge{display:inline-flex;align-items:center;gap:.45rem;font-size:.8rem;font-weight:600;
  color:var(--ink);background:var(--card);border:1px solid var(--bd);border-radius:100px;padding:.34rem .85rem}
.home .fbadge svg{width:13px;height:13px;color:var(--a)}

/* ── Code window (code renders INSIDE the frame) ────────────────────────── */
.home .codewin figure.highlight,.home .codewin div.highlighter-rouge,.home .codewin div.highlight{margin:0!important;border:none!important;
  border-radius:0!important;box-shadow:none!important;background:var(--code)!important}
.home .codewin pre,.home .codewin pre.highlight{margin:0!important;border:none!important;border-radius:0!important;
  box-shadow:none!important;padding:1.5rem 1.7rem!important;background:var(--code)!important;
  max-height:none!important;overflow-x:auto!important}
.home .codewin pre code,.home .codewin code{background:none!important;background-color:transparent!important;border:none!important;padding:0!important}

/* ── 3 · Feature grid (Why StreetJS) ────────────────────────────────────── */
.home .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}
.home .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--rl);
  padding:1.85rem;transition:var(--tr)}
.home .card:hover{border-color:var(--a-line);transform:translateY(-3px);box-shadow:0 18px 36px -18px rgba(37,99,235,.35)}
.home .ic{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  background:var(--a-soft);border:1px solid var(--a-line);color:var(--a);margin-bottom:1.2rem}
.home .ic svg{width:22px;height:22px}
.home .card h3{font-size:1.05rem;font-weight:700;color:var(--ink);margin:0 0 .5rem;letter-spacing:-.01em}
.home .card p{font-size:.92rem;color:var(--muted);margin:0;line-height:1.65}
.home .card .more{display:inline-flex;align-items:center;gap:.3rem;margin-top:.95rem;font-size:.85rem;
  font-weight:600;color:var(--a);text-decoration:none!important}
.home .card .more svg{width:14px;height:14px;transition:var(--tr)}
.home .card:hover .more svg{transform:translateX(3px)}

/* ── 4 · Showcase ───────────────────────────────────────────────────────── */
.home .show-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.1rem}
.home .sx{display:block;border:1px solid var(--bd);border-radius:var(--rl);overflow:hidden;background:var(--card);text-decoration:none!important;transition:var(--tr)}
.home .sx:hover{border-color:var(--a-line);transform:translateY(-3px);box-shadow:0 18px 36px -18px rgba(37,99,235,.35)}
.home .sx img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;border-bottom:1px solid var(--bd);background:#0B1220}
.home .sx .sxb{padding:1rem 1.15rem}
.home .sx .sxt{font-size:.97rem;font-weight:700;color:var(--ink);margin:0 0 .25rem}
.home .sx .sxd{font-size:.84rem;color:var(--muted);margin:0 0 .7rem;line-height:1.55}
.home .sx .sxlink{font-size:.8rem;font-weight:600;color:var(--a)}
.home .show-more{margin-top:1.8rem}

/* ── 5 · Ecosystem cards ────────────────────────────────────────────────── */
.home .dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:.9rem}
.home .dc{background:var(--card);border:1px solid var(--bd);border-radius:var(--rl);padding:1.45rem;
  text-decoration:none!important;display:flex;gap:1rem;align-items:flex-start;transition:var(--tr)}
.home .dc:hover{border-color:var(--a-line);transform:translateY(-3px);box-shadow:0 18px 36px -18px rgba(37,99,235,.35)}
.home .dc .dic{flex-shrink:0;width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;
  background:var(--a-soft);border:1px solid var(--a-line);color:var(--a);transition:var(--tr)}
.home .dc .dic svg{width:19px;height:19px}
.home .dc:hover .dic{background:var(--a);border-color:var(--a);color:#fff}
.home .dc .dt{font-size:.96rem;font-weight:700;color:var(--ink);margin:0 0 .25rem;display:flex;align-items:center;gap:.35rem}
.home .dc .dt .arr{opacity:0;transform:translateX(-4px);transition:var(--tr);color:var(--a)}
.home .dc:hover .dt .arr{opacity:1;transform:translateX(0)}
.home .dc .dd{font-size:.85rem;color:var(--muted);line-height:1.55;margin:0}

/* ── 6 · Final CTA ──────────────────────────────────────────────────────── */
.home .cta{position:relative;text-align:center;padding:4.5rem 2rem;overflow:hidden;
  border:1px solid var(--bd);border-radius:var(--rx);
  background:radial-gradient(ellipse 70% 100% at 50% 0%,var(--a-soft),var(--bg) 70%)}
.home .cta::before{content:'';position:absolute;inset:0;
  background-image:radial-gradient(circle at 1px 1px,rgba(37,99,235,.12) 1px,transparent 0);
  background-size:28px 28px;
  -webkit-mask-image:radial-gradient(ellipse 70% 80% at 50% 0%,#000,transparent 72%);
  mask-image:radial-gradient(ellipse 70% 80% at 50% 0%,#000,transparent 72%);
  opacity:.7;pointer-events:none}
.home .cta>*{position:relative;z-index:1}
.home .cta h2{font-size:clamp(1.7rem,3.6vw,2.4rem);font-weight:800;letter-spacing:-.03em;margin:0 0 .8rem;color:var(--ink)}
.home .cta p{font-size:1.05rem;color:var(--muted);max-width:520px;margin:0 auto 2.2rem;line-height:1.7}

@media(max-width:640px){
  .home .hero{padding:4.5rem 1.1rem 4rem;margin-bottom:4.5rem}
  .home .sec{margin-bottom:5rem}
  .home .cta{padding:3rem 1.25rem}
}
@media(prefers-reduced-motion:reduce){.home *,.home *::before,.home *::after{animation:none!important;transition:none!important}}
</style>

<div class="home" markdown="0">

<!-- ════════════════════════ 1 · HERO ════════════════════════ -->
<section class="hero">
  <div class="hero-in">
    <span class="tag"><span class="dot"></span>v{{ site.version }} · MIT · TypeScript 5 · Node 20+</span>
    <h1><span class="grad">The TypeScript Framework for Modern Backend Applications</span></h1>
    <p class="hero-sub">Build APIs, authentication, realtime features, background jobs and AI integrations in one type-safe framework — built directly on Node.js core.</p>
    <div class="btns">
      <a href="{{ site.baseurl }}/getting-started/installation/" class="btn btn-p">Get Started
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      <a href="{{ site.baseurl }}/getting-started/" class="btn btn-g">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>Documentation</a>
      <a href="https://github.com/hassanmubiru/StreetJS" class="btn btn-g" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.16.58.67.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z"/></svg>GitHub</a>
    </div>
    <div class="cmd">
      <code class="cmd-text">npx @streetjs/cli create my-app</code>
      <button class="cmd-copy" type="button" aria-label="Copy command to clipboard" onclick="navigator.clipboard&amp;&amp;navigator.clipboard.writeText('npx @streetjs/cli create my-app');var b=this;b.classList.add('ok');b.querySelector('.cc-l').textContent='Copied';setTimeout(function(){b.classList.remove('ok');b.querySelector('.cc-l').textContent='Copy';},1600);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span class="cc-l">Copy</span>
      </button>
    </div>
  </div>
</section>

<!-- ════════════════════════ 2 · CODE EXAMPLE ════════════════════════ -->
<section class="sec">
  <span class="eyebrow">A complete API</span>
  <h2 class="s-title">Routing, validation, data access and auth — together.</h2>
  <p class="s-sub">Decorator-driven controllers wire HTTP routes, request validation, the ORM and authentication into one cohesive, type-safe surface.</p>
  <div class="fbadges">
    <span class="fbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h6a3 3 0 0 0 3-3V8"/></svg>Routing</span>
    <span class="fbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Validation</span>
    <span class="fbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>ORM</span>
    <span class="fbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Authentication</span>
    <span class="fbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>Realtime</span>
  </div>
  <div class="win codewin">
    <div class="win-bar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="fn">src/users.controller.ts</span><span class="lb">TypeScript</span></div>
{% highlight typescript %}
import 'reflect-metadata';
import {
  Controller, Get, Post, Body, Auth,
  Repository, InjectRepository, ApiOperation,
} from 'streetjs';
import type { StreetContext } from 'streetjs';
import { User } from './user.entity.js';
import { CreateUserDto } from './user.dto.js';

@Controller('/users')
export class UsersController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Get('/')
  @Auth({ roles: ['admin'] })            // JWT + role-based access
  @ApiOperation({ summary: 'List users', tags: ['users'] })
  async list(ctx: StreetContext): Promise<void> {
    ctx.json({ users: await this.users.findAll() });
  }

  @Post('/')
  @ApiOperation({ summary: 'Create user', tags: ['users'] })
  async create(@Body() dto: CreateUserDto): Promise<User> {
    return this.users.create(dto);       // validated, then persisted
  }
}
{% endhighlight %}
  </div>
</section>

<!-- ════════════════════════ 3 · WHY STREETJS ════════════════════════ -->
<section class="sec">
  <span class="eyebrow">Why StreetJS</span>
  <h2 class="s-title">One framework for the whole backend.</h2>
  <p class="s-sub">The pieces most applications need are built in and designed to work together — no glue code, no assembling a dozen libraries.</p>
  <div class="grid">

    <a class="card" href="{{ site.baseurl }}/authentication/" style="text-decoration:none!important">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
      <h3>Authentication</h3>
      <p>JWT access tokens, server-side sessions, API keys, OAuth2/OIDC with PKCE, WebAuthn passkeys and role-based access control.</p>
      <span class="more">Learn more <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </a>

    <a class="card" href="{{ site.baseurl }}/realtime/" style="text-decoration:none!important">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
      <h3>Realtime</h3>
      <p>A bounded WebSocket server with heartbeat, a typed event emitter, and Server-Sent Events with keep-alive. Auth runs on upgrade.</p>
      <span class="more">Learn more <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </a>

    <a class="card" href="{{ site.baseurl }}/orm/" style="text-decoration:none!important">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg></div>
      <h3>Database &amp; ORM</h3>
      <p>A native PostgreSQL wire driver, the repository pattern, entity and relation decorators, a parameterized query planner and migrations.</p>
      <span class="more">Learn more <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </a>

    <a class="card" href="{{ site.baseurl }}/jobs/" style="text-decoration:none!important">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
      <h3>Background Jobs</h3>
      <p>A PostgreSQL-backed job queue, a cron scheduler and a saga workflow engine for long-running processes — no Redis required.</p>
      <span class="more">Learn more <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </a>

    <a class="card" href="{{ site.baseurl }}/ai/" style="text-decoration:none!important">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1 0 8 4 4 0 0 1-8 0 4 4 0 0 1 0-8 4 4 0 0 1 4-4z"/><path d="M12 8v8M8 12h8"/></svg></div>
      <h3>AI Integrations</h3>
      <p>A provider-agnostic surface for LLM chat, embeddings, retrieval-augmented generation and tool calling, with OpenAI, Anthropic and Ollama adapters.</p>
      <span class="more">Learn more <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </a>

    <a class="card" href="{{ site.baseurl }}/getting-started/" style="text-decoration:none!important">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg></div>
      <h3>TypeScript First</h3>
      <p>Strict mode, NodeNext ESM, decorator metadata and full type inference end to end. Zero <code>any</code> in the framework source.</p>
      <span class="more">Learn more <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </a>

  </div>
</section>

<!-- ════════════════════════ 4 · SHOWCASE ════════════════════════ -->
<section class="sec">
  <span class="eyebrow">Showcase</span>
  <h2 class="s-title">See what you can build.</h2>
  <p class="s-sub">Official reference applications — clone any of them and use it as the foundation for your own project.</p>
  <div class="show-grid">
    <a class="sx" href="{{ site.baseurl }}/showcase/">
      <img src="{{ '/assets/images/showcase/rest-api.svg' | relative_url }}" alt="REST API reference app — illustrative cover" loading="lazy" width="640" height="360">
      <div class="sxb"><p class="sxt">REST API</p><p class="sxd">Typed CRUD with controllers, repositories, validation and OpenAPI.</p><span class="sxlink">View source →</span></div>
    </a>
    <a class="sx" href="{{ site.baseurl }}/showcase/">
      <img src="{{ '/assets/images/showcase/realtime-chat.svg' | relative_url }}" alt="Realtime Chat reference app — illustrative cover" loading="lazy" width="640" height="360">
      <div class="sxb"><p class="sxt">Realtime Chat</p><p class="sxd">WebSocket channels, presence and live delivery with heartbeats.</p><span class="sxlink">View source →</span></div>
    </a>
    <a class="sx" href="{{ site.baseurl }}/showcase/">
      <img src="{{ '/assets/images/showcase/live-dashboard.svg' | relative_url }}" alt="Live Dashboard reference app — illustrative cover" loading="lazy" width="640" height="360">
      <div class="sxb"><p class="sxt">Live Dashboard</p><p class="sxd">Server-sent events streaming metrics to an auto-updating dashboard.</p><span class="sxlink">View source →</span></div>
    </a>
  </div>
  <div class="show-more">
    <a href="{{ site.baseurl }}/examples/" class="btn btn-g">View all examples
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
  </div>
</section>

<!-- ════════════════════════ 4b · FEATURED PLUGINS ════════════════════════ -->
<!-- Data-driven from docs/_data/plugins.json (generated by scripts/gen-plugins-data.mjs).
     Only LISTED plugins are present in that data — unlisted packages (e.g. MarzPay)
     are excluded by the generator, so they can never appear here by construction. -->
<section class="sec">
  <span class="eyebrow">Plugins</span>
  <h2 class="s-title">Extend the stack with signed plugins.</h2>
  <p class="s-sub">{{ site.data.plugins.count }} official, dependency-free plugins — payments, databases, cache, messaging, storage, auth and AI. Versions and signing status below are read live from each package; no hand-maintained list.</p>
  <div class="dgrid">
    {%- assign featured = "stripe,marzpay,openai,redis,kafka,htmx" | split: "," -%}
    {%- for slug in featured -%}
    {%- assign p = site.data.plugins.plugins | where: "slug", slug | first -%}
    {%- if p -%}
    <a href="{{ site.baseurl }}/plugins/{{ p.slug }}/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1h-3a2 2 0 0 0-4 0H8a1 1 0 0 0-1 1v3a2 2 0 0 1 0 4v3a1 1 0 0 0 1 1h3a2 2 0 0 1 4 0h3a1 1 0 0 0 1-1v-3a2 2 0 0 0 0-4z"/></svg></span>
      <div><div class="dt">{{ p.title }} <span class="arr">→</span></div><p class="dd">{{ p.description }}</p><p class="dd" style="margin-top:.4rem;font-size:.78rem;opacity:.8">{{ p.category }} · v{{ p.version }}{% if p.signed %} · ✓ signed{% endif %}{% if p.dependencyFree %} · 0 deps{% endif %}</p></div>
    </a>
    {%- endif -%}
    {%- endfor -%}
  </div>
  <div class="show-more">
    <a href="{{ site.baseurl }}/plugins/marketplace/" class="btn btn-g">Browse all plugins
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
  </div>
</section>

<!-- ════════════════════════ 5 · ECOSYSTEM ════════════════════════ -->
<section class="sec">
  <span class="eyebrow">Ecosystem</span>
  <h2 class="s-title">Everything around the framework.</h2>
  <p class="s-sub">Documentation, examples, plugins and a community to help you ship and maintain production backends.</p>
  <div class="dgrid">

    <a href="{{ site.baseurl }}/getting-started/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
      <div><div class="dt">Documentation <span class="arr">→</span></div><p class="dd">Guides, API references and tutorials for every part of the framework.</p></div>
    </a>

    <a href="{{ site.baseurl }}/examples/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></span>
      <div><div class="dt">Examples <span class="arr">→</span></div><p class="dd">REST API, WebSocket chat, file upload and authentication flows.</p></div>
    </a>

    <a href="{{ site.baseurl }}/plugins/marketplace/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1h-3a2 2 0 0 0-4 0H8a1 1 0 0 0-1 1v3a2 2 0 0 1 0 4v3a1 1 0 0 0 1 1h3a2 2 0 0 1 4 0h3a1 1 0 0 0 1-1v-3a2 2 0 0 0 0-4z"/></svg></span>
      <div><div class="dt">Plugins <span class="arr">→</span></div><p class="dd">Browse {{ site.data.plugins.count }} official, signed, dependency-free plugins — databases, payments, auth, storage and AI.</p></div>
    </a>

    <a href="{{ site.baseurl }}/starters/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>
      <div><div class="dt">Starters <span class="arr">→</span></div><p class="dd">Scaffold a SaaS, AI, realtime or marketplace backend in one command with <code>--starter</code>.</p></div>
    </a>

    <a href="{{ site.baseurl }}/community/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
      <div><div class="dt">Community <span class="arr">→</span></div><p class="dd">Contributor path, governance, the RFC process and good first issues.</p></div>
    </a>

    <a href="{{ site.baseurl }}/security/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></span>
      <div><div class="dt">Security <span class="arr">→</span></div><p class="dd">Security policy, threat model, SBOM, provenance and OpenSSF Scorecard.</p></div>
    </a>

    <a href="{{ site.baseurl }}/trust/" class="dc">
      <span class="dic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></span>
      <div><div class="dt">Trust Center <span class="arr">→</span></div><p class="dd">Supply-chain evidence, compatibility matrix and the enterprise adoption checklist.</p></div>
    </a>

    <a href="https://github.com/hassanmubiru/StreetJS" class="dc" target="_blank" rel="noopener">
      <span class="dic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.16.58.67.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z"/></svg></span>
      <div><div class="dt">GitHub <span class="arr">→</span></div><p class="dd">Source code, issues, discussions and the public roadmap.</p></div>
    </a>

  </div>
</section>

<!-- ════════════════════════ 6 · FINAL CTA ════════════════════════ -->
<section class="cta">
  <h2><span class="grad">Build production applications faster.</span></h2>
  <p>Scaffold a fully typed backend in seconds, then grow it with the features you need — all from one framework.</p>
  <div class="btns" style="margin-bottom:0">
    <a href="{{ site.baseurl }}/getting-started/installation/" class="btn btn-p">Get Started
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
    <a href="https://github.com/hassanmubiru/StreetJS" class="btn btn-g" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.16.58.67.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z"/></svg>GitHub</a>
  </div>
</section>

</div>
