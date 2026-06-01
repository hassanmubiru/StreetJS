---
layout:      home
title:       Home
nav_order:   1
permalink:   /
description: "Street — production-grade, memory-safe TypeScript backend framework built on Node.js core. Native PostgreSQL driver, JWT, WebSockets, clustering. 2 dependencies."
---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

<style>
/* ── Design tokens ─────────────────────────────────────────────────────── */
:root {
  --a:    #3B82F6;          /* single accent — blue-500 */
  --a-h:  #2563EB;          /* accent hover */
  --a-d:  rgba(59,130,246,0.08);  /* accent dim bg */
  --a-b:  rgba(59,130,246,0.14);  /* accent border */

  --bg:   #080C14;          /* page background */
  --s0:   #0C1220;          /* surface */
  --s1:   #101828;          /* card */
  --s2:   #141F30;          /* card hover */
  --bd:   #1C2A3E;          /* border */
  --bd-h: rgba(59,130,246,0.22); /* border hover */

  --t1:   #C8D3E0;          /* primary text — slate, not white */
  --t2:   #5A6A80;          /* secondary */
  --t3:   #3A4A5E;          /* muted */

  --ac:   #93B4D4;          /* accent text — muted blue */
  --code-bg: rgba(59,130,246,0.07);

  --r:    10px;
  --rl:   14px;
  --rx:   18px;

  --fh: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --fm: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
  --tr: all 0.18s cubic-bezier(0.4,0,0.2,1);

  --sh-a: 0 4px 20px rgba(59,130,246,0.16);
  --sh-l: 0 8px 40px rgba(0,0,0,0.8);
  --sh-c: 0 2px 8px rgba(0,0,0,0.6);
}

.sp * { box-sizing: border-box; }
.sp   { font-family: var(--fh); color: var(--t1); line-height: 1.6; }

/* gradient text — subtle slate→blue, not rainbow */
.gt {
  background: linear-gradient(135deg, #C8D3E0 0%, #8BA3C0 60%, #60A5FA 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* section chrome */
.ey {
  display: inline-flex; align-items: center;
  font-size: 0.68rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.14em; color: var(--a);
  background: var(--a-d); border: 1px solid var(--a-b);
  border-radius: 100px; padding: 0.25rem 0.8rem; margin-bottom: 0.7rem;
}
.sh2 {
  font-family: var(--fh); font-size: clamp(1.4rem,3.5vw,1.9rem);
  font-weight: 700; letter-spacing: -0.025em; line-height: 1.2;
  color: var(--t1); margin: 0 0 0.55rem;
}
.ssub {
  font-size: 0.9rem; color: var(--t2); line-height: 1.7;
  margin: 0 0 2.25rem; max-width: 540px;
}
.sec { margin-bottom: 4rem; }
</style>

<style>
/* ── Hero ──────────────────────────────────────────────────────────────── */
.hero {
  position: relative; text-align: center;
  padding: 5.5rem 1.5rem 4.5rem;
  background: var(--bg); border: 1px solid var(--bd);
  border-radius: var(--rx); margin-bottom: 0; overflow: hidden;
}
/* subtle dot grid */
.hero::before {
  content: '';
  position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(59,130,246,0.07) 1px, transparent 1px);
  background-size: 30px 30px;
  mask-image: radial-gradient(ellipse 75% 65% at 50% 50%, black 20%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 75% 65% at 50% 50%, black 20%, transparent 100%);
  pointer-events: none;
}
/* single soft glow */
.hero::after {
  content: '';
  position: absolute; top: -150px; left: 50%; transform: translateX(-50%);
  width: 700px; height: 500px;
  background: radial-gradient(ellipse, rgba(59,130,246,0.07) 0%, transparent 60%);
  pointer-events: none;
  animation: hg 12s ease-in-out infinite alternate;
}
@keyframes hg {
  0%   { opacity: 0.7; transform: translateX(-50%) scale(1); }
  100% { opacity: 1;   transform: translateX(-50%) scale(1.05); }
}
.hero-in { position: relative; z-index: 1; }

/* version pill */
.pill {
  display: inline-flex; align-items: center; gap: 0.45rem;
  background: var(--a-d); border: 1px solid var(--a-b);
  border-radius: 100px; padding: 0.28rem 0.9rem;
  font-size: 0.72rem; font-weight: 600; color: var(--ac);
  letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 1.75rem;
}
.pill .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--a); opacity: 0.8;
  animation: bk 3s ease-in-out infinite;
}
@keyframes bk { 0%,100%{opacity:0.8} 50%{opacity:0.3} }

