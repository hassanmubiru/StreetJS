---
layout:      home
title:       Home
nav_order:   1
permalink:   /
description: "Street — production-grade, memory-safe TypeScript backend framework built on Node.js core. Native PostgreSQL driver, JWT, WebSockets, clustering. 2 dependencies."
---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

<style>
/* ═══════════════════════════════════════════════════════════════════════════
   STREET FRAMEWORK — REFINED PALETTE
   Single accent: Slate Blue #3B82F6
   Near-monochromatic dark — no competing colors
   ═══════════════════════════════════════════════════════════════════════════ */
:root {
  /* One accent — used sparingly */
  --s-blue:        #3B82F6;
  --s-blue-h:      #2563EB;
  --s-blue-a:      #1D4ED8;
  --s-blue-dim:    rgba(59,130,246,0.15);
  --s-blue-glow:   rgba(59,130,246,0.08);

  /* Surfaces — very dark, low contrast between layers */
  --s-bg:          #080C14;
  --s-bg2:         #0B1020;
  --s-surface:     #0E1525;
  --s-card:        #111927;
  --s-card-h:      #141E2E;
  --s-border:      #1A2540;
  --s-border-h:    rgba(59,130,246,0.35);
  --s-border-dim:  #131D30;

  /* Text — slate scale, NOT pure white */
  --s-t1:          #CBD5E1;   /* slate-300 — primary text, not blinding */
  --s-t2:          #64748B;   /* slate-500 — secondary */
  --s-t3:          #3B4A5E;   /* slate-600 — muted */
  --s-t4:          #243044;   /* barely visible */

  /* Accent text — only blue, no other colors */
  --s-accent:      #60A5FA;   /* blue-400 — links, highlights */
  --s-accent-dim:  #3B82F6;   /* blue-500 — slightly dimmer */

  /* Status — desaturated, used only in terminal */
  --s-green:       #4ADE80;   /* only for terminal prompt dot */
  --s-ok:          #22D3EE;   /* terminal success line */

  --s-r-sm:        6px;
  --s-r:           12px;
  --s-r-lg:        16px;
  --s-r-xl:        20px;

  --s-fh:          'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --s-fb:          'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --s-fm:          'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;

  --s-ease:        cubic-bezier(0.4, 0, 0.2, 1);
  --s-t:           all 0.2s var(--s-ease);

  --s-sh-blue:     0 4px 20px rgba(59,130,246,0.18);
  --s-sh-lg:       0 8px 40px rgba(0,0,0,0.8);
  --s-sh-glow:     0 0 50px rgba(59,130,246,0.06);
  --s-sh-card:     0 2px 8px rgba(0,0,0,0.6);
}

.sp * { box-sizing: border-box; }
.sp { font-family: var(--s-fb); color: var(--s-t1); line-height: 1.6; }

