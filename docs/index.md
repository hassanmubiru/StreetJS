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
