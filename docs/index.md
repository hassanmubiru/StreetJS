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
/* ═══════════════════════════════════════════════════════════════════════
   STREET — RESTRAINED MONOCHROMATIC PALETTE
   Single accent: #3B82F6 (blue-500), used sparingly
   Linear / Vercel / Raycast aesthetic
   ═══════════════════════════════════════════════════════════════════════ */
:root {
  --s-blue:      #3B82F6;
  --s-blue-h:    #2563EB;
  --s-blue-a:    #1D4ED8;
  --s-sky:       #93B4D4;

  --s-bg:        #080C14;
  --s-surface:   #0C1220;
  --s-card:      #101828;
  --s-card-h:    #141F30;
  --s-border:    #1C2A3E;

  --s-t1:        #C8D3E0;
  --s-t2:        #5A6A80;
  --s-t3:        #3A4A5E;

  --s-r-sm:      6px;
  --s-r:         12px;
  --s-r-lg:      16px;
  --s-r-xl:      20px;

  --s-fh:        'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --s-fm:        'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
  --s-ease:      cubic-bezier(0.4, 0, 0.2, 1);
  --s-t:         all 0.2s var(--s-ease);

  --s-sh-blue:   0 4px 20px rgba(59,130,246,0.18);
  --s-sh-lg:     0 8px 40px rgba(0,0,0,0.8);
  --s-sh-card:   0 2px 8px rgba(0,0,0,0.6);
}
</style>

<style>
.sp * { box-sizing: border-box; }
.sp { font-family: var(--s-fh); color: var(--s-t1); line-height: 1.6; }

/* Gradient text — subtle slate-to-blue, not rainbow */
.gt {
  background: linear-gradient(135deg, #C8D3E0 0%, #8BA3C0 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Section eyebrow labels */
.s-eyebrow {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.14em; color: var(--s-blue);
  background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.12);
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
/* ═══════════════════════════════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════════════════════════════ */
.s-hero {
  position: relative; text-align: center;
  padding: 6rem 1.5rem 5rem; margin-bottom: 0;
  overflow: hidden; background: var(--s-bg);
  border: 1px solid var(--s-border); border-radius: var(--s-r-xl);
}
/* Dot grid — barely visible */
.s-hero::before {
  content: '';
  position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(59,130,246,0.06) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 100%);
  pointer-events: none;
}
/* Single glow — not two competing orbs */
.s-hero::after {
  content: '';
  position: absolute; top: -200px; left: 50%; transform: translateX(-50%);
  width: 800px; height: 500px;
  background: radial-gradient(ellipse at 50% 50%, rgba(59,130,246,0.08) 0%, transparent 65%);
  pointer-events: none;
}
.s-hero-inner { position: relative; z-index: 1; }
</style>

<style>
/* Hero pill — blue border only */
.s-hero-pill {
  display: inline-flex; align-items: center; gap: 0.5rem;
  background: rgba(59,130,246,0.06); border: 1px solid var(--s-blue);
  border-radius: 100px; padding: 0.3rem 1rem;
  font-size: 0.78rem; font-weight: 600; color: var(--s-accent);
  letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 1.75rem;
}
.s-hero-pill .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--s-blue); box-shadow: 0 0 8px rgba(59,130,246,0.5);
  animation: blink 2.5s ease-in-out infinite;
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.s-hero h1 {
  font-family: var(--s-fh); font-size: clamp(2.6rem, 7vw, 4.8rem);
  font-weight: 900; letter-spacing: -0.05em; line-height: 1.04; margin: 0 0 1.5rem;
}
.s-hero-sub {
  font-size: clamp(1.05rem, 2.5vw, 1.25rem); color: var(--s-t2);
  line-height: 1.7; max-width: 580px; margin: 0 auto 0.75rem;
}
.s-hero-nodeps {
  font-family: var(--s-fm); font-size: 0.82rem;
  color: var(--s-t3); letter-spacing: 0.03em; margin-bottom: 2.5rem;
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
  text-decoration: none !important; transition: var(--s-t);
  white-space: nowrap; position: relative; overflow: hidden;
}
/* Primary CTA — blue accent */
.s-btn-primary {
  background: var(--s-blue); color: #fff !important;
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: var(--s-sh-blue), inset 0 1px 0 rgba(255,255,255,0.08);
}
.s-btn-primary:hover {
  background: var(--s-blue-h); transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(59,130,246,0.22);
}
.s-btn-ghost {
  background: rgba(255,255,255,0.03); color: var(--s-t1) !important;
  border: 1px solid var(--s-border);
}
.s-btn-ghost:hover {
  background: rgba(255,255,255,0.06);
  border-color: rgba(59,130,246,0.25);
  transform: translateY(-2px); color: var(--s-accent) !important;
}
.s-badges { display: flex; gap: 0.4rem; justify-content: center; flex-wrap: wrap; }
</style>

