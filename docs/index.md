---
layout:      home
title:       Home
nav_order:   1
permalink:   /
description: "Street — production-grade, memory-safe TypeScript backend framework built on Node.js core. Native PostgreSQL driver, JWT, WebSockets, clustering. 2 dependencies."
---

<style>
/* ═══════════════════════════════════════════════════════════════════════════
   STREET FRAMEWORK — DESIGN SYSTEM
   Electric Blue + Indigo palette · Inter + JetBrains Mono
   ═══════════════════════════════════════════════════════════════════════════ */

:root {
  --st-blue:          #2563EB;
  --st-blue-hover:    #1D4ED8;
  --st-blue-active:   #1E40AF;
  --st-indigo:        #6366F1;
  --st-indigo-hover:  #4F46E5;
  --st-sky:           #38BDF8;
  --st-green:         #22C55E;
  --st-yellow:        #F59E0B;
  --st-red:           #EF4444;

  --st-bg:            #0A0E1A;
  --st-surface:       #0F1629;
  --st-card:          #141C2E;
  --st-card-hover:    #1A2540;
  --st-border:        #1E2D4A;
  --st-border-hover:  #2563EB;

  --st-text-primary:  #F1F5F9;
  --st-text-secondary:#94A3B8;
  --st-text-muted:    #475569;

  --st-radius-sm:     6px;
  --st-radius:        10px;
  --st-radius-lg:     16px;

  --st-font-head:     'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --st-font-body:     'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --st-font-mono:     'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;

  --st-shadow-sm:     0 1px 3px rgba(0,0,0,0.4);
  --st-shadow:        0 4px 16px rgba(0,0,0,0.5);
  --st-shadow-lg:     0 8px 32px rgba(0,0,0,0.6);
  --st-shadow-blue:   0 4px 24px rgba(37,99,235,0.25);
  --st-shadow-glow:   0 0 40px rgba(37,99,235,0.15);

  --st-transition:    all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

/* ── Reset & base ─────────────────────────────────────────────────────────── */
.street-page * { box-sizing: border-box; }
.street-page { font-family: var(--st-font-body); color: var(--st-text-primary); }

/* ── Gradient text utility ────────────────────────────────────────────────── */
.grad-text {
  background: linear-gradient(135deg, #F1F5F9 0%, var(--st-sky) 50%, var(--st-indigo) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.grad-text-blue {
  background: linear-gradient(135deg, var(--st-blue) 0%, var(--st-sky) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
</style>

<style>
/* ── Section labels ───────────────────────────────────────────────────────── */
.st-label {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--st-sky);
  margin-bottom: 0.6rem;
}
.st-section-head {
  font-family: var(--st-font-head);
  font-size: clamp(1.5rem, 3.5vw, 2.1rem);
  font-weight: 800;
  color: var(--st-text-primary);
  margin: 0 0 0.5rem;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.st-section-sub {
  color: var(--st-text-secondary);
  font-size: 1rem;
  margin: 0 0 2.25rem;
  line-height: 1.65;
}

/* ══════════════════════════════════════════════════════════════════════════
   HERO
   ══════════════════════════════════════════════════════════════════════════ */
.st-hero {
  position: relative;
  text-align: center;
  padding: 5rem 1.5rem 4rem;
  border-radius: var(--st-radius-lg);
  margin-bottom: 2.5rem;
  overflow: hidden;
  background: var(--st-bg);
  border: 1px solid var(--st-border);
}
/* Animated gradient orbs */
.st-hero::before {
  content: '';
  position: absolute;
  top: -120px; left: 50%; transform: translateX(-50%);
  width: 800px; height: 500px;
  background: radial-gradient(ellipse at 30% 40%, rgba(37,99,235,0.18) 0%, transparent 55%),
              radial-gradient(ellipse at 70% 60%, rgba(99,102,241,0.14) 0%, transparent 55%);
  pointer-events: none;
  animation: heroGlow 8s ease-in-out infinite alternate;
}
.st-hero::after {
  content: '';
  position: absolute;
  bottom: -80px; left: 50%; transform: translateX(-50%);
  width: 600px; height: 300px;
  background: radial-gradient(ellipse, rgba(56,189,248,0.06) 0%, transparent 70%);
  pointer-events: none;
}
@keyframes heroGlow {
  0%   { opacity: 0.7; transform: translateX(-50%) scale(1); }
  100% { opacity: 1;   transform: translateX(-50%) scale(1.08); }
}

.st-hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(37,99,235,0.12);
  border: 1px solid rgba(37,99,235,0.3);
  border-radius: 100px;
  padding: 0.3rem 0.9rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--st-sky);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 1.5rem;
  position: relative;
}
.st-hero-eyebrow::before {
  content: '';
  width: 6px; height: 6px;
  background: var(--st-green);
  border-radius: 50%;
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(0.8); }
}

.st-hero h1 {
  font-family: var(--st-font-head);
  font-size: clamp(2.4rem, 6.5vw, 4.2rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.08;
  margin: 0 0 1.25rem;
  position: relative;
}
.st-hero .tagline {
  font-size: clamp(1rem, 2.5vw, 1.2rem);
  color: var(--st-text-secondary);
  max-width: 640px;
  margin: 0 auto 0.75rem;
  line-height: 1.7;
  position: relative;
}
.st-hero .no-deps {
  font-family: var(--st-font-mono);
  font-size: 0.85rem;
  color: var(--st-text-muted);
  margin-bottom: 2.25rem;
  position: relative;
  letter-spacing: 0.02em;
}
.st-hero .no-deps span { color: var(--st-sky); }
</style>

<style>
/* ── Hero buttons ─────────────────────────────────────────────────────────── */
.st-hero-btns {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 2.25rem;
  position: relative;
}
.st-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.7rem 1.5rem;
  border-radius: var(--st-radius);
  font-size: 0.95rem;
  font-weight: 600;
  text-decoration: none !important;
  transition: var(--st-transition);
  white-space: nowrap;
  cursor: pointer;
}
.st-btn-primary {
  background: var(--st-blue);
  color: #fff !important;
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: var(--st-shadow-blue);
}
.st-btn-primary:hover {
  background: var(--st-blue-hover);
  transform: translateY(-2px);
  box-shadow: 0 6px 28px rgba(37,99,235,0.4);
}
.st-btn-ghost {
  background: rgba(255,255,255,0.04);
  color: var(--st-text-primary) !important;
  border: 1px solid var(--st-border);
  backdrop-filter: blur(8px);
}
.st-btn-ghost:hover {
  background: rgba(255,255,255,0.08);
  border-color: var(--st-blue);
  transform: translateY(-2px);
}

/* ── Hero badges ──────────────────────────────────────────────────────────── */
.st-hero-badges {
  display: flex;
  gap: 0.4rem;
  justify-content: center;
  flex-wrap: wrap;
  position: relative;
}

/* ══════════════════════════════════════════════════════════════════════════
   TERMINAL INSTALL STRIP
   ══════════════════════════════════════════════════════════════════════════ */
.st-terminal {
  background: #080D18;
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius);
  padding: 0;
  margin-bottom: 2.5rem;
  overflow: hidden;
  box-shadow: var(--st-shadow-lg);
}
.st-terminal-bar {
  background: #0F1629;
  border-bottom: 1px solid var(--st-border);
  padding: 0.6rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.st-terminal-dot {
  width: 12px; height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}
.st-terminal-bar .label {
  font-family: var(--st-font-mono);
  font-size: 0.75rem;
  color: var(--st-text-muted);
  margin-left: 0.5rem;
  flex: 1;
  text-align: center;
}
.st-terminal-body {
  padding: 1.25rem 1.5rem;
  font-family: var(--st-font-mono);
  font-size: 0.9rem;
  line-height: 2;
}
.st-terminal-body .prompt { color: var(--st-green); user-select: none; }
.st-terminal-body .cmd    { color: var(--st-text-primary); }
.st-terminal-body .out    { color: var(--st-text-muted); }
.st-terminal-body .hi     { color: var(--st-sky); }

/* ══════════════════════════════════════════════════════════════════════════
   SOCIAL PROOF / STAT BAR
   ══════════════════════════════════════════════════════════════════════════ */
.st-proof-bar {
  background: var(--st-surface);
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius);
  padding: 1rem 1.5rem;
  margin-bottom: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  flex-wrap: wrap;
  overflow: hidden;
}
.st-proof-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  border-right: 1px solid var(--st-border);
  white-space: nowrap;
}
.st-proof-item:last-child { border-right: none; }
.st-proof-item .pi-val {
  font-size: 1rem;
  font-weight: 700;
  color: var(--st-sky);
  font-family: var(--st-font-mono);
}
.st-proof-item .pi-label {
  font-size: 0.8rem;
  color: var(--st-text-secondary);
}
</style>