.hero h1 {
  font-family: var(--fh);
  font-size: clamp(2.4rem, 6.5vw, 4.4rem);
  font-weight: 800; letter-spacing: -0.045em; line-height: 1.06;
  margin: 0 0 1.4rem;
}
.hero-sub {
  font-size: clamp(0.95rem, 2.2vw, 1.1rem);
  color: var(--t2); line-height: 1.75;
  max-width: 520px; margin: 0 auto 0.7rem;
}
.hero-nd {
  font-family: var(--fm); font-size: 0.78rem;
  color: var(--t3); letter-spacing: 0.03em; margin-bottom: 2.25rem;
}
.hero-nd span { color: var(--ac); }

/* buttons */
.btns { display: flex; gap: 0.65rem; justify-content: center; flex-wrap: wrap; margin-bottom: 2.25rem; }
.btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.68rem 1.45rem; border-radius: var(--r);
  font-size: 0.9rem; font-weight: 600;
  text-decoration: none !important; transition: var(--tr); white-space: nowrap;
}
.btn-p {
  background: var(--a); color: #fff !important;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: var(--sh-a);
}
.btn-p:hover { background: var(--a-h); transform: translateY(-2px); box-shadow: 0 6px 24px rgba(59,130,246,0.28); }
.btn-g {
  background: rgba(255,255,255,0.03); color: var(--t1) !important;
  border: 1px solid var(--bd);
}
.btn-g:hover { background: rgba(255,255,255,0.06); border-color: var(--bd-h); transform: translateY(-2px); color: var(--ac) !important; }

.badges { display: flex; gap: 0.35rem; justify-content: center; flex-wrap: wrap; }
</style>

<style>
/* ── Terminal ──────────────────────────────────────────────────────────── */
.term {
  background: #060A12; border: 1px solid var(--bd);
  border-radius: var(--rl); overflow: hidden;
  box-shadow: var(--sh-l); margin: 2.25rem 0;
}
.term-bar {
  background: #0A1020; border-bottom: 1px solid var(--bd);
  padding: 0.6rem 1.1rem;
  display: flex; align-items: center; gap: 0.4rem;
}
.term-bar .d { width: 11px; height: 11px; border-radius: 50%; background: var(--bd); flex-shrink: 0; }
.term-bar .ti { font-family: var(--fm); font-size: 0.72rem; color: var(--t3); margin-left: 0.5rem; flex: 1; text-align: center; }
.term-body { padding: 1.3rem 1.5rem; font-family: var(--fm); font-size: 0.86rem; line-height: 2.1; }
.term-body .p  { color: var(--a); user-select: none; }
.term-body .c  { color: var(--t1); }
.term-body .cm { color: var(--t3); }
.term-body .ok { color: var(--ac); }

/* ── Stats ─────────────────────────────────────────────────────────────── */
.stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr));
  gap: 1px; background: var(--bd);
  border: 1px solid var(--bd); border-radius: var(--rl);
  overflow: hidden; margin: 2.25rem 0;
}
.stat { background: var(--s0); padding: 1.3rem 1rem; text-align: center; transition: var(--tr); }
.stat:hover { background: var(--s1); }
.stat .sv { font-family: var(--fm); font-size: 1.35rem; font-weight: 700; color: var(--ac); line-height: 1; margin-bottom: 0.3rem; display: block; }
.stat .sl { font-size: 0.72rem; color: var(--t3); text-transform: uppercase; letter-spacing: 0.08em; }