/* ── Gradient text — subtle, not rainbow ──────────────────────────────── */
.gt {
  background: linear-gradient(135deg, #E2E8F0 0%, #94A3B8 60%, #60A5FA 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}
.gt-blue {
  background: linear-gradient(135deg, #93C5FD 0%, #60A5FA 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ── Section chrome ────────────────────────────────────────────────────── */
.s-eyebrow {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.14em; color: var(--s-accent);
  background: var(--s-blue-dim); border: 1px solid rgba(59,130,246,0.15);
  border-radius: 100px; padding: 0.28rem 0.85rem; margin-bottom: 0.75rem;
}
.s-h2 {
  font-family: var(--s-fh); font-size: clamp(1.5rem, 3.5vw, 2rem);
  font-weight: 700; letter-spacing: -0.03em; line-height: 1.2;
  color: var(--s-t1); margin: 0 0 0.6rem;
}
.s-sub {
  font-size: 0.9375rem; color: var(--s-t2); line-height: 1.7;
  margin: 0 0 2.5rem; max-width: 560px;
}
.s-section { margin-bottom: 4.5rem; }
</style>

<style>
/* ══════════════════════════════════════════════════════════════════════════
   HERO
   ══════════════════════════════════════════════════════════════════════════ */
.s-hero {
  position: relative; text-align: center;
  padding: 6rem 1.5rem 5rem;
  margin-bottom: 0;
  overflow: hidden;
  background: var(--s-bg);
  border: 1px solid var(--s-border);
  border-radius: var(--s-r-xl);
}

/* Dot-grid background */
.s-hero::before {
  content: '';
  position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(59,130,246,0.1) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 100%);
  pointer-events: none;
}

/* Blue + indigo glow orbs */
.s-hero::after {
  content: '';
  position: absolute;
  top: -200px; left: 50%; transform: translateX(-50%);
  width: 900px; height: 600px;
  background:
    radial-gradient(ellipse at 35% 45%, rgba(59,130,246,0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 65% 55%, rgba(59,130,246,0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 80%, rgba(59,130,246,0.06) 0%, transparent 50%);
  pointer-events: none;
  animation: heroOrb 10s ease-in-out infinite alternate;
}
@keyframes heroOrb {
  0%   { opacity: 0.8; transform: translateX(-50%) scale(1); }
  100% { opacity: 1;   transform: translateX(-50%) scale(1.06); }
}

.s-hero-inner { position: relative; z-index: 1; }

/* Version pill */
.s-hero-pill {
  display: inline-flex; align-items: center; gap: 0.5rem;
  background: rgba(59,130,246,0.07); border: 1px solid rgba(59,130,246,0.15);
  border-radius: 100px; padding: 0.3rem 1rem;
  font-size: 0.78rem; font-weight: 600; color: var(--s-accent);
  letter-spacing: 0.05em; text-transform: uppercase;
  margin-bottom: 1.75rem;
}
.s-hero-pill .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--s-ok);
  box-shadow: 0 0 8px var(--s-ok);
  animation: blink 2.5s ease-in-out infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
}

/* Main headline */
.s-hero h1 {
  font-family: var(--s-fh);
  font-size: clamp(2.6rem, 7vw, 4.8rem);
  font-weight: 900;
  letter-spacing: -0.05em;
  line-height: 1.04;
  margin: 0 0 1.5rem;
}

/* Subheadline */
.s-hero-sub {
  font-size: clamp(1.05rem, 2.5vw, 1.25rem);
  color: var(--s-t2); line-height: 1.7;
  max-width: 580px; margin: 0 auto 0.75rem;
}

/* No-deps strip */
.s-hero-nodeps {
  font-family: var(--s-fm); font-size: 0.82rem;
  color: var(--s-t3); letter-spacing: 0.03em;
  margin-bottom: 2.5rem;
}
.s-hero-nodeps span { color: var(--s-accent); }

/* CTA buttons */
.s-btns {
  display: flex; gap: 0.75rem; justify-content: center;
  flex-wrap: wrap; margin-bottom: 2.5rem;
}
.s-btn {
  display: inline-flex; align-items: center; gap: 0.45rem;
  padding: 0.75rem 1.6rem; border-radius: var(--s-r);
  font-size: 0.95rem; font-weight: 700;
  text-decoration: none !important;
  transition: var(--s-t); white-space: nowrap;
  position: relative; overflow: hidden;
}
.s-btn-primary {
  background: var(--s-blue); color: #fff !important;
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: var(--s-sh-blue), inset 0 1px 0 rgba(255,255,255,0.1);
}
.s-btn-primary::before {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 60%);
  pointer-events: none;
}
.s-btn-primary:hover {
  background: var(--s-blue-h);
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(59,130,246,0.22), inset 0 1px 0 rgba(255,255,255,0.1);
}
.s-btn-ghost {
  background: rgba(255,255,255,0.04); color: var(--s-t1) !important;
  border: 1px solid var(--s-border);
  backdrop-filter: blur(8px);
}
.s-btn-ghost:hover {
  background: rgba(255,255,255,0.08);
  border-color: rgba(59,130,246,0.25);
  transform: translateY(-2px);
  color: var(--s-accent) !important;
}

/* Badges */
.s-badges {
  display: flex; gap: 0.4rem; justify-content: center; flex-wrap: wrap;
}
</style>

<style>
/* ══════════════════════════════════════════════════════════════════════════
   TERMINAL
   ══════════════════════════════════════════════════════════════════════════ */
.s-term {
  background: #050A14; border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); overflow: hidden;
  box-shadow: var(--s-sh-lg), var(--s-sh-glow);
  margin: 2.5rem 0;
}
.s-term-bar {
  background: #0A1020; border-bottom: 1px solid var(--s-border);
  padding: 0.65rem 1.1rem;
  display: flex; align-items: center; gap: 0.45rem;
}
.s-term-bar .d { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.s-term-bar .title {
  font-family: var(--s-fm); font-size: 0.73rem;
  color: var(--s-t3); margin-left: 0.5rem; flex: 1; text-align: center;
}
.s-term-body {
  padding: 1.4rem 1.6rem;
  font-family: var(--s-fm); font-size: 0.88rem; line-height: 2.1;
}
.s-term-body .p  { color: var(--s-ok); user-select: none; }
.s-term-body .c  { color: var(--s-t1); }
.s-term-body .cm { color: var(--s-t3); font-style: italic; }
.s-term-body .ok { color: var(--s-accent); }

/* ══════════════════════════════════════════════════════════════════════════
   STAT BAR
   ══════════════════════════════════════════════════════════════════════════ */
.s-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 1px; background: var(--s-border);
  border: 1px solid var(--s-border); border-radius: var(--s-r-lg);
  overflow: hidden; margin: 2.5rem 0;
}
.s-stat {
  background: var(--s-surface);
  padding: 1.4rem 1rem; text-align: center;
  transition: var(--s-t);
}
.s-stat:hover { background: var(--s-card); }
.s-stat .sv {
  font-family: var(--s-fm); font-size: 1.5rem; font-weight: 700;
  color: var(--s-accent); line-height: 1; margin-bottom: 0.35rem;
  display: block;
}
.s-stat .sl {
  font-size: 0.75rem; color: var(--s-t3);
  text-transform: uppercase; letter-spacing: 0.08em;
}

/* ══════════════════════════════════════════════════════════════════════════
   HOW IT WORKS — 3-step flow
   ══════════════════════════════════════════════════════════════════════════ */
.s-steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem; margin-bottom: 0;
  position: relative;
}
.s-steps::before {
  content: '';
  position: absolute; top: 2.2rem; left: 15%; right: 15%; height: 1px;
  background: linear-gradient(90deg, transparent, var(--s-border), var(--s-blue), var(--s-border), transparent);
  pointer-events: none;
}
.s-step {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.75rem 1.5rem;
  text-align: center; transition: var(--s-t); position: relative;
}
.s-step:hover {
  border-color: var(--s-border-h);
  transform: translateY(-4px);
  box-shadow: var(--s-sh-blue);
}
.s-step .sn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; border-radius: 50%;
  background: linear-gradient(135deg, var(--s-blue), var(--s-blue));
  font-size: 1.1rem; font-weight: 800; color: #fff;
  margin: 0 auto 1rem; box-shadow: var(--s-sh-blue);
}
.s-step h3 {
  font-size: 1rem; font-weight: 700; color: var(--s-t1);
  margin: 0 0 0.5rem; letter-spacing: -0.01em;
}
.s-step p {
  font-size: 0.875rem; color: var(--s-t2); margin: 0; line-height: 1.65;
}
.s-step code {
  font-family: var(--s-fm); font-size: 0.8rem;
  background: rgba(59,130,246,0.07); color: var(--s-accent);
  padding: 0.1em 0.35em; border-radius: 4px;
}
</style>

<style>
/* ══════════════════════════════════════════════════════════════════════════
   FEATURE GRID
   ══════════════════════════════════════════════════════════════════════════ */
.s-features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem; margin-bottom: 0;
}
.s-feat {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.6rem;
  transition: var(--s-t); position: relative; overflow: hidden;
}
.s-feat::after {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, var(--s-blue), var(--s-blue), var(--s-accent));
  opacity: 0; transition: var(--s-t);
}
.s-feat:hover {
  border-color: rgba(59,130,246,0.25);
  background: var(--s-card-h);
  transform: translateY(-3px);
  box-shadow: var(--s-sh-blue), var(--s-sh-card);
}
.s-feat:hover::after { opacity: 1; }
.s-feat .fi { font-size: 1.8rem; margin-bottom: 0.9rem; display: block; line-height: 1; }
.s-feat h3 {
  font-size: 1rem; font-weight: 700; color: var(--s-t1);
  margin: 0 0 0.5rem; letter-spacing: -0.01em;
}
.s-feat p { font-size: 0.875rem; color: var(--s-t2); margin: 0; line-height: 1.65; }
.s-feat code {
  font-family: var(--s-fm); font-size: 0.8rem;
  background: rgba(59,130,246,0.08); color: var(--s-accent);
  padding: 0.1em 0.35em; border-radius: 4px;
}