<style>
/* ══════════════════════════════════════════════════════════════════════════
   FEATURE GRID
   ══════════════════════════════════════════════════════════════════════════ */
.st-feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 1rem;
  margin-bottom: 3.5rem;
}
.st-feature-card {
  background: var(--st-card);
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius);
  padding: 1.5rem;
  transition: var(--st-transition);
  position: relative;
  overflow: hidden;
}
.st-feature-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--st-blue), var(--st-indigo));
  opacity: 0;
  transition: var(--st-transition);
}
.st-feature-card:hover {
  border-color: var(--st-border-hover);
  background: var(--st-card-hover);
  transform: translateY(-3px);
  box-shadow: var(--st-shadow-blue);
}
.st-feature-card:hover::before { opacity: 1; }
.st-feature-card .fc-icon {
  font-size: 1.75rem;
  margin-bottom: 0.85rem;
  display: block;
  line-height: 1;
}
.st-feature-card h3 {
  font-family: var(--st-font-head);
  font-size: 1rem;
  font-weight: 700;
  color: var(--st-text-primary);
  margin: 0 0 0.5rem;
  letter-spacing: -0.01em;
}
.st-feature-card p {
  font-size: 0.875rem;
  color: var(--st-text-secondary);
  margin: 0;
  line-height: 1.65;
}
.st-feature-card code {
  font-family: var(--st-font-mono);
  font-size: 0.8rem;
  background: rgba(37,99,235,0.12);
  color: var(--st-sky);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  border: none;
}