/* ── Steps ─────────────────────────────────────────────────────────────── */
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px,1fr)); gap: 1.25rem; }
.step {
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: var(--rl); padding: 1.6rem 1.4rem;
  text-align: center; transition: var(--tr);
}
.step:hover { border-color: var(--bd-h); transform: translateY(-3px); box-shadow: var(--sh-a); }
.step .sn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--a); font-size: 1rem; font-weight: 700; color: #fff;
  margin: 0 auto 1rem; box-shadow: var(--sh-a);
}
.step h3 { font-size: 0.95rem; font-weight: 700; color: var(--t1); margin: 0 0 0.45rem; letter-spacing: -0.01em; }
.step p  { font-size: 0.84rem; color: var(--t2); margin: 0; line-height: 1.65; }
.step code { font-family: var(--fm); font-size: 0.78rem; background: var(--code-bg); color: var(--ac); padding: 0.1em 0.35em; border-radius: 4px; }

/* ── Features ──────────────────────────────────────────────────────────── */
.feats { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px,1fr)); gap: 0.9rem; }
.feat {
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: var(--rl); padding: 1.5rem;
  transition: var(--tr);
}
.feat:hover { border-color: var(--bd-h); background: var(--s2); transform: translateY(-2px); box-shadow: var(--sh-c); }
.feat .fi { font-size: 1.6rem; margin-bottom: 0.8rem; display: block; line-height: 1; filter: grayscale(0.3) brightness(0.85); }
.feat h3 { font-size: 0.95rem; font-weight: 700; color: var(--t1); margin: 0 0 0.45rem; letter-spacing: -0.01em; }
.feat p  { font-size: 0.84rem; color: var(--t2); margin: 0; line-height: 1.65; }
.feat code { font-family: var(--fm); font-size: 0.78rem; background: var(--code-bg); color: var(--ac); padding: 0.1em 0.35em; border-radius: 4px; }
</style>

<style>
/* ── Zero deps ─────────────────────────────────────────────────────────── */
.nodeps { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap: 0.7rem; }
.nd {
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: var(--r); padding: 0.95rem 1.2rem;
  display: grid; grid-template-columns: 1rem 1fr;
  align-items: start; gap: 0.7rem; transition: var(--tr);
}
.nd:hover { border-color: var(--bd-h); background: var(--s2); }
.nd .ar { color: var(--a); font-size: 0.8rem; margin-top: 3px; }
.nd strong { display: block; color: var(--t1); font-size: 0.875rem; font-weight: 600; margin-bottom: 0.2rem; }
.nd span   { color: var(--t2); font-size: 0.8rem; line-height: 1.55; }
.nd code   { font-family: var(--fm); font-size: 0.76rem; background: var(--code-bg); color: var(--ac); padding: 0.1em 0.3em; border-radius: 3px; }

/* ── Code window ───────────────────────────────────────────────────────── */
.cwin {
  background: #060A12; border: 1px solid var(--bd);
  border-radius: var(--rl); overflow: hidden;
  box-shadow: var(--sh-l), 0 0 40px rgba(59,130,246,0.05);
}
.cwin-bar {
  background: #0A1020; border-bottom: 1px solid var(--bd);
  padding: 0.65rem 1.2rem;
  display: flex; align-items: center; gap: 0.4rem;
}
.cwin-bar .d  { width: 11px; height: 11px; border-radius: 50%; background: var(--bd); flex-shrink: 0; }
.cwin-bar .fn { font-family: var(--fm); font-size: 0.73rem; color: var(--t3); margin-left: 0.5rem; }
.cwin-bar .lb { margin-left: auto; font-size: 0.67rem; font-weight: 600; background: var(--a-d); color: var(--ac); padding: 0.14rem 0.5rem; border-radius: 4px; border: 1px solid var(--a-b); text-transform: uppercase; letter-spacing: 0.07em; }
.cwin div.highlighter-rouge, .cwin figure.highlight { margin: 0 !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; }
.cwin pre.highlight { border-radius: 0 0 var(--rl) var(--rl) !important; margin: 0 !important; border: none !important; }