/* ══════════════════════════════════════════════════════════════════════════
   ZERO DEPS
   ══════════════════════════════════════════════════════════════════════════ */
.s-nodeps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
  gap: 0.75rem;
}
.s-nd {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r); padding: 1rem 1.25rem;
  display: grid; grid-template-columns: 1.2rem 1.2rem 1fr;
  align-items: start; gap: 0.6rem; transition: var(--s-t);
}
.s-nd:hover { border-color: rgba(59,130,246,0.2); background: var(--s-card-h); }
.s-nd .x { color: var(--s-t3); font-weight: 800; font-size: 0.85rem; margin-top: 2px; }
.s-nd .ar { color: var(--s-ok); font-weight: 700; font-size: 0.85rem; margin-top: 2px; }
.s-nd strong { display: block; color: var(--s-t1); font-size: 0.88rem; font-weight: 600; margin-bottom: 0.2rem; }
.s-nd span { color: var(--s-t2); font-size: 0.8rem; line-height: 1.5; }
.s-nd code {
  font-family: var(--s-fm); font-size: 0.77rem;
  background: rgba(59,130,246,0.08); color: var(--s-accent);
  padding: 0.1em 0.3em; border-radius: 3px;
}

/* ══════════════════════════════════════════════════════════════════════════
   CODE WINDOW (unified — titlebar + code block together)
   ══════════════════════════════════════════════════════════════════════════ */
.s-codewin {
  background: #050A14; border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); overflow: hidden;
  box-shadow: var(--s-sh-lg), var(--s-sh-glow);
  margin-bottom: 0;
}
.s-codewin-bar {
  background: #0A1020; border-bottom: 1px solid var(--s-border);
  padding: 0.7rem 1.25rem;
  display: flex; align-items: center; gap: 0.45rem;
}
.s-codewin-bar .d { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.s-codewin-bar .fn {
  font-family: var(--s-fm); font-size: 0.75rem;
  color: var(--s-t3); margin-left: 0.5rem;
}
.s-codewin-bar .lb {
  margin-left: auto; font-size: 0.68rem; font-weight: 700;
  background: rgba(59,130,246,0.08); color: var(--s-accent);
  padding: 0.15rem 0.55rem; border-radius: 4px;
  border: 1px solid rgba(59,130,246,0.12);
  text-transform: uppercase; letter-spacing: 0.07em;
}
/* The markdown code block immediately after .s-codewin-bar gets merged in */
.s-codewin div.highlighter-rouge,
.s-codewin figure.highlight {
  margin: 0 !important; border: none !important;
  border-radius: 0 !important; box-shadow: none !important;
}
.s-codewin pre.highlight {
  border-radius: 0 0 var(--s-r-lg) var(--s-r-lg) !important;
  margin: 0 !important; border: none !important;
}
</style>

<style>
/* ══════════════════════════════════════════════════════════════════════════
   WHY STREET — narrative section
   ══════════════════════════════════════════════════════════════════════════ */
.s-why {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-xl); padding: 3rem 2.5rem;
  position: relative; overflow: hidden;
}
.s-why::before {
  content: '';
  position: absolute; top: -80px; right: -80px;
  width: 400px; height: 400px;
  background: radial-gradient(ellipse, rgba(59,130,246,0.06) 0%, transparent 65%);
  pointer-events: none;
}
.s-why-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 2rem; margin-top: 2rem;
}
.s-why-item { position: relative; }
.s-why-item .wi-num {
  font-family: var(--s-fm); font-size: 2.5rem; font-weight: 700;
  color: rgba(59,130,246,0.1); line-height: 1; margin-bottom: 0.5rem;
  display: block;
}
.s-why-item h4 {
  font-size: 1rem; font-weight: 700; color: var(--s-t1);
  margin: 0 0 0.4rem; letter-spacing: -0.01em;
}
.s-why-item p { font-size: 0.875rem; color: var(--s-t2); margin: 0; line-height: 1.65; }

/* ══════════════════════════════════════════════════════════════════════════
   MEMORY TABLE
   ══════════════════════════════════════════════════════════════════════════ */
.s-tbl-wrap {
  overflow-x: auto; border-radius: var(--s-r-lg);
  border: 1px solid var(--s-border);
  box-shadow: var(--s-sh-card);
}
.s-tbl {
  width: 100%; border-collapse: collapse;
  font-size: 0.875rem; background: var(--s-card);
}
.s-tbl thead tr {
  background: var(--s-surface); border-bottom: 1px solid var(--s-border);
}
.s-tbl th {
  padding: 0.9rem 1.1rem; text-align: left;
  font-size: 0.72rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--s-t3); white-space: nowrap;
}
.s-tbl td {
  padding: 0.85rem 1.1rem; border-bottom: 1px solid var(--s-border-dim);
  color: var(--s-t2); vertical-align: top; line-height: 1.55;
}
.s-tbl tr:last-child td { border-bottom: none; }
.s-tbl tr:hover td { background: rgba(59,130,246,0.03); }
.s-tbl td:first-child { color: var(--s-t1); font-weight: 500; }
.s-tbl td:nth-child(2) {
  font-family: var(--s-fm); font-size: 0.82rem; color: var(--s-accent);
}
.s-tbl code {
  font-family: var(--s-fm); font-size: 0.8rem;
  background: rgba(59,130,246,0.08); color: var(--s-accent);
  padding: 0.1em 0.35em; border-radius: 3px;
}

/* ══════════════════════════════════════════════════════════════════════════
   COMPARISON GRID
   ══════════════════════════════════════════════════════════════════════════ */
