---
layout:      default
title:       "Showcase"
nav_order:   8
permalink:   /showcase/
description:  "Built with StreetJS — official reference applications and starters you can clone, run, and learn from."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Showcase</span>
<h1>Built with StreetJS</h1>
<p>Official reference applications and starters — clone any of them, run locally, and use them as the foundation for your own project. Want your project listed here? <a href="https://github.com/hassanmubiru/StreetJS/discussions">Tell us in Discussions</a>.</p>
</div>

<style>
.sc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin:24px 0}
.sc-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--border);background:var(--elevated);border-radius:14px;padding:20px}
.sc-card h3{margin:0;font-size:17px}
.sc-tag{align-self:flex-start;font-size:12px;font-weight:600;color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:999px;padding:2px 10px}
.sc-card p{margin:0;color:var(--text-secondary);font-size:14px}
.sc-links{margin-top:auto;display:flex;gap:14px;font-size:14px;font-weight:600}
.sc-note{border:1px solid var(--border);background:var(--elevated);border-radius:12px;padding:16px 18px;color:var(--text-secondary)}
</style>

<div class="sc-grid">

<div class="sc-card">
<span class="sc-tag">Reference app</span>
<h3>REST API</h3>
<p>A typed CRUD API with controllers, services, repositories, validation, and OpenAPI generation.</p>
<span class="sc-links"><a href="https://github.com/hassanmubiru/StreetJS/tree/main/examples/01-rest-api">Source</a><a href="{{ '/examples/rest-api/' | relative_url }}">Docs</a></span>
</div>

<div class="sc-card">
<span class="sc-tag">Reference app</span>
<h3>JWT Authentication</h3>
<p>Registration, login, sessions, and protected routes using the built-in auth primitives — no third-party auth library.</p>
<span class="sc-links"><a href="https://github.com/hassanmubiru/StreetJS/tree/main/examples/02-jwt-auth">Source</a><a href="{{ '/security/' | relative_url }}">Docs</a></span>
</div>

<div class="sc-card">
<span class="sc-tag">Reference app</span>
<h3>Background Jobs</h3>
<p>Queued and scheduled work with retries and a job runner — process tasks off the request path.</p>
<span class="sc-links"><a href="https://github.com/hassanmubiru/StreetJS/tree/main/examples/03-background-jobs">Source</a><a href="{{ '/examples/' | relative_url }}">Docs</a></span>
</div>

<div class="sc-card">
<span class="sc-tag">Reference app</span>
<h3>Realtime Chat</h3>
<p>WebSocket channels, presence, and live message delivery with bounded connections and heartbeats.</p>
<span class="sc-links"><a href="https://github.com/hassanmubiru/StreetJS/tree/main/examples/04-realtime-chat">Source</a><a href="{{ '/examples/websocket-chat/' | relative_url }}">Docs</a></span>
</div>

<div class="sc-card">
<span class="sc-tag">Reference app</span>
<h3>Live Dashboard</h3>
<p>Server-sent events and realtime channels streaming metrics to a live, auto-updating dashboard.</p>
<span class="sc-links"><a href="https://github.com/hassanmubiru/StreetJS/tree/main/examples/05-live-dashboard">Source</a><a href="{{ '/realtime-channels/' | relative_url }}">Docs</a></span>
</div>

<div class="sc-card">
<span class="sc-tag">Reference app</span>
<h3>Multiplayer</h3>
<p>Low-latency multiplayer state sync over WebSockets — rooms, broadcast, and per-connection state.</p>
<span class="sc-links"><a href="https://github.com/hassanmubiru/StreetJS/tree/main/examples/06-multiplayer">Source</a><a href="{{ '/realtime-channels/' | relative_url }}">Docs</a></span>
</div>

</div>

## Starters

Scaffold a new project with either backend or a full-stack frontend in one command:

```bash
# Backend only (SQLite by default — zero config)
npx @streetjs/cli create my-app

# With a Next.js or React frontend
npx @streetjs/cli create my-app --frontend next
npx @streetjs/cli create my-app --frontend react
```

See the [Getting Started guide]({{ '/getting-started/' | relative_url }}) for the full walkthrough, and [Examples]({{ '/examples/' | relative_url }}) for runnable code.

## Add your project

<div class="sc-note">
Shipping something with StreetJS? Open a post in <a href="https://github.com/hassanmubiru/StreetJS/discussions">GitHub Discussions</a> with your project name, a short description, your industry, and a link. Community projects featured here are listed with their authors' consent.
</div>