<style>
/* ═══════════════════════════════════════════════════════════════════════
   TERMINAL — dots all grey, no red/yellow/green
   ═══════════════════════════════════════════════════════════════════════ */
.s-term {
  background: #060A12; border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); overflow: hidden;
  box-shadow: var(--s-sh-lg); margin: 2.5rem 0;
}
.s-term-bar {
  background: #0A1220; border-bottom: 1px solid var(--s-border);
  padding: 0.65rem 1.1rem; display: flex; align-items: center; gap: 0.45rem;
}
/* All three dots: neutral dark grey — no red/yellow/green */
.s-term-bar .d { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; background: #3A4A5E; }
.s-term-bar .title {
  font-family: var(--s-fm); font-size: 0.73rem;
  color: var(--s-t3); margin-left: 0.5rem; flex: 1; text-align: center;
}
.s-term-body {
  padding: 1.4rem 1.6rem; font-family: var(--s-fm);
  font-size: 0.88rem; line-height: 2.1;
}
.s-term-body .p  { color: var(--s-blue); user-select: none; }
.s-term-body .c  { color: var(--s-t1); }
.s-term-body .cm { color: var(--s-t3); font-style: italic; }
.s-term-body .ok { color: var(--s-accent); }

/* ═══════════════════════════════════════════════════════════════════════
   STAT BAR — values in muted blue #93B4D4
   ═══════════════════════════════════════════════════════════════════════ */
.s-stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 1px; background: var(--s-border);
  border: 1px solid var(--s-border); border-radius: var(--s-r-lg);
  overflow: hidden; margin: 2.5rem 0;
}
.s-stat { background: var(--s-surface); padding: 1.4rem 1rem; text-align: center; transition: var(--s-t); }
.s-stat:hover { background: var(--s-card); }
.s-stat .sv {
  font-family: var(--s-fm); font-size: 1.5rem; font-weight: 700;
  color: #93B4D4; line-height: 1; margin-bottom: 0.35rem; display: block;
}
.s-stat .sl { font-size: 0.75rem; color: var(--s-t3); text-transform: uppercase; letter-spacing: 0.08em; }
</style>

<style>
/* ═══════════════════════════════════════════════════════════════════════
   HOW IT WORKS — step numbers: blue only, no gradient
   ═══════════════════════════════════════════════════════════════════════ */
.s-steps {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem; margin-bottom: 0; position: relative;
}
.s-steps::before {
  content: '';
  position: absolute; top: 2.2rem; left: 15%; right: 15%; height: 1px;
  background: linear-gradient(90deg, transparent, var(--s-border), rgba(59,130,246,0.3), var(--s-border), transparent);
  pointer-events: none;
}
.s-step {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.75rem 1.5rem;
  text-align: center; transition: var(--s-t); position: relative;
}
.s-step:hover {
  border-color: rgba(59,130,246,0.25); transform: translateY(-4px);
  box-shadow: var(--s-sh-blue);
}
/* Step number: solid blue, no gradient */
.s-step .sn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--s-blue);
  font-size: 1.1rem; font-weight: 800; color: #fff;
  margin: 0 auto 1rem; box-shadow: var(--s-sh-blue);
}
.s-step h3 { font-size: 1rem; font-weight: 700; color: var(--s-t1); margin: 0 0 0.5rem; letter-spacing: -0.01em; }
.s-step p  { font-size: 0.875rem; color: var(--s-t2); margin: 0; line-height: 1.65; }
.s-step code {
  font-family: var(--s-fm); font-size: 0.8rem;
  background: rgba(59,130,246,0.08); color: #93B4D4;
  padding: 0.1em 0.35em; border-radius: 4px;
}
</style>

