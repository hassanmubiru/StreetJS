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
   STREET FRAMEWORK — 10/10 DESIGN SYSTEM
   Electric Blue #2563EB + Indigo #6366F1
   Inter 400–900 · JetBrains Mono 400–500
   ═══════════════════════════════════════════════════════════════════════════ */
:root {
  --s-blue:        #2563EB;
  --s-blue-h:      #1D4ED8;
  --s-blue-a:      #1E40AF;
  --s-indigo:      #6366F1;
  --s-indigo-h:    #4F46E5;
  --s-sky:         #38BDF8;
  --s-sky-dim:     #0EA5E9;
  --s-green:       #22C55E;
  --s-amber:       #F59E0B;
  --s-red:         #EF4444;
  --s-purple:      #A855F7;

  --s-bg:          #060B18;
  --s-bg2:         #0A0F1E;
  --s-surface:     #0D1526;
  --s-card:        #111827;
  --s-card-h:      #162035;
  --s-border:      #1E2D4A;
  --s-border-h:    #2563EB;
  --s-border-dim:  #162035;

  --s-t1:          #F8FAFC;
  --s-t2:          #94A3B8;
  --s-t3:          #475569;
  --s-t4:          #334155;

  --s-r-sm:        6px;
  --s-r:           12px;
  --s-r-lg:        18px;
  --s-r-xl:        24px;

  --s-fh:          'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --s-fb:          'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --s-fm:          'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;

  --s-ease:        cubic-bezier(0.4, 0, 0.2, 1);
  --s-t:           all 0.2s var(--s-ease);

  --s-sh-blue:     0 4px 24px rgba(37,99,235,0.28);
  --s-sh-lg:       0 8px 40px rgba(0,0,0,0.7);
  --s-sh-glow:     0 0 60px rgba(37,99,235,0.12);
  --s-sh-card:     0 2px 12px rgba(0,0,0,0.5);
}

.sp * { box-sizing: border-box; }
.sp { font-family: var(--s-fb); color: var(--s-t1); line-height: 1.6; }

