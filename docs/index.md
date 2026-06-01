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