<style>
/* ═══════════════════════════════════════════════════════════════════════
   FEATURE GRID — no top gradient bar
   ═══════════════════════════════════════════════════════════════════════ */
.s-features {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem; margin-bottom: 0;
}
.s-feat {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.6rem;
  transition: var(--s-t); position: relative;
}
/* No top gradient bar — clean flat card */
.s-feat:hover {
  border-color: rgba(59,130,246,0.2); background: var(--s-card-h);
  transform: translateY(-3px); box-shadow: var(--s-sh-blue), var(--s-sh-card);
}
.s-feat .fi { font-size: 1.8rem; margin-bottom: 0.9rem; display: block; line-height: 1; }
.s-feat h3  { font-size: 1rem; font-weight: 700; color: var(--s-t1); margin: 0 0 0.5rem; letter-spacing: -0.01em; }
.s-feat p   { font-size: 0.875rem; color: var(--s-t2); margin: 0; line-height: 1.65; }
.s-feat code {
  font-family: var(--s-fm); font-size: 0.8rem;
  background: rgba(59,130,246,0.08); color: #93B4D4;
  padding: 0.1em 0.35em; border-radius: 4px;
}
</style>

<style>
/* ═══════════════════════════════════════════════════════════════════════
   ZERO DEPS — neutral › arrow in blue, no red ✕ or green →
   ═══════════════════════════════════════════════════════════════════════ */
.s-nodeps {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
  gap: 0.75rem;
}
.s-nd {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r); padding: 1rem 1.25rem;
  display: grid; grid-template-columns: 1.1rem 1fr;
  align-items: start; gap: 0.75rem; transition: var(--s-t);
}
.s-nd:hover { border-color: rgba(59,130,246,0.2); background: var(--s-card-h); }
/* Neutral › in blue — replaces red ✕ and green → */
.s-nd .ar { color: var(--s-blue); font-weight: 700; font-size: 0.9rem; margin-top: 2px; }
.s-nd strong { display: block; color: var(--s-t1); font-size: 0.88rem; font-weight: 600; margin-bottom: 0.2rem; }
.s-nd span   { color: var(--s-t2); font-size: 0.8rem; line-height: 1.5; }
.s-nd code {
  font-family: var(--s-fm); font-size: 0.77rem;
  background: rgba(59,130,246,0.08); color: #93B4D4;
  padding: 0.1em 0.3em; border-radius: 3px;
}

/* ═══════════════════════════════════════════════════════════════════════
   CODE WINDOW — dots all grey
   ═══════════════════════════════════════════════════════════════════════ */
.s-codewin {
  background: #060A12; border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); overflow: hidden;
  box-shadow: var(--s-sh-lg); margin-bottom: 0;
}
.s-codewin-bar {
  background: #0A1220; border-bottom: 1px solid var(--s-border);
  padding: 0.7rem 1.25rem; display: flex; align-items: center; gap: 0.45rem;
}
.s-codewin-bar .d { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; background: #3A4A5E; }
.s-codewin-bar .fn { font-family: var(--s-fm); font-size: 0.75rem; color: var(--s-t3); margin-left: 0.5rem; }
.s-codewin-bar .lb {
  margin-left: auto; font-size: 0.68rem; font-weight: 700;
  background: rgba(59,130,246,0.08); color: #93B4D4;
  padding: 0.15rem 0.55rem; border-radius: 4px;
  border: 1px solid rgba(59,130,246,0.12);
  text-transform: uppercase; letter-spacing: 0.07em;
}
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
/* ═══════════════════════════════════════════════════════════════════════
   WHY STREET — numbers very faint blue
   ═══════════════════════════════════════════════════════════════════════ */
.s-why {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-xl); padding: 3rem 2.5rem;
  position: relative; overflow: hidden;
}
.s-why::before {
  content: '';
  position: absolute; top: -80px; right: -80px;
  width: 400px; height: 400px;
  background: radial-gradient(ellipse, rgba(59,130,246,0.05) 0%, transparent 65%);
  pointer-events: none;
}
.s-why-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 2rem; margin-top: 2rem;
}
.s-why-item { position: relative; }
/* Very faint number — rgba(59,130,246,0.15) */
.s-why-item .wi-num {
  font-family: var(--s-fm); font-size: 2.5rem; font-weight: 700;
  color: rgba(59,130,246,0.15); line-height: 1; margin-bottom: 0.5rem; display: block;
}
.s-why-item h4 { font-size: 1rem; font-weight: 700; color: var(--s-t1); margin: 0 0 0.4rem; letter-spacing: -0.01em; }
.s-why-item p  { font-size: 0.875rem; color: var(--s-t2); margin: 0; line-height: 1.65; }
.s-why-item code {
  font-family: var(--s-fm); font-size: 0.8rem;
  background: rgba(59,130,246,0.08); color: #93B4D4;
  padding: 0.1em 0.35em; border-radius: 4px;
}