/* ══════════════════════════════════════════════════════════════════════════
   ZERO DEPENDENCIES SECTION
   ══════════════════════════════════════════════════════════════════════════ */
.st-nodep-section {
  margin-bottom: 3.5rem;
}
.st-nodep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.75rem;
}
.st-nodep-item {
  background: var(--st-card);
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius);
  padding: 1rem 1.25rem;
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: start;
  gap: 0.6rem;
  transition: var(--st-transition);
}
.st-nodep-item:hover {
  border-color: var(--st-border-hover);
  background: var(--st-card-hover);
}
.st-nodep-item .nd-cross {
  color: var(--st-red);
  font-weight: 800;
  font-size: 0.9rem;
  margin-top: 2px;
  font-family: var(--st-font-mono);
}
.st-nodep-item .nd-arrow {
  color: var(--st-green);
  font-weight: 700;
  font-size: 0.9rem;
  margin-top: 2px;
}
.st-nodep-item .nd-content strong {
  display: block;
  color: var(--st-text-primary);
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 0.2rem;
}
.st-nodep-item .nd-content span {
  color: var(--st-text-secondary);
  font-size: 0.8rem;
  line-height: 1.5;
}
.st-nodep-item .nd-content code {
  font-family: var(--st-font-mono);
  font-size: 0.78rem;
  background: rgba(56,189,248,0.1);
  color: var(--st-sky);
  padding: 0.1em 0.3em;
  border-radius: 3px;
}
</style>

<style>
/* ══════════════════════════════════════════════════════════════════════════
   CODE EXAMPLE SECTION
   ══════════════════════════════════════════════════════════════════════════ */
