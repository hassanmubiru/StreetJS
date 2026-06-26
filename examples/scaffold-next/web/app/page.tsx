'use client';

import { useEffect, useState } from 'react';
import { useQuery, useAuth } from '@streetjs/react';

const DOCS = 'https://hassanmubiru.github.io/StreetJS/';
const GITHUB = 'https://github.com/hassanmubiru/StreetJS';
const NPM = 'https://www.npmjs.com/package/streetjs';
const VERSION = 'v1.0.25';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Health { status?: string; uptime?: number }

type RealtimeState = 'connecting' | 'connected' | 'disconnected' | 'unconfigured';

function useRealtimeStatus(apiUrl: string): RealtimeState {
  const [state, setState] = useState<RealtimeState>(apiUrl ? 'connecting' : 'unconfigured');
  useEffect(() => {
    if (!apiUrl || typeof WebSocket === 'undefined') { setState('unconfigured'); return; }
    const wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/realtime';
    let ws: WebSocket | null = null;
    try { ws = new WebSocket(wsUrl); } catch { setState('disconnected'); return; }
    const onOpen = () => setState('connected');
    const onDown = () => setState('disconnected');
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onDown);
    ws.addEventListener('close', onDown);
    return () => { ws?.removeEventListener('open', onOpen); ws?.removeEventListener('error', onDown); ws?.removeEventListener('close', onDown); ws?.close(); };
  }, [apiUrl]);
  return state;
}

const QUICKSTART = ['npx @streetjs/cli create my-app', 'cd my-app', 'npm install', 'npm run dev'];

const FEATURES: Array<{ title: string; desc: string }> = [
  { title: 'Authentication', desc: 'JWT authentication, sessions, permissions, and role-based access control.' },
  { title: 'Realtime', desc: 'WebSockets, channels, presence, and live updates.' },
  { title: 'Database', desc: 'SQLite and PostgreSQL support with ORM integration.' },
  { title: 'Jobs & Scheduling', desc: 'Background processing and scheduled workloads.' },
  { title: 'Security', desc: 'Plugin signing, provenance, SBOM generation, and a dependency-light architecture.' },
  { title: 'TypeScript First', desc: 'Built for modern TypeScript development from the ground up.' },
];

const WHY: string[] = [
  'Dependency-light architecture',
  'Self-host friendly deployment',
  'Built-in authentication support',
  'Built-in realtime capabilities',
  'Plugin ecosystem',
  'Supply-chain integrity features',
  'TypeScript-first development',
];

const DX: string[] = [
  'Fast project scaffolding',
  'Hot reload',
  'CLI tooling',
  'Modular architecture',
  'Plugin system',
  'API-first workflows',
];

const RESOURCES: Array<{ icon: string; title: string; desc: string; href: string }> = [
  { icon: '📘', title: 'Documentation', desc: 'Guides, references, and concepts.', href: DOCS },
  { icon: '🚀', title: 'Getting Started', desc: 'Build your first app step by step.', href: DOCS + 'getting-started/' },
  { icon: '💻', title: 'GitHub', desc: 'Source code and issues.', href: GITHUB },
  { icon: '🧩', title: 'Examples', desc: 'Reference apps and patterns.', href: DOCS + 'examples/' },
  { icon: '💬', title: 'Community', desc: 'Discussions and support.', href: GITHUB + '/discussions' },
];

export default function Home() {
  const auth = useAuth();
  const health = useQuery<Health>(() => fetch(API_URL + '/health').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }));
  const realtime = useRealtimeStatus(API_URL);
  const [copied, setCopied] = useState(false);

  const backendOk = !health.loading && !health.error;
  const hasSession = Boolean(auth.session);

  const copy = () => {
    try { void navigator.clipboard.writeText(QUICKSTART.join(String.fromCharCode(10))); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  const status: Array<{ label: string; state: 'ok' | 'pending' | 'idle'; detail: string }> = [
    { label: 'Backend Status', state: health.loading ? 'pending' : backendOk ? 'ok' : 'idle', detail: backendOk ? 'Ready' : health.loading ? 'Checking' : 'Not connected' },
    { label: 'API Connectivity', state: health.loading ? 'pending' : backendOk ? 'ok' : 'idle', detail: backendOk ? 'Connected' : health.loading ? 'Checking' : 'Offline' },
    { label: 'Authentication', state: 'ok', detail: hasSession ? 'Signed in' : 'Ready' },
    { label: 'Realtime', state: realtime === 'connected' ? 'ok' : realtime === 'connecting' ? 'pending' : 'idle', detail: realtime === 'connected' ? 'Connected' : realtime === 'connecting' ? 'Connecting' : realtime === 'unconfigured' ? 'Ready' : 'Offline' },
  ];

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">StreetJS</span>
        <nav className="topnav">
          <a href={DOCS}>Docs</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <section className="hero">
        {VERSION ? <span className="pill">{VERSION}</span> : null}
        <h1>Build Production Applications Faster</h1>
        <p className="lead">
          StreetJS is a modern TypeScript backend framework designed for authentication, realtime
          features, APIs, jobs, and databases with a focus on simplicity, performance, and security.
        </p>
        <div className="actions">
          <a className="btn btn-primary" href={DOCS + 'getting-started/'}>Get Started</a>
          <a className="btn btn-ghost" href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </section>

      <section className="quickstart">
        <div className="qs-head">
          <h2 className="section-title">Quick Start</h2>
          <button className="btn btn-small" onClick={copy} type="button">{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div className="codeblock">
          {QUICKSTART.map((line) => (<span key={line} className="code-line"><span className="prompt">$</span> {line}</span>))}
        </div>
        <p className="muted">Create and run a StreetJS application in minutes.</p>
      </section>

      <section>
        <h2 className="section-title">Core Features</h2>
        <div className="grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">Framework Status</h2>
        <div className="status-grid">
          {status.map((s) => (
            <div key={s.label} className="status-card">
              <span className={'dot dot-' + s.state} />
              <div>
                <div className="status-label">{s.label}</div>
                <div className="status-detail">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h2 className="section-title">Why StreetJS</h2>
          <ul className="checklist">
            {WHY.map((w) => (<li key={w}><span className="check">✓</span> {w}</li>))}
          </ul>
        </div>
        <div className="panel">
          <h2 className="section-title">Built for Developers</h2>
          <ul className="checklist">
            {DX.map((d) => (<li key={d}><span className="check">✓</span> {d}</li>))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className="section-title">Resources</h2>
        <div className="grid">
          {RESOURCES.map((r) => (
            <a key={r.title} className="card card-link" href={r.href} target="_blank" rel="noreferrer">
              <span className="card-icon" aria-hidden="true">{r.icon}</span>
              <h3>{r.title}</h3>
              <p>{r.desc}</p>
            </a>
          ))}
        </div>
      </section>

      <footer className="footer">
        <nav className="footer-links">
          <a href={DOCS} target="_blank" rel="noreferrer">Documentation</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
          <a href={NPM} target="_blank" rel="noreferrer">npm</a>
          <a href={DOCS + 'security/'} target="_blank" rel="noreferrer">Security</a>
          <a href={GITHUB + '/discussions'} target="_blank" rel="noreferrer">Community</a>
        </nav>
        <span className="muted">MIT Licensed{VERSION ? ' · StreetJS ' + VERSION : ''}</span>
      </footer>
    </div>
  );
}