/* ═══════════════════════════════════════════════════════════════════════
   MEMORY TABLE
   ═══════════════════════════════════════════════════════════════════════ */
.s-tbl-wrap {
  overflow-x: auto; border-radius: var(--s-r-lg);
  border: 1px solid var(--s-border); box-shadow: var(--s-sh-card);
}
.s-tbl { width: 100%; border-collapse: collapse; font-size: 0.875rem; background: var(--s-card); }
.s-tbl thead tr { background: var(--s-surface); border-bottom: 1px solid var(--s-border); }
.s-tbl th {
  padding: 0.9rem 1.1rem; text-align: left;
  font-size: 0.72rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.1em; color: var(--s-t3); white-space: nowrap;
}
.s-tbl td {
  padding: 0.85rem 1.1rem; border-bottom: 1px solid #0F1A28;
  color: var(--s-t2); vertical-align: top; line-height: 1.55;
}
.s-tbl tr:last-child td { border-bottom: none; }
.s-tbl tr:hover td { background: rgba(59,130,246,0.03); }
.s-tbl td:first-child { color: var(--s-t1); font-weight: 500; }
.s-tbl td:nth-child(2) { font-family: var(--s-fm); font-size: 0.82rem; color: #93B4D4; }
.s-tbl code {
  font-family: var(--s-fm); font-size: 0.8rem;
  background: rgba(59,130,246,0.08); color: #93B4D4;
  padding: 0.1em 0.35em; border-radius: 3px;
}
</style>

<style>
/* ═══════════════════════════════════════════════════════════════════════
   COMPARISON — checkmarks in blue, NOT green
   ═══════════════════════════════════════════════════════════════════════ */
.s-cmp {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.75rem;
}
.s-cmp-card {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.25rem; transition: var(--s-t);
}
.s-cmp-card:hover {
  border-color: rgba(59,130,246,0.2); background: var(--s-card-h);
  transform: translateY(-2px); box-shadow: var(--s-sh-card);
}
.s-cmp-card .cv { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--s-t3); margin-bottom: 0.3rem; }
.s-cmp-card .cf { font-size: 1rem; font-weight: 700; color: var(--s-t1); margin-bottom: 0.75rem; }
.s-cmp-card ul  { list-style: none; padding: 0; margin: 0; }
.s-cmp-card li  { font-size: 0.8rem; color: var(--s-t2); padding: 0.2rem 0 0.2rem 1.1rem; position: relative; line-height: 1.5; }
/* Checkmarks in blue — not green */
.s-cmp-card li::before { content: '✓'; position: absolute; left: 0; color: var(--s-blue); font-size: 0.72rem; font-weight: 700; }

/* ═══════════════════════════════════════════════════════════════════════
   ROADMAP — done items use blue accent, NOT green
   ═══════════════════════════════════════════════════════════════════════ */
.s-roadmap {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}
.s-rm-card {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.4rem; transition: var(--s-t);
}
.s-rm-card:hover { border-color: rgba(59,130,246,0.2); background: var(--s-card-h); }
.s-rm-card .rv {
  font-family: var(--s-fm); font-size: 0.72rem; font-weight: 700;
  color: var(--s-accent); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.3rem;
}
.s-rm-card .rt { font-size: 0.95rem; font-weight: 700; color: var(--s-t1); margin-bottom: 0.25rem; }
.s-rm-card .rq { font-size: 0.78rem; color: var(--s-t3); margin-bottom: 0.85rem; }
.s-rm-card ul  { list-style: none; padding: 0; margin: 0; }
.s-rm-card li  { font-size: 0.8rem; color: var(--s-t2); padding: 0.2rem 0 0.2rem 1.1rem; position: relative; line-height: 1.5; }
.s-rm-card li::before { content: '›'; position: absolute; left: 0; color: var(--s-blue); font-size: 0.9rem; }
/* Done items: blue accent border and checkmarks — NOT green */
.s-rm-done { border-color: rgba(59,130,246,0.2) !important; }
.s-rm-done .rv { color: var(--s-blue) !important; }
.s-rm-done li::before { content: '✓'; color: var(--s-blue) !important; font-size: 0.75rem; }
</style>