.st-code-section {
  margin-bottom: 3.5rem;
}
.st-code-window {
  background: #080D18;
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius-lg);
  overflow: hidden;
  box-shadow: var(--st-shadow-lg), var(--st-shadow-glow);
}
.st-code-titlebar {
  background: var(--st-surface);
  border-bottom: 1px solid var(--st-border);
  padding: 0.75rem 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.st-code-titlebar .dot { width: 12px; height: 12px; border-radius: 50%; }
.st-code-titlebar .filename {
  font-family: var(--st-font-mono);
  font-size: 0.78rem;
  color: var(--st-text-muted);
  margin-left: 0.5rem;
}
.st-code-titlebar .lang-badge {
  margin-left: auto;
  font-size: 0.7rem;
  font-weight: 600;
  background: rgba(37,99,235,0.15);
  color: var(--st-sky);
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  border: 1px solid rgba(37,99,235,0.25);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ══════════════════════════════════════════════════════════════════════════
   MEMORY BOUNDS TABLE
   ══════════════════════════════════════════════════════════════════════════ */
.st-memory-section {
  margin-bottom: 3.5rem;
}
.st-table-wrap {
  overflow-x: auto;
  border-radius: var(--st-radius);
  border: 1px solid var(--st-border);
}
.st-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  background: var(--st-card);
}
.st-table thead tr {
  background: var(--st-surface);
  border-bottom: 1px solid var(--st-border);
}
.st-table th {
  padding: 0.85rem 1.1rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--st-text-muted);
  white-space: nowrap;
}
.st-table td {
  padding: 0.8rem 1.1rem;
  border-bottom: 1px solid var(--st-border);
  color: var(--st-text-secondary);
  vertical-align: top;
  line-height: 1.5;
}
.st-table tr:last-child td { border-bottom: none; }
.st-table tr:hover td { background: var(--st-card-hover); }
.st-table td:first-child { color: var(--st-text-primary); font-weight: 500; }
.st-table td:nth-child(2) {
  font-family: var(--st-font-mono);
  font-size: 0.82rem;
  color: var(--st-sky);
}
.st-table code {
  font-family: var(--st-font-mono);
  font-size: 0.8rem;
  background: rgba(56,189,248,0.1);
  color: var(--st-sky);
  padding: 0.1em 0.35em;
  border-radius: 3px;
}

/* ══════════════════════════════════════════════════════════════════════════
   FRAMEWORK COMPARISON
   ══════════════════════════════════════════════════════════════════════════ */
.st-compare-section { margin-bottom: 3.5rem; }
.st-compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
}
.st-compare-card {
  background: var(--st-card);
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius);
  padding: 1.1rem 1.25rem;
  transition: var(--st-transition);
}
.st-compare-card:hover {
  border-color: var(--st-border-hover);
  background: var(--st-card-hover);
  transform: translateY(-2px);
}
.st-compare-card .cc-vs {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--st-text-muted);
  margin-bottom: 0.4rem;
}
.st-compare-card .cc-fw {
  font-size: 1rem;
  font-weight: 700;
  color: var(--st-text-primary);
  margin-bottom: 0.6rem;
}
.st-compare-card .cc-points {
  list-style: none;
  padding: 0; margin: 0;
}
.st-compare-card .cc-points li {
  font-size: 0.8rem;
  color: var(--st-text-secondary);
  padding: 0.2rem 0;
  padding-left: 1.1rem;
  position: relative;
  line-height: 1.5;
}
.st-compare-card .cc-points li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--st-green);
  font-size: 0.75rem;
  font-weight: 700;
}
</style>

<style>
/* ══════════════════════════════════════════════════════════════════════════
   DOCUMENTATION GRID
   ══════════════════════════════════════════════════════════════════════════ */
.st-doc-section { margin-bottom: 3.5rem; }
.st-doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 0.75rem;
}
.st-doc-card {
  background: var(--st-card);
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius);
  padding: 1.1rem 1.25rem;
  text-decoration: none !important;
  display: block;
  transition: var(--st-transition);
  position: relative;
  overflow: hidden;
}
.st-doc-card::after {
  content: '→';
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%) translateX(4px);
  color: var(--st-blue);
  font-size: 1rem;
  opacity: 0;
  transition: var(--st-transition);
}
.st-doc-card:hover {
  border-color: var(--st-border-hover);
  background: var(--st-card-hover);
  transform: translateY(-2px);
  box-shadow: var(--st-shadow-blue);
  text-decoration: none !important;
}
.st-doc-card:hover::after {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}
.st-doc-card .dc-icon {
  font-size: 1.4rem;
  margin-bottom: 0.5rem;
  display: block;
  line-height: 1;
}
.st-doc-card .dc-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--st-blue);
  margin-bottom: 0.3rem;
  display: block;
}
.st-doc-card:hover .dc-title { color: var(--st-sky); }
.st-doc-card .dc-desc {
  font-size: 0.8rem;
  color: var(--st-text-secondary);
  line-height: 1.5;
}

/* ══════════════════════════════════════════════════════════════════════════
   PACKAGES TABLE
   ══════════════════════════════════════════════════════════════════════════ */
.st-packages-section { margin-bottom: 3.5rem; }