/* ── Why Street ────────────────────────────────────────────────────────── */
.why {
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: var(--rx); padding: 2.75rem 2.25rem;
  position: relative; overflow: hidden;
}
.why::after {
  content: ''; position: absolute; top: -60px; right: -60px;
  width: 350px; height: 350px;
  background: radial-gradient(ellipse, rgba(59,130,246,0.05) 0%, transparent 65%);
  pointer-events: none;
}
.why-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px,1fr)); gap: 1.75rem; margin-top: 1.75rem; }
.wi .wn { font-family: var(--fm); font-size: 2rem; font-weight: 700; color: rgba(59,130,246,0.12); line-height: 1; margin-bottom: 0.5rem; display: block; }
.wi h4  { font-size: 0.95rem; font-weight: 700; color: var(--t1); margin: 0 0 0.4rem; letter-spacing: -0.01em; }
.wi p   { font-size: 0.84rem; color: var(--t2); margin: 0; line-height: 1.65; }
.wi code { font-family: var(--fm); font-size: 0.78rem; background: var(--code-bg); color: var(--ac); padding: 0.1em 0.3em; border-radius: 3px; }

/* ── Table ─────────────────────────────────────────────────────────────── */
.tw { overflow-x: auto; border-radius: var(--rl); border: 1px solid var(--bd); box-shadow: var(--sh-c); }
.tb { width: 100%; border-collapse: collapse; font-size: 0.86rem; background: var(--s1); }
.tb thead tr { background: var(--s0); border-bottom: 1px solid var(--bd); }
.tb th { padding: 0.85rem 1.1rem; text-align: left; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--t3); white-space: nowrap; }
.tb td { padding: 0.8rem 1.1rem; border-bottom: 1px solid rgba(28,42,62,0.6); color: var(--t2); vertical-align: top; line-height: 1.55; }
.tb tr:last-child td { border-bottom: none; }
.tb tr:hover td { background: rgba(59,130,246,0.03); }
.tb td:first-child { color: var(--t1); font-weight: 500; }
.tb td:nth-child(2) { font-family: var(--fm); font-size: 0.8rem; color: var(--ac); }
.tb code { font-family: var(--fm); font-size: 0.78rem; background: var(--code-bg); color: var(--ac); padding: 0.1em 0.35em; border-radius: 3px; }
</style>

<style>
/* ── Comparison ────────────────────────────────────────────────────────── */
.cmp { display: grid; grid-template-columns: repeat(auto-fit, minmax(185px,1fr)); gap: 0.7rem; }
.cc  { background: var(--s1); border: 1px solid var(--bd); border-radius: var(--rl); padding: 1.2rem; transition: var(--tr); }
.cc:hover { border-color: var(--bd-h); background: var(--s2); transform: translateY(-2px); box-shadow: var(--sh-c); }
.cc .cv { font-size: 0.67rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--t3); margin-bottom: 0.3rem; }
.cc .cf { font-size: 0.95rem; font-weight: 700; color: var(--t1); margin-bottom: 0.7rem; }
.cc ul  { list-style: none; padding: 0; margin: 0; }
.cc li  { font-size: 0.79rem; color: var(--t2); padding: 0.18rem 0 0.18rem 1rem; position: relative; line-height: 1.5; }
.cc li::before { content: '›'; position: absolute; left: 0; color: var(--a); font-size: 0.85rem; }