.s-cmp {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.75rem;
}
.s-cmp-card {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.25rem;
  transition: var(--s-t);
}
.s-cmp-card:hover {
  border-color: rgba(59,130,246,0.2); background: var(--s-card-h);
  transform: translateY(-2px); box-shadow: var(--s-sh-card);
}
.s-cmp-card .cv { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--s-t3); margin-bottom: 0.3rem; }
.s-cmp-card .cf { font-size: 1rem; font-weight: 700; color: var(--s-t1); margin-bottom: 0.75rem; }
.s-cmp-card ul { list-style: none; padding: 0; margin: 0; }
.s-cmp-card li {
  font-size: 0.8rem; color: var(--s-t2); padding: 0.2rem 0 0.2rem 1.1rem;
  position: relative; line-height: 1.5;
}
.s-cmp-card li::before {
  content: '✓'; position: absolute; left: 0;
  color: var(--s-ok); font-size: 0.72rem; font-weight: 700;
}
</style>

<style>
/* ══════════════════════════════════════════════════════════════════════════
   ROADMAP PREVIEW
   ══════════════════════════════════════════════════════════════════════════ */
.s-roadmap {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}
.s-rm-card {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.4rem;
  transition: var(--s-t);
}
.s-rm-card:hover { border-color: rgba(59,130,246,0.2); background: var(--s-card-h); }
.s-rm-card .rv {
  font-family: var(--s-fm); font-size: 0.72rem; font-weight: 700;
  color: var(--s-accent); text-transform: uppercase; letter-spacing: 0.1em;
  margin-bottom: 0.3rem;
}
.s-rm-card .rt {
  font-size: 0.95rem; font-weight: 700; color: var(--s-t1);
  margin-bottom: 0.25rem;
}
.s-rm-card .rq {
  font-size: 0.78rem; color: var(--s-t3); margin-bottom: 0.85rem;
}
.s-rm-card ul { list-style: none; padding: 0; margin: 0; }
.s-rm-card li {
  font-size: 0.8rem; color: var(--s-t2); padding: 0.2rem 0 0.2rem 1.1rem;
  position: relative; line-height: 1.5;
}
.s-rm-card li::before {
  content: '→'; position: absolute; left: 0;
  color: var(--s-blue); font-size: 0.75rem;
}
.s-rm-done { border-color: rgba(34,197,94,0.2) !important; }
.s-rm-done .rv { color: var(--s-ok) !important; }
.s-rm-done li::before { content: '✓'; color: var(--s-ok) !important; }

/* ══════════════════════════════════════════════════════════════════════════
   DOC GRID
   ══════════════════════════════════════════════════════════════════════════ */
.s-docs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
}
.s-doc {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.1rem 1.25rem;
  text-decoration: none !important; display: block;
  transition: var(--s-t); position: relative; overflow: hidden;
}
.s-doc::after {
  content: '→';
  position: absolute; right: 1rem; top: 50%;
  transform: translateY(-50%) translateX(6px);
  color: var(--s-blue); font-size: 1rem;
  opacity: 0; transition: var(--s-t);
}
.s-doc:hover {
  border-color: rgba(59,130,246,0.25); background: var(--s-card-h);
  transform: translateY(-2px); box-shadow: var(--s-sh-blue);
  text-decoration: none !important;
}
.s-doc:hover::after { opacity: 1; transform: translateY(-50%) translateX(0); }
.s-doc .di { font-size: 1.35rem; margin-bottom: 0.45rem; display: block; line-height: 1; }
.s-doc .dt { font-size: 0.88rem; font-weight: 700; color: var(--s-accent); margin-bottom: 0.25rem; display: block; }
.s-doc:hover .dt { color: var(--s-t1); }
.s-doc .dd { font-size: 0.78rem; color: var(--s-t2); line-height: 1.5; }

/* ══════════════════════════════════════════════════════════════════════════
   COMMUNITY / CTA BANNER
   ══════════════════════════════════════════════════════════════════════════ */
.s-cta-banner {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-xl); padding: 3.5rem 2rem;
  text-align: center; position: relative; overflow: hidden;
}
.s-cta-banner::before {
  content: '';
  position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(59,130,246,0.07) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
  pointer-events: none;
}
.s-cta-banner::after {
  content: '';
  position: absolute; top: -100px; left: 50%; transform: translateX(-50%);
  width: 600px; height: 400px;
  background: radial-gradient(ellipse, rgba(59,130,246,0.06) 0%, transparent 65%);
  pointer-events: none;
}
.s-cta-banner h2 {
  font-family: var(--s-fh); font-size: clamp(1.6rem, 4vw, 2.4rem);
  font-weight: 800; letter-spacing: -0.03em; line-height: 1.15;
  margin: 0 0 0.75rem; position: relative; z-index: 1;
}
.s-cta-banner p {
  font-size: 1rem; color: var(--s-t2); max-width: 480px;
  margin: 0 auto 2rem; line-height: 1.7; position: relative; z-index: 1;
}
.s-cta-links {
  display: flex; gap: 0.75rem; justify-content: center;
  flex-wrap: wrap; position: relative; z-index: 1;
}
.s-cta-link {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.6rem 1.2rem;
  background: var(--s-surface); border: 1px solid var(--s-border);
  border-radius: var(--s-r); font-size: 0.875rem; font-weight: 600;
  color: var(--s-t1) !important; text-decoration: none !important;
  transition: var(--s-t);
}
.s-cta-link:hover {
  border-color: rgba(59,130,246,0.25); background: rgba(59,130,246,0.05);
  transform: translateY(-2px); color: var(--s-accent) !important;
}

/* ══════════════════════════════════════════════════════════════════════════
   RESPONSIVE
   ══════════════════════════════════════════════════════════════════════════ */