/* ══════════════════════════════════════════════════════════════════════════
   COMMUNITY SECTION
   ══════════════════════════════════════════════════════════════════════════ */
.st-community-section {
  background: var(--st-card);
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius-lg);
  padding: 2.5rem;
  margin-bottom: 3rem;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.st-community-section::before {
  content: '';
  position: absolute;
  top: -60px; left: 50%; transform: translateX(-50%);
  width: 500px; height: 300px;
  background: radial-gradient(ellipse, rgba(99,102,241,0.08) 0%, transparent 70%);
  pointer-events: none;
}
.st-community-links {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 1.5rem;
  position: relative;
}
.st-community-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 1.2rem;
  background: var(--st-surface);
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--st-text-primary) !important;
  text-decoration: none !important;
  transition: var(--st-transition);
}
.st-community-link:hover {
  border-color: var(--st-blue);
  background: rgba(37,99,235,0.08);
  transform: translateY(-2px);
  color: var(--st-sky) !important;
}

/* ── Responsive ───────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .st-hero { padding: 3.5rem 1rem 3rem; }
  .st-proof-item { border-right: none; border-bottom: 1px solid var(--st-border); width: 100%; justify-content: center; }
  .st-proof-item:last-child { border-bottom: none; }
  .st-proof-bar { flex-direction: column; padding: 0; }
  .st-community-section { padding: 1.75rem 1rem; }
}
@media (max-width: 480px) {
  .st-hero h1 { font-size: 2rem; }
  .st-btn { padding: 0.6rem 1.1rem; font-size: 0.875rem; }
}
</style>

<div class="street-page">

<!-- ══════════════════════════════════════════════════════════════════════════
     HERO
     ══════════════════════════════════════════════════════════════════════════ -->
<div class="st-hero">
  <div class="st-hero-eyebrow">TypeScript Backend Framework · v1.0.5 · MIT</div>
  <h1>
    <span class="grad-text">The TypeScript Backend<br>That Doesn't Compromise</span>
  </h1>
  <p class="tagline">
    Production-grade. Memory-safe. Native Node.js.<br>
    No Express. No pg. No Prisma. Just TypeScript and speed.
  </p>
  <p class="no-deps">
    <span>No Express</span> &nbsp;·&nbsp;
    <span>No pg</span> &nbsp;·&nbsp;
    <span>No Prisma</span> &nbsp;·&nbsp;
    <span>No jsonwebtoken</span> &nbsp;·&nbsp;
    <span>No bcrypt</span> &nbsp;·&nbsp;
    <span>No multer</span>
  </p>
  <div class="st-hero-btns">
    <a href="{{ site.baseurl }}/getting-started/installation/" class="st-btn st-btn-primary">Get Started Free →</a>
    <a href="https://github.com/hassanmubiru/street" class="st-btn st-btn-ghost" target="_blank" rel="noopener">View on GitHub ↗</a>
    <a href="{{ site.baseurl }}/examples/" class="st-btn st-btn-ghost">See Examples</a>
  </div>
  <div class="st-hero-badges">
    <img src="https://img.shields.io/npm/v/@streetjs/core?label=%40streetjs%2Fcore&color=2563EB&style=flat-square" alt="@streetjs/core version">
    <img src="https://img.shields.io/npm/v/@streetjs/cli?label=%40streetjs%2Fcli&color=2563EB&style=flat-square" alt="@streetjs/cli version">
    <img src="https://img.shields.io/badge/node-%3E%3D20-22C55E?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 20+">
    <img src="https://img.shields.io/badge/TypeScript-5.0%2B-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5+">
    <img src="https://img.shields.io/badge/license-MIT-94A3B8?style=flat-square" alt="MIT License">
    <img src="https://img.shields.io/badge/deps-2-22C55E?style=flat-square" alt="2 runtime dependencies">
    <img src="https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg" alt="CI status">
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════════
     TERMINAL INSTALL
     ══════════════════════════════════════════════════════════════════════════ -->
<div class="st-terminal">
  <div class="st-terminal-bar">
    <div class="st-terminal-dot" style="background:#EF4444"></div>
    <div class="st-terminal-dot" style="background:#F59E0B"></div>
    <div class="st-terminal-dot" style="background:#22C55E"></div>
    <span class="label">bash — Quick Start</span>
  </div>
  <div class="st-terminal-body">
    <div><span class="prompt">$</span> <span class="cmd">npm install -g @streetjs/cli</span></div>
    <div><span class="out"># installs the street CLI globally</span></div>
    <div><span class="prompt">$</span> <span class="cmd">street create my-api</span></div>
    <div><span class="out"># scaffolds a new project with TypeScript, PostgreSQL, JWT</span></div>
    <div><span class="prompt">$</span> <span class="cmd">cd my-api &amp;&amp; npm install &amp;&amp; street dev</span></div>
    <div><span class="hi">[street] Listening on http://0.0.0.0:3000 · Node 20 · ESM</span></div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════════
     SOCIAL PROOF BAR
     ══════════════════════════════════════════════════════════════════════════ -->
<div class="st-proof-bar">
  <div class="st-proof-item"><span class="pi-val">2</span><span class="pi-label">Runtime Dependencies</span></div>
  <div class="st-proof-item"><span class="pi-val">PG v3</span><span class="pi-label">Wire Protocol</span></div>
  <div class="st-proof-item"><span class="pi-val">AES-256-GCM</span><span class="pi-label">Session Security</span></div>
  <div class="st-proof-item"><span class="pi-val">Node 20+</span><span class="pi-label">ESM Native</span></div>
  <div class="st-proof-item"><span class="pi-val">MIT</span><span class="pi-label">Open Source</span></div>
  <div class="st-proof-item"><span class="pi-val">100K</span><span class="pi-label">IP Rate Limit Cap</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════════
     FEATURES GRID
     ══════════════════════════════════════════════════════════════════════════ -->
<div class="st-label">Core Capabilities</div>
<div class="st-section-head">Everything you need. Nothing you don't.</div>
<p class="st-section-sub">Every feature is built from Node.js core modules with explicit memory bounds and zero third-party middleware.</p>

<div class="st-feature-grid">
  <div class="st-feature-card">
    <span class="fc-icon">🔷</span>
    <h3>TypeScript First</h3>
    <p>Strict mode, NodeNext ESM, decorator metadata, full type inference. Zero <code>any</code> in the framework source. Your IDE knows everything.</p>
  </div>
  <div class="st-feature-card">
    <span class="fc-icon">🛡️</span>
    <h3>Memory-Safe by Design</h3>
    <p>Bounded body limits, connection pools, ring-buffer telemetry, LRU eviction, WebSocket caps. Every component has an explicit ceiling.</p>
  </div>
  <div class="st-feature-card">
    <span class="fc-icon">🐘</span>
    <h3>Native PostgreSQL Driver</h3>
    <p>Wire protocol v3 over <code>node:net</code>. SCRAM-SHA-256 auth. Streaming rows with socket-level backpressure. No <code>pg</code> dependency.</p>
  </div>
  <div class="st-feature-card">
    <span class="fc-icon">💉</span>
    <h3>Dependency Injection</h3>
    <p>IoC container with constructor injection, singleton registry, and circular dependency detection via <code>reflect-metadata</code>.</p>
  </div>
  <div class="st-feature-card">
    <span class="fc-icon">🔐</span>
    <h3>Security Built-in</h3>
    <p>JWT (HMAC-SHA256), AES-256-GCM sessions, scrypt vault, sliding-window rate limiter, XSS sanitizer, CSRF, CORS, CSP — all included.</p>
  </div>
  <div class="st-feature-card">
    <span class="fc-icon">⚡</span>
    <h3>Real-Time Ready</h3>
    <p>Bounded WebSocket server with heartbeat, typed event emitter, and SSE with keep-alive. Auth hook on upgrade. No socket.io needed.</p>
  </div>
  <div class="st-feature-card">
    <span class="fc-icon">📋</span>
    <h3>OpenAPI 3.1 Auto-gen</h3>
    <p>Spec generated from <code>@ApiOperation</code> decorators. Always in sync with your code. Served at <code>/openapi.json</code>. No separate schema files.</p>
  </div>
  <div class="st-feature-card">
    <span class="fc-icon">🔄</span>
    <h3>Clustering &amp; Telemetry</h3>
    <p><code>node:cluster</code> coordinator with IPC heartbeat, auto-restart, graceful shutdown, and P50/P99 latency ring-buffer tracking.</p>
  </div>
  <div class="st-feature-card">
    <span class="fc-icon">🚀</span>
    <h3>CLI Tooling</h3>
    <p><code>street create</code>, <code>street dev</code>, <code>street generate</code>, <code>street migrate:create</code> — full project lifecycle from one binary.</p>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════════
     ZERO DEPENDENCIES
     ══════════════════════════════════════════════════════════════════════════ -->
<div class="st-nodep-section">
  <div class="st-label">Zero Bloat</div>
  <div class="st-section-head">No third-party middleware stack.</div>
  <p class="st-section-sub">Every capability is implemented directly from Node.js core. Two runtime dependencies total: <code>reflect-metadata</code> and <code>ws</code>.</p>
  <div class="st-nodep-grid">
    <div class="st-nodep-item">
      <span class="nd-cross">✕</span><span class="nd-arrow">→</span>
      <div class="nd-content"><strong>No Express / Fastify</strong><span>Native <code>node:http</code> server with compiled-regex router and middleware pipeline</span></div>
    </div>
    <div class="st-nodep-item">
      <span class="nd-cross">✕</span><span class="nd-arrow">→</span>
      <div class="nd-content"><strong>No pg / postgres.js</strong><span>PostgreSQL wire protocol v3 over <code>node:net</code> with SCRAM-SHA-256 auth</span></div>
    </div>
    <div class="st-nodep-item">
      <span class="nd-cross">✕</span><span class="nd-arrow">→</span>
      <div class="nd-content"><strong>No Prisma / Zod</strong><span>Parameterized queries + <code>@Validate</code> decorator for runtime type checking</span></div>
    </div>
    <div class="st-nodep-item">
      <span class="nd-cross">✕</span><span class="nd-arrow">→</span>
      <div class="nd-content"><strong>No jsonwebtoken</strong><span>HMAC-SHA256 via <code>node:crypto</code> with <code>timingSafeEqual</code> comparison</span></div>
    </div>
    <div class="st-nodep-item">
      <span class="nd-cross">✕</span><span class="nd-arrow">→</span>
      <div class="nd-content"><strong>No bcrypt / argon2</strong><span>scrypt via <code>node:crypto</code> — battle-tested, memory-hard password hashing</span></div>
    </div>
    <div class="st-nodep-item">
      <span class="nd-cross">✕</span><span class="nd-arrow">→</span>
      <div class="nd-content"><strong>No multer / busboy</strong><span>Streaming multipart parser — ≤128 KB heap per upload, disk-streamed</span></div>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════════
     CODE EXAMPLE
     ══════════════════════════════════════════════════════════════════════════ -->
<div class="st-code-section">
  <div class="st-label">Quick Example</div>
  <div class="st-section-head">From zero to production API in minutes.</div>
  <p class="st-section-sub">PostgreSQL, JWT auth, rate limiting, and OpenAPI — all in one file, no extra packages.</p>
  <div class="st-code-window">
    <div class="st-code-titlebar">
      <div class="dot" style="background:#EF4444"></div>
      <div class="dot" style="background:#F59E0B"></div>
      <div class="dot" style="background:#22C55E"></div>
      <span class="filename">src/main.ts</span>
      <span class="lang-badge">TypeScript</span>
    </div>
  </div>
</div>

```typescript
import 'reflect-metadata';
import {
  streetApp, Injectable, Controller, Get, Post,
  PgPool, securityHeaders, corsMiddleware,
  RateLimiter, authMiddleware, JwtService,
  ApiOperation,
} from '@streetjs/core';
import type { StreetContext } from '@streetjs/core';

// ── Service layer ──────────────────────────────────────────────────────────
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
      [name]                          // ← parameterized, SQL-injection safe
    );
    return rows[0];
  }
}

// ── Controller layer ───────────────────────────────────────────────────────
@Controller('/api/items')
class ItemController {
  constructor(private readonly svc: ItemService) {}

  @Get('/')
  @ApiOperation({ summary: 'List all items', tags: ['items'] })
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

// ── Bootstrap ─────────────────────────────────────────────────────────────
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
// [street] OpenAPI spec → http://0.0.0.0:3000/openapi.json
```


<!-- ══════════════════════════════════════════════════════════════════════════
     MEMORY BOUNDS TABLE
     ══════════════════════════════════════════════════════════════════════════ -->
<div class="st-memory-section">
  <div class="st-label">Memory Safety</div>
  <div class="st-section-head">Every component has explicit bounds.</div>
  <p class="st-section-sub">No unbounded collections. No silent memory leaks. Every limit is documented, configurable, and enforced at runtime.</p>
  <div class="st-table-wrap">
    <table class="st-table">
      <thead>
        <tr>
          <th>Component</th>
          <th>Default Bound</th>
          <th>Enforcement Mechanism</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>HTTP request body</td><td>1 MB</td><td>Stream abort on overflow — configurable via <code>bodyLimit</code></td></tr>
        <tr><td>File uploads</td><td>Disk-streamed</td><td>Chunk-by-chunk streaming, ≤128 KB heap per upload</td></tr>
        <tr><td>DB result buffer</td><td>256 rows</td><td>Socket-level backpressure, streaming cursor API</td></tr>
        <tr><td>LRU cache</td><td><code>maxEntries</code> cap</td><td>O(1) LRU eviction on insert when full</td></tr>
        <tr><td>Rate limiter</td><td>100K IPs · 1K timestamps/IP</td><td>Periodic stale-entry sweep, configurable TTL</td></tr>
        <tr><td>Telemetry history</td><td>1,440 samples</td><td>Ring buffer — oldest sample overwritten</td></tr>
        <tr><td>WebSocket connections</td><td><code>maxConnections</code></td><td>Reject with close code 1013 (Try Again Later)</td></tr>
        <tr><td>Connection pool</td><td><code>maxConnections</code></td><td>Bounded acquire queue with timeout</td></tr>
        <tr><td>Auth buffer (wire)</td><td>64 KB</td><td>Hard cap during PostgreSQL auth phase</td></tr>
      </tbody>
    </table>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════════
     FRAMEWORK COMPARISON
     ══════════════════════════════════════════════════════════════════════════ -->
<div class="st-compare-section">
  <div class="st-label">Comparison</div>
  <div class="st-section-head">General-purpose. Production-grade.</div>
  <p class="st-section-sub">Street is comparable in scope to Express, NestJS, Spring Boot, and ASP.NET Core — with a security-first, memory-conscious design and a fraction of the dependency surface.</p>
  <div class="st-compare-grid">
    <div class="st-compare-card">
      <div class="cc-vs">vs</div>
      <div class="cc-fw">Express</div>
      <ul class="cc-points">
        <li>TypeScript-first, not bolted on</li>
        <li>Explicit memory bounds</li>
        <li>Built-in security layer</li>
        <li>Native PostgreSQL driver</li>
      </ul>
    </div>
    <div class="st-compare-card">
      <div class="cc-vs">vs</div>
      <div class="cc-fw">Fastify</div>
      <ul class="cc-points">
        <li>Built-in auth &amp; sessions</li>
        <li>WebSocket + SSE included</li>
        <li>Native PostgreSQL — no plugin</li>
        <li>2 deps, not a plugin ecosystem</li>
      </ul>
    </div>
    <div class="st-compare-card">
      <div class="cc-vs">vs</div>
      <div class="cc-fw">NestJS</div>
      <ul class="cc-points">
        <li>Lighter DI — no class-validator</li>
        <li>Native wire protocol, not TypeORM</li>
        <li>2 runtime deps total</li>
        <li>Faster cold start</li>
      </ul>
    </div>
    <div class="st-compare-card">
      <div class="cc-vs">vs</div>
      <div class="cc-fw">Spring Boot</div>
      <ul class="cc-points">
        <li>Same production depth</li>
        <li>Node.js ecosystem &amp; npm</li>
        <li>Faster cold start, less RAM</li>
        <li>TypeScript type safety</li>
      </ul>
    </div>
    <div class="st-compare-card">
      <div class="cc-vs">vs</div>
      <div class="cc-fw">Laravel</div>
      <ul class="cc-points">
        <li>Statically typed end-to-end</li>
        <li>Memory-safe, no ORM overhead</li>
        <li>Native async/await</li>
        <li>Horizontal scaling via clustering</li>
      </ul>
    </div>
    <div class="st-compare-card">
      <div class="cc-vs">vs</div>
      <div class="cc-fw">Django</div>
      <ul class="cc-points">
        <li>Async-native, no GIL</li>
        <li>TypeScript types everywhere</li>
        <li>Horizontal scaling via clustering</li>
        <li>Single language full-stack</li>
      </ul>
    </div>
  </div>
</div>
