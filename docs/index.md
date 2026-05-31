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