/* ── Roadmap ───────────────────────────────────────────────────────────── */
.rm { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px,1fr)); gap: 0.9rem; }
.rmc { background: var(--s1); border: 1px solid var(--bd); border-radius: var(--rl); padding: 1.35rem; transition: var(--tr); }
.rmc:hover { border-color: var(--bd-h); background: var(--s2); }
.rmc .rv { font-family: var(--fm); font-size: 0.7rem; font-weight: 600; color: var(--a); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.3rem; }
.rmc .rt { font-size: 0.92rem; font-weight: 700; color: var(--t1); margin-bottom: 0.2rem; }
.rmc .rq { font-size: 0.76rem; color: var(--t3); margin-bottom: 0.8rem; }
.rmc ul  { list-style: none; padding: 0; margin: 0; }
.rmc li  { font-size: 0.79rem; color: var(--t2); padding: 0.18rem 0 0.18rem 1rem; position: relative; line-height: 1.5; }
.rmc li::before { content: '›'; position: absolute; left: 0; color: var(--a); font-size: 0.85rem; }
.rmc.done { border-color: rgba(59,130,246,0.18); }
.rmc.done .rv { opacity: 0.7; }

/* ── Doc grid ──────────────────────────────────────────────────────────── */
.docs { display: grid; grid-template-columns: repeat(auto-fit, minmax(215px,1fr)); gap: 0.7rem; }
.dc  {
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: var(--rl); padding: 1.05rem 1.2rem;
  text-decoration: none !important; display: block;
  transition: var(--tr); position: relative; overflow: hidden;
}
.dc::after { content: '›'; position: absolute; right: 1rem; top: 50%; transform: translateY(-50%) translateX(5px); color: var(--a); font-size: 1.1rem; opacity: 0; transition: var(--tr); }
.dc:hover  { border-color: var(--bd-h); background: var(--s2); transform: translateY(-2px); box-shadow: var(--sh-a); text-decoration: none !important; }
.dc:hover::after { opacity: 1; transform: translateY(-50%) translateX(0); }
.dc .di { font-size: 1.25rem; margin-bottom: 0.4rem; display: block; line-height: 1; filter: grayscale(0.3) brightness(0.8); }
.dc .dt { font-size: 0.86rem; font-weight: 700; color: var(--ac); margin-bottom: 0.25rem; display: block; }
.dc:hover .dt { color: var(--t1); }
.dc .dd { font-size: 0.77rem; color: var(--t2); line-height: 1.5; }

/* ── CTA banner ────────────────────────────────────────────────────────── */
.cta {
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: var(--rx); padding: 3.25rem 2rem;
  text-align: center; position: relative; overflow: hidden;
}
.cta::before {
  content: ''; position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(59,130,246,0.05) 1px, transparent 1px);
  background-size: 26px 26px;
  mask-image: radial-gradient(ellipse 65% 65% at 50% 50%, black 10%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 65% 65% at 50% 50%, black 10%, transparent 100%);
  pointer-events: none;
}
.cta h2 { font-family: var(--fh); font-size: clamp(1.5rem,3.5vw,2.1rem); font-weight: 700; letter-spacing: -0.025em; line-height: 1.2; margin: 0 0 0.7rem; position: relative; z-index: 1; }
.cta p  { font-size: 0.9rem; color: var(--t2); max-width: 440px; margin: 0 auto 1.75rem; line-height: 1.7; position: relative; z-index: 1; }
.cta-links { display: flex; gap: 0.65rem; justify-content: center; flex-wrap: wrap; position: relative; z-index: 1; }
.cl {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.58rem 1.1rem;
  background: var(--s0); border: 1px solid var(--bd);
  border-radius: var(--r); font-size: 0.84rem; font-weight: 600;
  color: var(--t1) !important; text-decoration: none !important; transition: var(--tr);
}
.cl:hover { border-color: var(--bd-h); background: var(--a-d); transform: translateY(-2px); color: var(--ac) !important; }