<style>
/* ═══════════════════════════════════════════════════════════════════════
   DOC GRID
   ═══════════════════════════════════════════════════════════════════════ */
.s-docs {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
}
.s-doc {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-lg); padding: 1.1rem 1.25rem;
  text-decoration: none !important; display: block;
  transition: var(--s-t); position: relative; overflow: hidden;
}
.s-doc::after {
  content: '›';
  position: absolute; right: 1rem; top: 50%;
  transform: translateY(-50%) translateX(6px);
  color: var(--s-blue); font-size: 1.1rem;
  opacity: 0; transition: var(--s-t);
}
.s-doc:hover {
  border-color: rgba(59,130,246,0.25); background: var(--s-card-h);
  transform: translateY(-2px); box-shadow: var(--s-sh-blue);
  text-decoration: none !important;
}
.s-doc:hover::after { opacity: 1; transform: translateY(-50%) translateX(0); }
.s-doc .di { font-size: 1.35rem; margin-bottom: 0.45rem; display: block; line-height: 1; }
.s-doc .dt { font-size: 0.88rem; font-weight: 700; color: var(--s-blue); margin-bottom: 0.25rem; display: block; }
.s-doc:hover .dt { color: var(--s-t1); }
.s-doc .dd { font-size: 0.78rem; color: var(--s-t2); line-height: 1.5; }

/* ═══════════════════════════════════════════════════════════════════════
   CTA BANNER — dot grid barely there
   ═══════════════════════════════════════════════════════════════════════ */
.s-cta-banner {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-radius: var(--s-r-xl); padding: 3.5rem 2rem;
  text-align: center; position: relative; overflow: hidden;
}
/* Dot grid rgba(59,130,246,0.04) — barely there */
.s-cta-banner::before {
  content: '';
  position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(59,130,246,0.04) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
  pointer-events: none;
}
.s-cta-banner::after {
  content: '';
  position: absolute; top: -100px; left: 50%; transform: translateX(-50%);
  width: 600px; height: 400px;
  background: radial-gradient(ellipse, rgba(59,130,246,0.05) 0%, transparent 65%);
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
  color: var(--s-t1) !important; text-decoration: none !important; transition: var(--s-t);
}
.s-cta-link:hover {
  border-color: rgba(59,130,246,0.25); background: rgba(59,130,246,0.05);
  transform: translateY(-2px); color: var(--s-accent) !important;
}
</style>

<style>
/* ═══════════════════════════════════════════════════════════════════════
   RESPONSIVE
   ═══════════════════════════════════════════════════════════════════════ */
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

<!-- ══════════════════════════════════════════════════════════════════
     HERO
     ══════════════════════════════════════════════════════════════════ -->
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
    <img src="https://img.shields.io/npm/v/@streetjs/core?label=%40streetjs%2Fcore&color=3B82F6&style=flat-square" alt="core version">
    <img src="https://img.shields.io/npm/v/@streetjs/cli?label=%40streetjs%2Fcli&color=3B82F6&style=flat-square" alt="cli version">
    <img src="https://img.shields.io/badge/node-%3E%3D20-3B82F6?style=flat-square&logo=node.js&logoColor=white" alt="Node 20+">
    <img src="https://img.shields.io/badge/TypeScript-5.0%2B-3B82F6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5+">
    <img src="https://img.shields.io/badge/deps-2-3B82F6?style=flat-square" alt="2 deps">
    <img src="https://img.shields.io/badge/license-MIT-5A6A80?style=flat-square" alt="MIT">
    <img src="https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg" alt="CI">
  </div>
</div>
</div>