/* ── Gradient text ─────────────────────────────────────────────────────── */
.gt {
  background: linear-gradient(135deg, #F8FAFC 0%, #93C5FD 40%, #818CF8 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}
.gt-blue {
  background: linear-gradient(135deg, #60A5FA 0%, #38BDF8 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ── Section chrome ────────────────────────────────────────────────────── */
.s-eyebrow {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.14em; color: var(--s-sky);
  background: rgba(56,189,248,0.08); border: 1px solid rgba(56,189,248,0.2);
  border-radius: 100px; padding: 0.28rem 0.85rem; margin-bottom: 0.75rem;
}
.s-h2 {
  font-family: var(--s-fh); font-size: clamp(1.6rem, 3.5vw, 2.2rem);
  font-weight: 800; letter-spacing: -0.03em; line-height: 1.15;
  color: var(--s-t1); margin: 0 0 0.6rem;
}
.s-sub {
  font-size: 1rem; color: var(--s-t2); line-height: 1.7;
  margin: 0 0 2.5rem; max-width: 600px;
}
.s-section { margin-bottom: 5rem; }
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
  background-image: radial-gradient(circle, rgba(37,99,235,0.18) 1px, transparent 1px);
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
    radial-gradient(ellipse at 35% 45%, rgba(37,99,235,0.22) 0%, transparent 50%),
    radial-gradient(ellipse at 65% 55%, rgba(99,102,241,0.16) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 80%, rgba(56,189,248,0.08) 0%, transparent 50%);
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
  background: rgba(37,99,235,0.1); border: 1px solid rgba(37,99,235,0.28);
  border-radius: 100px; padding: 0.3rem 1rem;
  font-size: 0.78rem; font-weight: 600; color: var(--s-sky);
  letter-spacing: 0.05em; text-transform: uppercase;
  margin-bottom: 1.75rem;
}
.s-hero-pill .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--s-green);
  box-shadow: 0 0 8px var(--s-green);
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
.s-hero-nodeps span { color: var(--s-sky); }

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
  box-shadow: 0 8px 32px rgba(37,99,235,0.45), inset 0 1px 0 rgba(255,255,255,0.1);
}
.s-btn-ghost {
  background: rgba(255,255,255,0.04); color: var(--s-t1) !important;
  border: 1px solid var(--s-border);
  backdrop-filter: blur(8px);
}
.s-btn-ghost:hover {
  background: rgba(255,255,255,0.08);
  border-color: rgba(37,99,235,0.5);
  transform: translateY(-2px);
  color: var(--s-sky) !important;
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
.s-term-body .p  { color: var(--s-green); user-select: none; }
.s-term-body .c  { color: var(--s-t1); }
.s-term-body .cm { color: var(--s-t3); font-style: italic; }
.s-term-body .ok { color: var(--s-sky); }

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
  color: var(--s-sky); line-height: 1; margin-bottom: 0.35rem;
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
  background: linear-gradient(135deg, var(--s-blue), var(--s-indigo));
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
  background: rgba(37,99,235,0.12); color: var(--s-sky);
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
  background: linear-gradient(90deg, var(--s-blue), var(--s-indigo), var(--s-sky));
  opacity: 0; transition: var(--s-t);
}
.s-feat:hover {
  border-color: rgba(37,99,235,0.5);
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
  background: rgba(56,189,248,0.1); color: var(--s-sky);
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
.s-nd:hover { border-color: rgba(37,99,235,0.4); background: var(--s-card-h); }
.s-nd .x { color: var(--s-red); font-weight: 800; font-size: 0.85rem; margin-top: 2px; }
.s-nd .ar { color: var(--s-green); font-weight: 700; font-size: 0.85rem; margin-top: 2px; }
.s-nd strong { display: block; color: var(--s-t1); font-size: 0.88rem; font-weight: 600; margin-bottom: 0.2rem; }
.s-nd span { color: var(--s-t2); font-size: 0.8rem; line-height: 1.5; }
.s-nd code {
  font-family: var(--s-fm); font-size: 0.77rem;
  background: rgba(56,189,248,0.1); color: var(--s-sky);
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
  background: rgba(37,99,235,0.15); color: var(--s-sky);
  padding: 0.15rem 0.55rem; border-radius: 4px;
  border: 1px solid rgba(37,99,235,0.25);
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
  background: radial-gradient(ellipse, rgba(99,102,241,0.1) 0%, transparent 65%);
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
  color: rgba(37,99,235,0.2); line-height: 1; margin-bottom: 0.5rem;
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
.s-tbl tr:hover td { background: rgba(37,99,235,0.04); }
.s-tbl td:first-child { color: var(--s-t1); font-weight: 500; }
.s-tbl td:nth-child(2) {
  font-family: var(--s-fm); font-size: 0.82rem; color: var(--s-sky);
}
.s-tbl code {
  font-family: var(--s-fm); font-size: 0.8rem;
  background: rgba(56,189,248,0.1); color: var(--s-sky);
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
  border-color: rgba(37,99,235,0.4); background: var(--s-card-h);
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
  color: var(--s-green); font-size: 0.72rem; font-weight: 700;
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
.s-rm-card:hover { border-color: rgba(37,99,235,0.4); background: var(--s-card-h); }
.s-rm-card .rv {
  font-family: var(--s-fm); font-size: 0.72rem; font-weight: 700;
  color: var(--s-sky); text-transform: uppercase; letter-spacing: 0.1em;
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
  color: var(--s-indigo); font-size: 0.75rem;
}
.s-rm-done { border-color: rgba(34,197,94,0.2) !important; }
.s-rm-done .rv { color: var(--s-green) !important; }
.s-rm-done li::before { content: '✓'; color: var(--s-green) !important; }

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
  border-color: rgba(37,99,235,0.5); background: var(--s-card-h);
  transform: translateY(-2px); box-shadow: var(--s-sh-blue);
  text-decoration: none !important;
}
.s-doc:hover::after { opacity: 1; transform: translateY(-50%) translateX(0); }
.s-doc .di { font-size: 1.35rem; margin-bottom: 0.45rem; display: block; line-height: 1; }
.s-doc .dt { font-size: 0.88rem; font-weight: 700; color: var(--s-sky); margin-bottom: 0.25rem; display: block; }
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
  background-image: radial-gradient(circle, rgba(37,99,235,0.12) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
  pointer-events: none;
}
.s-cta-banner::after {
  content: '';
  position: absolute; top: -100px; left: 50%; transform: translateX(-50%);
  width: 600px; height: 400px;
  background: radial-gradient(ellipse, rgba(99,102,241,0.12) 0%, transparent 65%);
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
  border-color: rgba(37,99,235,0.5); background: rgba(37,99,235,0.08);
  transform: translateY(-2px); color: var(--s-sky) !important;
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