/* ── Responsive ────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .hero { padding: 4rem 1rem 3.5rem; }
  .hero h1 { font-size: 2.1rem; }
  .stats { grid-template-columns: repeat(3,1fr); }
  .why { padding: 2rem 1.25rem; }
  .cta { padding: 2.5rem 1.25rem; }
}
@media (max-width: 420px) {
  .stats { grid-template-columns: repeat(2,1fr); }
  .btn { padding: 0.62rem 1rem; font-size: 0.85rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
</style>

<div class="sp">

<!-- HERO -->
<div class="hero">
<div class="hero-in">
  <div class="pill"><span class="dot"></span>v1.0.5 &nbsp;·&nbsp; MIT &nbsp;·&nbsp; Node 20+ &nbsp;·&nbsp; TypeScript 5</div>
  <h1><span class="gt">Build TypeScript Backends<br>Without the Bloat</span></h1>
  <p class="hero-sub">Production-grade. Memory-safe. Native Node.js.<br>Every feature built from core modules — no Express, no pg, no Prisma.</p>
  <p class="hero-nd">
    <span>No Express</span> &nbsp;·&nbsp; <span>No pg</span> &nbsp;·&nbsp; <span>No Prisma</span> &nbsp;·&nbsp;
    <span>No jsonwebtoken</span> &nbsp;·&nbsp; <span>No bcrypt</span> &nbsp;·&nbsp; <span>No multer</span>
  </p>
  <div class="btns">
    <a href="{{ site.baseurl }}/getting-started/installation/" class="btn btn-p">Get Started →</a>
    <a href="https://github.com/hassanmubiru/street" class="btn btn-g" target="_blank" rel="noopener">GitHub ↗</a>
    <a href="{{ site.baseurl }}/examples/" class="btn btn-g">Examples</a>
  </div>
  <div class="badges">
    <img src="https://img.shields.io/npm/v/@streetjs/core?label=%40streetjs%2Fcore&color=3B82F6&style=flat-square" alt="core">
    <img src="https://img.shields.io/npm/v/@streetjs/cli?label=%40streetjs%2Fcli&color=3B82F6&style=flat-square" alt="cli">
    <img src="https://img.shields.io/badge/node-%3E%3D20-3B82F6?style=flat-square" alt="Node 20+">
    <img src="https://img.shields.io/badge/TypeScript-5.0%2B-3B82F6?style=flat-square" alt="TypeScript 5+">
    <img src="https://img.shields.io/badge/deps-2-3B82F6?style=flat-square" alt="2 deps">
    <img src="https://img.shields.io/badge/license-MIT-475569?style=flat-square" alt="MIT">
    <img src="https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg" alt="CI">
  </div>
</div>
</div>

<!-- TERMINAL -->
<div class="term">
  <div class="term-bar">
    <div class="d"></div><div class="d"></div><div class="d"></div>
    <span class="ti">bash — Quick Start</span>
  </div>
  <div class="term-body">
    <div><span class="p">$</span> <span class="c">npm install -g @streetjs/cli</span></div>
    <div><span class="cm"># installs the street CLI globally</span></div>
    <div><span class="p">$</span> <span class="c">street create my-api</span></div>
    <div><span class="cm"># scaffolds TypeScript project with PostgreSQL, JWT, Docker</span></div>
    <div><span class="p">$</span> <span class="c">cd my-api &amp;&amp; npm install &amp;&amp; street dev</span></div>
    <div><span class="ok">[street] Listening on http://0.0.0.0:3000 · Node 20 · ESM · OpenAPI at /openapi.json</span></div>
  </div>
</div>

<!-- STATS -->
<div class="stats">
  <div class="stat"><span class="sv">2</span><span class="sl">Runtime Deps</span></div>
  <div class="stat"><span class="sv">PG v3</span><span class="sl">Wire Protocol</span></div>
  <div class="stat"><span class="sv">AES-256</span><span class="sl">Session Crypto</span></div>
  <div class="stat"><span class="sv">SCRAM</span><span class="sl">PG Auth</span></div>
  <div class="stat"><span class="sv">100K</span><span class="sl">IP Rate Cap</span></div>
  <div class="stat"><span class="sv">MIT</span><span class="sl">Open Source</span></div>
</div>

<!-- HOW IT WORKS -->
<div class="sec">
  <div class="ey">How it works</div>
  <div class="sh2">From scaffold to production in three steps.</div>
  <p class="ssub">Street handles the infrastructure so you focus on your application logic.</p>
  <div class="steps">
    <div class="step"><div class="sn">1</div><h3>Scaffold</h3><p>Run <code>street create my-api</code> to generate a complete TypeScript project with PostgreSQL, JWT auth, Docker, and migrations pre-configured.</p></div>
    <div class="step"><div class="sn">2</div><h3>Build</h3><p>Decorate your controllers and services. Street's IoC container wires dependencies automatically. OpenAPI spec is generated from your decorators.</p></div>
    <div class="step"><div class="sn">3</div><h3>Deploy</h3><p>Run <code>docker build</code> with the included multi-stage Dockerfile. Cluster mode, health endpoints, and graceful shutdown are built in.</p></div>
  </div>
</div>

<!-- FEATURES -->
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

<!-- ZERO DEPS -->
<div class="sec">
  <div class="ey">Zero Bloat</div>
  <div class="sh2">No third-party middleware stack.</div>
  <p class="ssub">Two runtime dependencies: <code style="font-family:var(--fm);font-size:0.82em;background:var(--code-bg);color:var(--ac);padding:0.1em 0.4em;border-radius:4px">reflect-metadata</code> and <code style="font-family:var(--fm);font-size:0.82em;background:var(--code-bg);color:var(--ac);padding:0.1em 0.4em;border-radius:4px">ws</code>. Everything else ships with Node.js.</p>
  <div class="nodeps">
    <div class="nd"><span class="ar">›</span><div><strong>No Express / Fastify</strong><span>Native <code>node:http</code> server with compiled-regex router and middleware pipeline</span></div></div>
    <div class="nd"><span class="ar">›</span><div><strong>No pg / postgres.js</strong><span>PostgreSQL wire protocol v3 over <code>node:net</code> with SCRAM-SHA-256 auth</span></div></div>
    <div class="nd"><span class="ar">›</span><div><strong>No Prisma / Zod</strong><span>Parameterized queries + <code>@Validate</code> decorator for runtime type checking</span></div></div>
    <div class="nd"><span class="ar">›</span><div><strong>No jsonwebtoken</strong><span>HMAC-SHA256 via <code>node:crypto</code> with <code>timingSafeEqual</code> comparison</span></div></div>
    <div class="nd"><span class="ar">›</span><div><strong>No bcrypt / argon2</strong><span>scrypt via <code>node:crypto</code> — memory-hard, battle-tested password hashing</span></div></div>
    <div class="nd"><span class="ar">›</span><div><strong>No multer / busboy</strong><span>Streaming multipart parser — ≤128 KB heap per upload, disk-streamed</span></div></div>
  </div>
</div>

</div><!-- end .sp — pause for markdown code block -->

<!-- CODE EXAMPLE -->
<div class="sp sec">
  <div class="ey">Quick Example</div>
  <div class="sh2">A complete production API. One file. No extra packages.</div>
  <p class="ssub">PostgreSQL, JWT auth, rate limiting, and auto-generated OpenAPI — all from <code style="font-family:var(--fm);font-size:0.82em;background:var(--code-bg);color:var(--ac);padding:0.1em 0.4em;border-radius:4px">@streetjs/core</code>.</p>
  <div class="cwin">
    <div class="cwin-bar">
      <div class="d"></div><div class="d"></div><div class="d"></div>
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
      [name]  // parameterized — SQL injection impossible
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

</div><!-- end .sp -->