@media (max-width: 640px) {
  .s-hero { padding: 4rem 1rem 3.5rem; }
  .s-hero h1 { font-size: 2.2rem; }
  .s-stats { grid-template-columns: repeat(3, 1fr); }
  .s-steps::before { display: none; }
  .s-why { padding: 2rem 1.25rem; }
  .s-cta-banner { padding: 2.5rem 1.25rem; }
}
@media (max-width: 420px) {
  .s-stats { grid-template-columns: repeat(2, 1fr); }
  .s-btn { padding: 0.65rem 1.1rem; font-size: 0.875rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>

<div class="sp">

<!-- ══════════════════════════════════════════════════════════════════════
     HERO
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-hero">
<div class="s-hero-inner">
  <div class="s-hero-pill"><span class="dot"></span>v1.0.5 · MIT · Node 20+ · TypeScript 5</div>
  <h1><span class="gt">Build TypeScript Backends<br>Without the Bloat</span></h1>
  <p class="s-hero-sub">Production-grade. Memory-safe. Native Node.js.<br>Every feature built from core modules — no Express, no pg, no Prisma.</p>
  <p class="s-hero-nodeps">
    <span>No Express</span> &nbsp;·&nbsp;
    <span>No pg</span> &nbsp;·&nbsp;
    <span>No Prisma</span> &nbsp;·&nbsp;
    <span>No jsonwebtoken</span> &nbsp;·&nbsp;
    <span>No bcrypt</span> &nbsp;·&nbsp;
    <span>No multer</span>
  </p>
  <div class="s-btns">
    <a href="{{ site.baseurl }}/getting-started/installation/" class="s-btn s-btn-primary">Get Started →</a>
    <a href="https://github.com/hassanmubiru/street" class="s-btn s-btn-ghost" target="_blank" rel="noopener">GitHub ↗</a>
    <a href="{{ site.baseurl }}/examples/" class="s-btn s-btn-ghost">Examples</a>
  </div>
  <div class="s-badges">
    <img src="https://img.shields.io/npm/v/@streetjs/core?label=%40streetjs%2Fcore&color=2563EB&style=flat-square" alt="core version">
    <img src="https://img.shields.io/npm/v/@streetjs/cli?label=%40streetjs%2Fcli&color=6366F1&style=flat-square" alt="cli version">
    <img src="https://img.shields.io/badge/node-%3E%3D20-22C55E?style=flat-square&logo=node.js&logoColor=white" alt="Node 20+">
    <img src="https://img.shields.io/badge/TypeScript-5.0%2B-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5+">
    <img src="https://img.shields.io/badge/deps-2-22C55E?style=flat-square" alt="2 deps">
    <img src="https://img.shields.io/badge/license-MIT-94A3B8?style=flat-square" alt="MIT">
    <img src="https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg" alt="CI">
  </div>
</div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     TERMINAL
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-term">
  <div class="s-term-bar">
    <div class="d" style="background:#EF4444"></div>
    <div class="d" style="background:#F59E0B"></div>
    <div class="d" style="background:#22C55E"></div>
    <span class="title">bash — Quick Start (60 seconds)</span>
  </div>
  <div class="s-term-body">
    <div><span class="p">$</span> <span class="c">npm install -g @streetjs/cli</span></div>
    <div><span class="cm"># installs the street CLI globally</span></div>
    <div><span class="p">$</span> <span class="c">street create my-api</span></div>
    <div><span class="cm"># scaffolds TypeScript project with PostgreSQL, JWT, Docker</span></div>
    <div><span class="p">$</span> <span class="c">cd my-api &amp;&amp; npm install &amp;&amp; street dev</span></div>
    <div><span class="ok">[street] Listening on http://0.0.0.0:3000 · Node 20 · ESM · OpenAPI at /openapi.json</span></div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     STATS
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-stats">
  <div class="s-stat"><span class="sv">2</span><span class="sl">Runtime Deps</span></div>
  <div class="s-stat"><span class="sv">PG v3</span><span class="sl">Wire Protocol</span></div>
  <div class="s-stat"><span class="sv">AES-256</span><span class="sl">Session Crypto</span></div>
  <div class="s-stat"><span class="sv">SCRAM</span><span class="sl">PG Auth</span></div>
  <div class="s-stat"><span class="sv">100K</span><span class="sl">IP Rate Cap</span></div>
  <div class="s-stat"><span class="sv">MIT</span><span class="sl">Open Source</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     HOW IT WORKS
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-section">
  <div class="s-eyebrow">How it works</div>
  <div class="s-h2">From scaffold to production in three steps.</div>
  <p class="s-sub">Street handles the infrastructure so you focus on your application logic.</p>
  <div class="s-steps">
    <div class="s-step">
      <div class="sn">1</div>
      <h3>Scaffold</h3>
      <p>Run <code>street create my-api</code> to generate a complete TypeScript project with PostgreSQL, JWT auth, Docker, and migrations pre-configured.</p>
    </div>
    <div class="s-step">
      <div class="sn">2</div>
      <h3>Build</h3>
      <p>Decorate your controllers and services. Street's IoC container wires dependencies automatically. OpenAPI spec is generated from your decorators.</p>
    </div>
    <div class="s-step">
      <div class="sn">3</div>
      <h3>Deploy</h3>
      <p>Run <code>docker build</code> with the included multi-stage Dockerfile. Cluster mode, health endpoints, and graceful shutdown are built in.</p>
    </div>
  </div>
</div>

</div><!-- end .sp — pause for markdown code block -->

<!-- ══════════════════════════════════════════════════════════════════════
     CODE EXAMPLE — unified window
     ══════════════════════════════════════════════════════════════════════ -->
<div class="sp s-section">
  <div class="s-eyebrow">Quick Example</div>
  <div class="s-h2">A complete production API. One file. No extra packages.</div>
  <p class="s-sub">PostgreSQL, JWT auth, rate limiting, and auto-generated OpenAPI — all from <code style="font-family:var(--s-fm);font-size:0.85em;background:rgba(59,130,246,0.08);color:var(--s-accent);padding:0.1em 0.4em;border-radius:4px">@streetjs/core</code>.</p>
  <div class="s-codewin">
    <div class="s-codewin-bar">
      <div class="d" style="background:#EF4444"></div>
      <div class="d" style="background:#F59E0B"></div>
      <div class="d" style="background:#22C55E"></div>
      <span class="fn">src/main.ts</span>
      <span class="lb">TypeScript</span>
    </div>
</div>

```typescript
import 'reflect-metadata';
import {
  streetApp, Injectable, Controller, Get, Post,
  PgPool, securityHeaders, corsMiddleware,
  RateLimiter, authMiddleware, JwtService, ApiOperation,
} from '@streetjs/core';
import type { StreetContext } from '@streetjs/core';

// ── Service ────────────────────────────────────────────────────────────────
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
      'INSERT INTO items (name) VALUES ($1) RETURNING *',
      [name]  // ← parameterized — SQL injection impossible
    );
    return rows[0];
  }
}

// ── Controller ─────────────────────────────────────────────────────────────
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

// ── Bootstrap ──────────────────────────────────────────────────────────────
const jwt     = new JwtService(process.env.JWT_SECRET!);
const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 100 });
const app     = streetApp({ port: 3000 });

app.use(securityHeaders);                              // CSP, HSTS, COOP, CORP
app.use(corsMiddleware(['https://app.example.com']));  // explicit origin allowlist
app.use(limiter.middleware());                         // sliding-window, 100K IP cap
app.use(authMiddleware(jwt));                          // HMAC-SHA256, alg enforcement
app.registerController(ItemController);

await app.listen();
// [street] Listening on http://0.0.0.0:3000
// [street] OpenAPI → http://0.0.0.0:3000/openapi.json
```

</div><!-- end .sp -->

<div class="sp">

<!-- ══════════════════════════════════════════════════════════════════════
     FEATURES
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-section">
  <div class="s-eyebrow">Core Capabilities</div>
  <div class="s-h2">Everything you need. Nothing you don't.</div>
  <p class="s-sub">Every feature is implemented directly from Node.js core modules with explicit memory bounds.</p>
  <div class="s-features">
    <div class="s-feat"><span class="fi">🔷</span><h3>TypeScript First</h3><p>Strict mode, NodeNext ESM, decorator metadata, full type inference. Zero <code>any</code> in the framework source. Your IDE knows everything.</p></div>
    <div class="s-feat"><span class="fi">🛡️</span><h3>Memory-Safe by Design</h3><p>Bounded body limits, connection pools, ring-buffer telemetry, LRU eviction, WebSocket caps. Every component has an explicit ceiling.</p></div>
    <div class="s-feat"><span class="fi">🐘</span><h3>Native PostgreSQL Driver</h3><p>Wire protocol v3 over <code>node:net</code>. SCRAM-SHA-256 auth. Streaming rows with socket-level backpressure. No <code>pg</code> dependency.</p></div>
    <div class="s-feat"><span class="fi">💉</span><h3>Dependency Injection</h3><p>IoC container with constructor injection, singleton registry, and circular dependency detection via <code>reflect-metadata</code>.</p></div>
    <div class="s-feat"><span class="fi">🔐</span><h3>Security Built-in</h3><p>JWT (HMAC-SHA256), AES-256-GCM sessions, scrypt vault, sliding-window rate limiter, XSS sanitizer, CSRF, CORS, CSP — all included.</p></div>
    <div class="s-feat"><span class="fi">⚡</span><h3>Real-Time Ready</h3><p>Bounded WebSocket server with heartbeat, typed event emitter, and SSE with keep-alive. Auth hook on upgrade. No socket.io needed.</p></div>
    <div class="s-feat"><span class="fi">📋</span><h3>OpenAPI 3.1 Auto-gen</h3><p>Spec generated from <code>@ApiOperation</code> decorators. Always in sync. Served at <code>/openapi.json</code>. No separate schema files.</p></div>
    <div class="s-feat"><span class="fi">🔄</span><h3>Clustering &amp; Telemetry</h3><p><code>node:cluster</code> coordinator with IPC heartbeat, auto-restart, graceful shutdown, and P50/P99 latency ring-buffer tracking.</p></div>
    <div class="s-feat"><span class="fi">🚀</span><h3>CLI Tooling</h3><p><code>street create</code>, <code>street dev</code>, <code>street generate</code>, <code>street migrate:create</code> — full project lifecycle from one binary.</p></div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     ZERO DEPS
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-section">
  <div class="s-eyebrow">Zero Bloat</div>
  <div class="s-h2">No third-party middleware stack.</div>
  <p class="s-sub">Two runtime dependencies total: <code style="font-family:var(--s-fm);font-size:0.85em;background:rgba(59,130,246,0.08);color:var(--s-accent);padding:0.1em 0.4em;border-radius:4px">reflect-metadata</code> and <code style="font-family:var(--s-fm);font-size:0.85em;background:rgba(59,130,246,0.08);color:var(--s-accent);padding:0.1em 0.4em;border-radius:4px">ws</code>. Everything else ships with Node.js.</p>
  <div class="s-nodeps">
    <div class="s-nd"><span class="x">✕</span><span class="ar">→</span><div><strong>No Express / Fastify</strong><span>Native <code>node:http</code> server with compiled-regex router and middleware pipeline</span></div></div>
    <div class="s-nd"><span class="x">✕</span><span class="ar">→</span><div><strong>No pg / postgres.js</strong><span>PostgreSQL wire protocol v3 over <code>node:net</code> with SCRAM-SHA-256 auth</span></div></div>
    <div class="s-nd"><span class="x">✕</span><span class="ar">→</span><div><strong>No Prisma / Zod</strong><span>Parameterized queries + <code>@Validate</code> decorator for runtime type checking</span></div></div>
    <div class="s-nd"><span class="x">✕</span><span class="ar">→</span><div><strong>No jsonwebtoken</strong><span>HMAC-SHA256 via <code>node:crypto</code> with <code>timingSafeEqual</code> comparison</span></div></div>
    <div class="s-nd"><span class="x">✕</span><span class="ar">→</span><div><strong>No bcrypt / argon2</strong><span>scrypt via <code>node:crypto</code> — memory-hard, battle-tested password hashing</span></div></div>
    <div class="s-nd"><span class="x">✕</span><span class="ar">→</span><div><strong>No multer / busboy</strong><span>Streaming multipart parser — ≤128 KB heap per upload, disk-streamed</span></div></div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     WHY STREET
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-section">
  <div class="s-why">
    <div class="s-eyebrow">Why Street</div>
    <div class="s-h2">Built for developers who care about what runs in production.</div>
    <p class="s-sub" style="margin-bottom:0">Most Node.js frameworks layer abstractions on top of abstractions. Street takes the opposite approach: implement each component directly on Node.js core, enforce strict memory bounds, and expose a clean TypeScript API. The result is a framework where you can read and understand every line of the runtime.</p>
    <div class="s-why-grid">
      <div class="s-why-item"><span class="wi-num">01</span><h4>Auditable dependency tree</h4><p>Two runtime dependencies means two CVE surfaces. You can audit the entire framework in an afternoon.</p></div>
      <div class="s-why-item"><span class="wi-num">02</span><h4>No silent memory leaks</h4><p>Every collection, buffer, and connection has an explicit bound. Heap growth is predictable and configurable.</p></div>
      <div class="s-why-item"><span class="wi-num">03</span><h4>Security is not a plugin</h4><p>JWT, sessions, rate limiting, XSS, CSRF, CORS, CSP, and vault encryption are built in — not bolted on.</p></div>
      <div class="s-why-item"><span class="wi-num">04</span><h4>TypeScript all the way down</h4><p>Strict mode, NodeNext ESM, decorator metadata. No <code>any</code> in the framework source. Your IDE knows everything.</p></div>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     MEMORY BOUNDS
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-section">
  <div class="s-eyebrow">Memory Safety</div>
  <div class="s-h2">Every component has explicit bounds.</div>
  <p class="s-sub">No unbounded collections. No silent memory leaks. Every limit is documented, configurable, and enforced at runtime.</p>
  <div class="s-tbl-wrap">
    <table class="s-tbl">
      <thead><tr><th>Component</th><th>Default Bound</th><th>Enforcement Mechanism</th></tr></thead>
      <tbody>
        <tr><td>HTTP request body</td><td>1 MB</td><td>Stream abort on overflow — configurable via <code>bodyLimit</code></td></tr>
        <tr><td>File uploads</td><td>Disk-streamed</td><td>Chunk-by-chunk streaming, ≤128 KB heap per upload</td></tr>
        <tr><td>DB result buffer</td><td>256 rows</td><td>Socket-level backpressure, streaming cursor API</td></tr>
        <tr><td>LRU cache</td><td><code>maxEntries</code> cap</td><td>O(1) LRU eviction on insert when full</td></tr>
        <tr><td>Rate limiter</td><td>100K IPs · 1K timestamps/IP</td><td>Periodic stale-entry sweep, configurable TTL</td></tr>
        <tr><td>Telemetry history</td><td>1,440 samples</td><td>Ring buffer — oldest sample overwritten</td></tr>
        <tr><td>WebSocket connections</td><td><code>maxConnections</code></td><td>Reject with close code 1013 (Try Again Later)</td></tr>
        <tr><td>Connection pool</td><td><code>maxConnections</code></td><td>Bounded acquire queue with configurable timeout</td></tr>
        <tr><td>Auth buffer (wire)</td><td>64 KB</td><td>Hard cap during PostgreSQL authentication phase</td></tr>
      </tbody>
    </table>
  </div>
</div>

</div><!-- end .sp -->

<div class="sp">

<!-- ══════════════════════════════════════════════════════════════════════
     COMPARISON
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-section">
  <div class="s-eyebrow">Comparison</div>
  <div class="s-h2">General-purpose. Production-grade.</div>
  <p class="s-sub">Street is comparable in scope to Express, NestJS, Spring Boot, and ASP.NET Core — with a security-first, memory-conscious design and a fraction of the dependency surface.</p>
  <div class="s-cmp">
    <div class="s-cmp-card">
      <div class="cv">vs</div><div class="cf">Express</div>
      <ul>
        <li>TypeScript-first, not bolted on</li>
        <li>Explicit memory bounds</li>
        <li>Built-in security layer</li>
        <li>Native PostgreSQL driver</li>
      </ul>
    </div>
    <div class="s-cmp-card">
      <div class="cv">vs</div><div class="cf">Fastify</div>
      <ul>
        <li>Built-in auth &amp; sessions</li>
        <li>WebSocket + SSE included</li>
        <li>Native PostgreSQL — no plugin</li>
        <li>2 deps, not a plugin ecosystem</li>
      </ul>
    </div>
    <div class="s-cmp-card">
      <div class="cv">vs</div><div class="cf">NestJS</div>
      <ul>
        <li>Lighter DI — no class-validator</li>
        <li>Native wire protocol, not TypeORM</li>
        <li>2 runtime deps total</li>
        <li>Faster cold start</li>
      </ul>
    </div>
    <div class="s-cmp-card">
      <div class="cv">vs</div><div class="cf">Spring Boot</div>
      <ul>
        <li>Same production depth</li>
        <li>Node.js ecosystem &amp; npm</li>
        <li>Faster cold start, less RAM</li>
        <li>TypeScript type safety</li>
      </ul>
    </div>
    <div class="s-cmp-card">
      <div class="cv">vs</div><div class="cf">Laravel</div>
      <ul>
        <li>Statically typed end-to-end</li>
        <li>Memory-safe, no ORM overhead</li>
        <li>Native async/await</li>
        <li>Horizontal scaling via clustering</li>
      </ul>
    </div>
    <div class="s-cmp-card">
      <div class="cv">vs</div><div class="cf">Django</div>
      <ul>
        <li>Async-native, no GIL</li>
        <li>TypeScript types everywhere</li>
        <li>Horizontal scaling via clustering</li>
        <li>Single language full-stack</li>
      </ul>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     ROADMAP PREVIEW
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-section">
  <div class="s-eyebrow">Roadmap</div>
  <div class="s-h2">What's coming next.</div>
  <p class="s-sub">Street is actively developed. <a href="{{ site.baseurl }}/roadmap/" style="color:var(--s-accent);text-decoration:none">View the full roadmap →</a></p>
  <div class="s-roadmap">
    <div class="s-rm-card s-rm-done">
      <div class="rv">v1.0 · Shipped ✓</div>
      <div class="rt">Foundation</div>
      <div class="rq">Released 2026</div>
      <ul>
        <li>HTTP server, router, DI container</li>
        <li>PostgreSQL wire driver + pool</li>
        <li>JWT, sessions, vault, rate limiter</li>
        <li>WebSocket, SSE, clustering, CLI</li>
      </ul>
    </div>
    <div class="s-rm-card">
      <div class="rv">v1.1 · Q3 2026</div>
      <div class="rt">Developer Experience</div>
      <div class="rq">Target: Q3 2026</div>
      <ul>
        <li>Hot-reload via <code>node --watch</code></li>
        <li><code>street generate middleware</code></li>
        <li><code>street generate gateway</code></li>
        <li>Better startup error messages</li>
      </ul>
    </div>
    <div class="s-rm-card">
      <div class="rv">v1.2 · Q4 2026</div>
      <div class="rt">Database</div>
      <div class="rq">Target: Q4 2026</div>
      <ul>
        <li>MySQL/MariaDB wire driver</li>
        <li>SQLite via <code>node:sqlite</code></li>
        <li>Type-safe query builder</li>
        <li>Schema introspection</li>
      </ul>
    </div>
    <div class="s-rm-card">
      <div class="rv">v1.3 · Q1 2027</div>
      <div class="rt">Observability</div>
      <div class="rq">Target: Q1 2027</div>
      <ul>
        <li>OpenTelemetry integration</li>
        <li>Structured JSON logging</li>
        <li>Prometheus metrics endpoint</li>
        <li>W3C traceparent propagation</li>
      </ul>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     DOCUMENTATION GRID
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-section">
  <div class="s-eyebrow">Documentation</div>
  <div class="s-h2">Everything you need to ship.</div>
  <p class="s-sub">Comprehensive guides, API references, and real-world examples for every part of the framework.</p>
  <div class="s-docs">
    <a href="{{ site.baseurl }}/getting-started/installation/" class="s-doc">
      <span class="di">🚀</span><span class="dt">Getting Started</span>
      <span class="dd">Install, scaffold, configure, and run your first API in 60 seconds</span>
    </a>
    <a href="{{ site.baseurl }}/core/controllers/" class="s-doc">
      <span class="di">🎮</span><span class="dt">Controllers</span>
      <span class="dd">HTTP handlers, routing, context API, request validation</span>
    </a>
    <a href="{{ site.baseurl }}/core/dependency-injection/" class="s-doc">
      <span class="di">💉</span><span class="dt">Dependency Injection</span>
      <span class="dd">IoC container, constructor injection, singleton registry</span>
    </a>
    <a href="{{ site.baseurl }}/database/postgres-wire-driver/" class="s-doc">
      <span class="di">🐘</span><span class="dt">PostgreSQL</span>
      <span class="dd">Wire driver, connection pool, repositories, migrations</span>
    </a>
    <a href="{{ site.baseurl }}/security/" class="s-doc">
      <span class="di">🔐</span><span class="dt">Security</span>
      <span class="dd">JWT, sessions, rate limiting, XSS sanitizer, vault, CSRF</span>
    </a>
    <a href="{{ site.baseurl }}/realtime/websocket/" class="s-doc">
      <span class="di">⚡</span><span class="dt">Real-Time</span>
      <span class="dd">WebSocket server, SSE, typed events, heartbeat, auth hook</span>
    </a>
    <a href="{{ site.baseurl }}/deployment/docker/" class="s-doc">
      <span class="di">🐳</span><span class="dt">Deployment</span>
      <span class="dd">Docker, production config, environment variables, hosting</span>
    </a>
    <a href="{{ site.baseurl }}/examples/" class="s-doc">
      <span class="di">📦</span><span class="dt">Examples</span>
      <span class="dd">REST API, WebSocket chat, file upload, full auth flow</span>
    </a>
    <a href="{{ site.baseurl }}/use-cases/" class="s-doc">
      <span class="di">🌍</span><span class="dt">Use Cases</span>
      <span class="dd">16 industry verticals — fintech, IoT, AI, gaming, and more</span>
    </a>
    <a href="{{ site.baseurl }}/cli/commands/" class="s-doc">
      <span class="di">🛠️</span><span class="dt">CLI Reference</span>
      <span class="dd">All street commands, flags, and options documented</span>
    </a>
    <a href="{{ site.baseurl }}/testing/" class="s-doc">
      <span class="di">🧪</span><span class="dt">Testing</span>
      <span class="dd">Integration tests, test runner, real PostgreSQL test setup</span>
    </a>
    <a href="{{ site.baseurl }}/faq/" class="s-doc">
      <span class="di">❓</span><span class="dt">FAQ</span>
      <span class="dd">Common questions, migration guides, and troubleshooting</span>
    </a>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     PACKAGES
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-section">
  <div class="s-eyebrow">Packages</div>
  <div class="s-h2">Two packages. One framework.</div>
  <div class="s-tbl-wrap">
    <table class="s-tbl">
      <thead><tr><th>Package</th><th>Version</th><th>Description</th></tr></thead>
      <tbody>
        <tr>
          <td><a href="https://www.npmjs.com/package/@streetjs/core" target="_blank" rel="noopener" style="color:var(--s-accent);text-decoration:none"><code>@streetjs/core</code></a></td>
          <td><a href="https://www.npmjs.com/package/@streetjs/core" target="_blank" rel="noopener"><img src="https://img.shields.io/npm/v/@streetjs/core?style=flat-square&color=2563EB" alt="npm"></a></td>
          <td>Framework runtime — HTTP, router, DI, PostgreSQL, security, WebSocket, SSE, clustering, telemetry</td>
        </tr>
        <tr>
          <td><a href="https://www.npmjs.com/package/@streetjs/cli" target="_blank" rel="noopener" style="color:var(--s-accent);text-decoration:none"><code>@streetjs/cli</code></a></td>
          <td><a href="https://www.npmjs.com/package/@streetjs/cli" target="_blank" rel="noopener"><img src="https://img.shields.io/npm/v/@streetjs/cli?style=flat-square&color=6366F1" alt="npm"></a></td>
          <td>CLI — project scaffolding, code generation, dev server with hot-reload, migration management</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     COMMUNITY CTA BANNER
     ══════════════════════════════════════════════════════════════════════ -->
<div class="s-cta-banner">
  <h2><span class="gt">Built in the open.<br>Improved together.</span></h2>
  <p>Street is MIT-licensed and actively developed. Bug reports, feature requests, and contributions are welcome from everyone.</p>
  <div class="s-cta-links">
    <a href="https://github.com/hassanmubiru/street" class="s-cta-link" target="_blank" rel="noopener">⭐ Star on GitHub</a>
    <a href="https://github.com/hassanmubiru/street/issues" class="s-cta-link" target="_blank" rel="noopener">🐛 Report a Bug</a>
    <a href="https://github.com/hassanmubiru/street/discussions" class="s-cta-link" target="_blank" rel="noopener">💬 Discussions</a>
    <a href="{{ site.baseurl }}/contributing/" class="s-cta-link">🤝 Contribute</a>
    <a href="{{ site.baseurl }}/changelog/" class="s-cta-link">📋 Changelog</a>
    <a href="{{ site.baseurl }}/roadmap/" class="s-cta-link">🗺️ Roadmap</a>
  </div>
</div>

</div><!-- end .sp -->
