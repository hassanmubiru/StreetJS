# StreetJS Framework Website — Enterprise Audit Report

> **Audit Team:** Senior UI/UX Designer, DevRel Lead, Documentation Architect, Frontend Architect, Growth Strategist, SEO Specialist, Accessibility Expert, Performance Engineer, Brand Designer, Product Marketing Expert
> **Date:** May 31, 2026
> **Site:** https://hassanmubiru.github.io/street
> **Repository:** https://github.com/hassanmubiru/StreetJS

---

## Executive Summary

StreetJS Framework has the technical foundation of a world-class framework — zero-dependency Node.js core architecture, PostgreSQL wire protocol driver, DI container, JWT, WebSockets, clustering, and a CLI toolchain. The **codebase is enterprise-grade**. The **documentation is comprehensive**. The **website is critically broken**.

### Critical Finding

The homepage (`docs/index.md`) contains **zero HTML body content** — only ~12KB of CSS variable definitions and class stubs with no `<div>`, `<section>`, `<h1>`, `<p>`, or button markup. A visitor sees a **blank white page** with no text, no hero, no CTAs, no navigation body content. The CSS defines `s-hero`, `s-term`, `s-stats`, `s-steps` classes but never uses them in markup.

The documentation subpages render via the just-the-docs Jekyll theme and are functional but generic.

This audit addresses everything needed to transform StreetJS Framework's web presence from invisible to world-class.

---

## Phase 1 — First Impression Audit

### Scores

| Category | Score | Rationale |
|---|---|---|
| **Design** | 2/10 | CSS design tokens are competent, but zero rendered content means zero design. The just-the-docs theme is generic. |
| **Branding** | 1/10 | No brand identity visible. The name "StreetJS" has no logo, no icon, no visual identity. |
| **Professionalism** | 1/10 | A blank homepage with CSS alone is amateurish and signals abandonment. |
| **Trust** | 1/10 | No social proof, no stats, no testimonials, no visible project. |
| **Developer Appeal** | 3/10 | The codebase itself is compelling, but the website actively repels developers. A developer who finds the GitHub repo will be impressed; one who lands on the website will leave immediately. |

### Verdict

| Question | Answer | Reasoning |
|---|---|---|
| Would a developer trust this framework? | **No** | The website is empty. Trust is zero. |
| Would a startup build on it? | **No** | No visible community, support, or corporate backing. |
| Would an enterprise evaluate it? | **No** | No enterprise section, no case studies, no security certifications visible. |
| What creates doubt immediately? | Empty page, generic theme, no logo, 0 social proof, 1 GitHub star. | |

---

## Phase 2 — Homepage Audit

### Current State

The homepage (`docs/index.md`) is 334 lines of CSS-only with zero HTML content. The CSS defines a comprehensive design system:

- Dark theme (`#060B18` background)
- Electric blue (`#2563EB`) + Indigo (`#6366F1`) palette
- Inter + JetBrains Mono fonts
- Component classes: `.s-hero`, `.s-term`, `.s-stats`, `.s-steps`, `.s-btn`, `.s-badges`
- Animations: `heroOrb`, `blink`

**But no markup uses these classes.** The page renders as a blank document with no hero section, no navigation, no CTAs, no footer, no content.

### Missing Content (Complete List)

- No `<h1>` or headline text
- No subheadline
- No CTA buttons
- No terminal demo
- No feature grid
- No "How It Works" section
- No stats bar
- No testimonials
- No footer
- No navigation
- No logo
- No favicon
- No schema markup
- No Open Graph images
- No social links
- No code examples on homepage

### Rewritten Homepage Content

**Hero Headline:**
> Build production APIs on Node.js core. Zero fat dependencies.

**Hero Subheadline:**
> StreetJS is a TypeScript-first backend framework with a native PostgreSQL wire driver, DI container, JWT auth, WebSockets, and clustering — all built on `node:http`, `node:crypto`, and `node:net`. Two runtime dependencies. Bounded memory. Unlimited potential.

**Primary CTA:**
> `Get Started →` (links to `/getting-started/installation`)

**Secondary CTA:**
> `View on GitHub` (links to GitHub repo)

**Framework Positioning Statement:**
> StreetJS Framework is the TypeScript backend framework for engineers who refuse to compromise. No Express. No Prisma. No Zod. No ORM. Just Node.js core, strict TypeScript, and a zero-compromise architecture that enforces memory safety, security, and performance at every layer. Built for developers who understand that every dependency is a liability.

---

## Phase 3 — Developer Experience Audit

### Current State Assessment

| DX Element | Status | Issues |
|---|---|---|
| **Understanding the framework** | Poor | Empty website provides zero explanation. GitHub README is good but buried. |
| **Installation** | Good | `npm install @streetjs/core` works. CLI scaffolding exists. |
| **Building a project** | Good | `street create my-api` scaffolds a complete project. |
| **Creating an API** | Excellent | Decorator-based controllers (`@Controller`, `@Get`, `@Post`) are clean and intuitive. |
| **Reading documentation** | Fair | just-the-docs theme is functional but not framework-branded. No search on all deployments. |
| **Deploying** | Good | Docker, distroless, Kubernetes configs provided. |

### Friction Points

1. **No interactive playground** — Cannot try StreetJS in the browser
2. **No video tutorials** — Zero screencasts or walkthroughs
3. **No API reference browser** — Only markdown files, no interactive API docs
4. **No migration guide from Express/NestJS** — Missing comparison content
5. **No "Why StreetJS" page** — Missing the elevator pitch
6. **No CLI demo/gif** — README has commands but no visual demo
7. **No StackBlitz/CodeSandbox** — Cannot try without installing
8. **No Discord/community link** — No place to ask questions

### Recommended Onboarding Flow

```
Landing Page → "Get Started" → Interactive Install Command (copy button)
    → "Your First API" (5-minute tutorial)
    → "Core Concepts" (DI, Routing, Controllers)
    → "Real-World Example" (REST API with PostgreSQL)
    → "Deploy to Production"
```

---

## Phase 4 — Documentation Audit

### Current Documentation Structure

```
Getting Started
├── Installation
├── First Server
├── Configuration
├── Project Structure

Core
├── Dependency Injection
├── Routing
├── Controllers
├── Services
├── Middleware
├── OpenAPI

Database
├── PostgreSQL Wire Driver
├── Repositories

Security
├── JWT
├── Sessions, Vault, Rate Limiter, XSS

Realtime
├── WebSocket

Performance
├── Telemetry

Storage
├── Multipart Uploads

CLI
├── Commands

Testing
├── Integration Tests

Deployment
├── Docker
├── Hosting Guide

Examples
├── REST API
├── User API
├── WebSocket Chat
├── File Upload
├── Streaming Query

Use Cases
FAQ
Roadmap
Changelog
Contributing
```

### Problems

1. **No search engine visibility** — just-the-docs search only works in-browser
2. **No API reference** — No generated TypeDoc/API docs
3. **No interactive examples** — All code is static
4. **No video content** — Zero screencasts
5. **No enterprise section** — Missing compliance, security, scaling docs
6. **No migration guides** — Missing "From Express", "From NestJS"
7. **No debugging guide** — Only in testing section
8. **No performance benchmarks** — Missing comparison numbers
9. **No tutorial series** — No progressive learning path
10. **No glossary** — Missing terminology reference
11. **No dark/light theme toggle** — Dark-only with just-the-docs

### Ideal Documentation Structure

```
Getting Started
├── What is StreetJS? (2-min overview)
├── Installation
├── Quick Start (5-min tutorial)
├── Your First API
├── Project Structure
├── Configuration

Core Concepts
├── Dependency Injection
├── Routing
├── Controllers
├── Services (Business Logic)
├── Middleware Pipeline
├── Error Handling
├── Validation
├── OpenAPI / Swagger

Database
├── PostgreSQL Wire Protocol Driver
├── Connection Pooling
├── Repositories (Data Access)
├── Transactions
├── Migrations
├── Raw SQL Queries
├── Streaming Queries

Security
├── Authentication Overview
├── JWT (Tokens)
├── Session Management (AES-256-GCM)
├── Vault Mode (Encrypted Config)
├── Rate Limiting (Sliding Window)
├── XSS Sanitization
├── CORS
├── Security Headers
├── Production Security Checklist

Realtime
├── WebSocket Server
├── Server-Sent Events (SSE)
├── Broadcasting & Rooms
├── Authentication

Caching
├── LRU Cache
├── Cache-Aside Pattern
├── TTL & Eviction

Performance
├── Telemetry & Metrics
├── Ring Buffer Monitoring
├── Memory Safety
├── Benchmarking
├── Load Testing

Clustering & Scaling
├── Multi-Core Clustering
├── Horizontal Scaling
├── Load Balancer Setup
├── Kubernetes Deployment

Testing
├── Unit Testing
├── Integration Testing
├── E2E Testing
├── Memory Leak Tests
├── Load Tests

CLI Reference
├── street create
├── street dev
├── street build
├── street start
├── street test
├── street generate
├── street migrate:create
├── street migrate:run
├── Global Flags

Deployment
├── Docker (Multi-stage, Distroless)
├── Docker Compose
├── Production Hardening
├── Reverse Proxy (nginx)
├── CI/CD Pipeline
├── Kubernetes
├── Hosting Guides (Railway, Fly, AWS, DigitalOcean)

API Reference
├── StreetApp
├── StreetContext
├── Controllers & Decorators
├── Router
├── Container (DI)
├── Database
├── Security Services
├── WebSocket
├── Cache
├── Telemetry

Tutorials
├── Building a Blog API
├── Real-Time Chat Application
├── File Upload Service
├── Multi-Tenant SaaS Backend
├── Microservices with StreetJS

Migration Guides
├── From Express.js
├── From NestJS
├── From Fastify
├── From Laravel

Enterprise
├── Compliance (SOC2, HIPAA)
├── Security Architecture
├── High Availability
├── Disaster Recovery
├── Monitoring & Alerting
├── Audit Logging

Community
├── Contributing
├── Code of Conduct
├── Plugin Development Guide
├── Showcase
├── GitHub Discussions

Reference
├── Changelog
├── Roadmap
├── FAQ
├── Glossary
├── Troubleshooting
```

---

## Phase 5 — UI/UX Redesign

### Recommended Architecture

Inspired by laravel.com, nextjs.org, astro.build, nestjs.com, supabase.com.

### Homepage Wireframe

```
┌──────────────────────────────────────────────────┐
│  NAV: [Logo]  Docs  API  Examples  GitHub│npm  │
├──────────────────────────────────────────────────┤
│                                                  │
│   ┌────── HERO ──────────────────────────┐      │
│   │  ● v1.0.1  •  MIT  •  Production     │      │
│   │                                       │      │
│   │  Build production APIs                │      │
│   │  on Node.js core.                     │      │
│   │  Zero fat dependencies.               │      │
│   │                                       │      │
│   │  TypeScript-first backend with native │      │
│   │  PostgreSQL, DI, JWT, WebSockets.     │      │
│   │  2 deps. Bounded memory.              │      │
│   │                                       │      │
│   │  [Get Started →]  [View on GitHub]    │      │
│   │                                       │      │
│   │  npm create @streetjs/app my-api      │      │
│   │  $ npm install                        │      │
│   │  $ street dev                         │      │
│   │                                       │      │
│   └───────────────────────────────────────┘      │
│                                                  │
│  ┌───── SOCIAL PROOF ─────────────────────┐      │
│  │  2 deps  •  0 CVEs  •  52 tests  • MIT │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── HOW IT WORKS ─────────────────────┐      │
│  │  1. Install    2. Code     3. Deploy   │      │
│  │  npm create     @Controller   Docker   │      │
│  │  or npm i       @Get          Fly.io   │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── CODE EXAMPLE ─────────────────────┐      │
│  │  import { streetApp, Controller, Get } │      │
│  │  import type { StreetContext }          │      │
│  │                                         │      │
│  │  @Controller('/api')                    │      │
│  │  class HelloController {                │      │
│  │    @Get('/hello')                       │      │
│  │    async hello(ctx: StreetContext) {    │      │
│  │      ctx.json({ msg: 'Hello!' })        │      │
│  │    }                                    │      │
│  │  }                                      │      │
│  │                                         │      │
│  │  const app = streetApp({ port: 3000 })  │      │
│  │  app.registerController(HelloController)│      │
│  │  await app.listen()                     │      │
│  │  // > Listening on :3000               │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── FEATURES GRID ────────────────────┐      │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │      │
│  │  │  DI   │ │Router│ │ PgSQL│ │ JWT  │ │      │
│  │  │Container│ │Regex │ │ Wire │ │Auth  │ │      │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ │      │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │      │
│  │  │WebSkt│ │Cache │ │Cluster│ │ Open │ │      │
│  │  │+ SSE │ │ LRU  │ │Coord │ │ API  │ │      │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── WHY STREET ──────────────────────┐      │
│  │  No Express  •  No Prisma  •  No Zod  │      │
│  │  No ORM      •  No body-parser        │      │
│  │  No JWT lib  •  No validation lib     │      │
│  │                                       │      │
│  │  Bounded memory • Backpressure        │      │
│  │  Security-first • Production-ready    │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── PERFORMANCE ─────────────────────┐      │
│  │  [Benchmark chart comparing StreetJS    │      │
│  │   vs Express vs Fastify vs NestJS]    │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── DOCS PREVIEW ────────────────────┐      │
│  │  Quick Start  │  Guide  │  API Ref   │      │
│  │  [Search bar]                         │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── COMMUNITY ───────────────────────┐      │
│  │  GitHub ★ 1  │  npm downloads  │  Discord  │  │
│  │  Contributors  │  GitHub Discussions  │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── ROADMAP ─────────────────────────┐      │
│  │  v1.1 — Hot Reload, MySQL Driver      │      │
│  │  v1.2 — OpenTelemetry, Logging        │      │
│  │  v1.3 — OAuth 2.0, RBAC              │      │
│  │  v2.0 — HTTP/2, gRPC, Edge Runtime   │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── SPONSORS ────────────────────────┐      │
│  │  [Become a sponsor →]                  │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  ┌───── FOOTER ──────────────────────────┐      │
│  │  Docs  │  API  │  GitHub  │  npm      │      │
│  │  License  │  Contributors  │  v1.0.1  │      │
│  │  © 2026 StreetJS Contributors           │      │
│  └────────────────────────────────────────┘      │
└──────────────────────────────────────────────────┘
```

### Navigation Redesign

**Top Navigation:**
```
[StreetJS Logo]  Docs  API Reference  Examples  Blog  GitHub  npm  ★ Star
```

**Sidebar Navigation (Documentation):**
Collapsible tree with search, matching just-the-docs but with custom branding.

### CTA Placement

| Position | CTA | Purpose |
|---|---|---|
| Hero (primary) | `Get Started →` | Conversion |
| Hero (secondary) | `View on GitHub` | Social proof |
| After code example | `Try it yourself →` | Engagement |
| After features | `Start building →` | Conversion |
| Footer | `Star on GitHub` | Growth |
| Every doc page | `Edit this page` | Community contribution |

---

## Phase 6 — Branding & Visual Identity

### Color Palette Recommendation

**WINNER: Option D — Custom: Electric Blue + Teal + Indigo**

Rationale: Electric Blue (`#2563EB`) is the primary choice of Next.js, NestJS, and many developer tools because it signals trust, professionalism, and reliability. Adding Teal (`#14B8A6`) as an accent provides differentiation from the sea of blue-only frameworks. Indigo (`#6366F1`) bridges the two.

### Color System

#### Primary Colors

| Token | HEX | Usage |
|---|---|---|
| `--st-primary` | `#2563EB` | Primary buttons, links, active states |
| `--st-primary-hover` | `#1D4ED8` | Button hover, link hover |
| `--st-primary-active` | `#1E40AF` | Button active/pressed |

#### Secondary Colors

| Token | HEX | Usage |
|---|---|---|
| `--st-secondary` | `#14B8A6` | Accent elements, badges, highlights |
| `--st-secondary-hover` | `#0D9488` | Accent hover states |
| `--st-secondary-active` | `#0F766E` | Accent active states |

#### Status Colors

| Token | HEX | Usage |
|---|---|---|
| `--st-success` | `#22C55E` | Success states, passing tests, healthy |
| `--st-warning` | `#F59E0B` | Warnings, deprecation notices |
| `--st-error` | `#EF4444` | Errors, failures, critical |
| `--st-info` | `#3B82F6` | Informational, neutral notices |

#### Light Theme

| Token | HEX | Usage |
|---|---|---|
| `--st-bg` | `#FFFFFF` | Page background |
| `--st-surface` | `#F8FAFC` | Secondary surfaces |
| `--st-card` | `#FFFFFF` | Cards, dropdowns, modals |
| `--st-border` | `#E2E8F0` | Borders, dividers |
| `--st-text-primary` | `#0F172A` | Primary text |
| `--st-text-secondary` | `#64748B` | Secondary/muted text |

#### Dark Theme

| Token | HEX | Usage |
|---|---|---|
| `--st-bg` | `#060B18` | Page background |
| `--st-surface` | `#0A0F1E` | Secondary surfaces |
| `--st-card` | `#111827` | Cards, dropdowns, modals |
| `--st-border` | `#1E2D4A` | Borders, dividers |
| `--st-text-primary` | `#F8FAFC` | Primary text |
| `--st-text-secondary` | `#94A3B8` | Secondary/muted text |

---

## Phase 7 — Typography System

### Recommendation

| Role | Font | Weight Range | Fallback |
|---|---|---|---|
| **Headings** | **Inter** | 600–900 | system-ui, sans-serif |
| **Body** | **Inter** | 400–500 | system-ui, sans-serif |
| **Code** | **JetBrains Mono** | 400–500 | SFMono-Regular, Consolas, monospace |

### Rationale

Inter is the industry standard for developer tools (used by Vercel, GitHub, GitLab, Supabase). It's optimized for screens with excellent readability at small sizes. JetBrains Mono has ligatures for `=>`, `===`, `->` that enhance code readability. This combination is used by the most successful developer-first companies.

### Comparison

| Font | Legibility | Character Set | Performance | Aesthetic | Verdict |
|---|---|---|---|---|---|
| **Inter** | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | **WINNER** |
| Geist | ★★★★ | ★★★★ | ★★★★★ | ★★★★★ | Good but new, less proven |
| Manrope | ★★★★ | ★★★ | ★★★★ | ★★★★ | Too narrow for code |
| IBM Plex Sans | ★★★★★ | ★★★★ | ★★★ | ★★★★ | Beautiful but larger files |
| Source Sans Pro | ★★★★ | ★★★★★ | ★★★★ | ★★★ | Dated feel |

### Typography Scale

```css
--st-text-xs:   0.75rem;   /* 12px - Caption */
--st-text-sm:   0.875rem;  /* 14px - Small body */
--st-text-base: 1rem;      /* 16px - Body */
--st-text-lg:   1.125rem;  /* 18px - Large body */
--st-text-xl:   1.25rem;   /* 20px - Subtitle */
--st-text-2xl:  1.5rem;    /* 24px - Small heading */
--st-text-3xl:  1.875rem;  /* 30px - Section heading */
--st-text-4xl:  2.25rem;   /* 36px - Page heading */
--st-text-5xl:  3rem;      /* 48px - Hero heading */
--st-text-6xl:  3.75rem;   /* 60px - Large hero */
```

---

## Phase 8 — Design System

### Complete CSS Variables (Production-Ready)

```css
:root {
  /* ── Brand Colors ── */
  --st-primary:          #2563EB;
  --st-primary-hover:    #1D4ED8;
  --st-primary-active:   #1E40AF;
  --st-primary-subtle:   rgba(37, 99, 235, 0.1);
  --st-secondary:        #14B8A6;
  --st-secondary-hover:  #0D9488;
  --st-secondary-active: #0F766E;

  /* ── Neutral/Gray ── */
  --st-gray-50:   #F8FAFC;
  --st-gray-100:  #F1F5F9;
  --st-gray-200:  #E2E8F0;
  --st-gray-300:  #CBD5E1;
  --st-gray-400:  #94A3B8;
  --st-gray-500:  #64748B;
  --st-gray-600:  #475569;
  --st-gray-700:  #334155;
  --st-gray-800:  #1E293B;
  --st-gray-900:  #0F172A;
  --st-gray-950:  #020617;

  /* ── Status ── */
  --st-success:  #22C55E;
  --st-warning:  #F59E0B;
  --st-error:    #EF4444;
  --st-info:     #3B82F6;

  /* ── Surfaces (Light) ── */
  --st-bg:         #FFFFFF;
  --st-surface:    #F8FAFC;
  --st-card:       #FFFFFF;
  --st-card-hover: #F1F5F9;
  --st-border:     #E2E8F0;
  --st-border-h:   #2563EB;

  /* ── Surfaces (Dark) ── */
  --st-bg-dark:         #060B18;
  --st-surface-dark:    #0A0F1E;
  --st-card-dark:       #111827;
  --st-card-hover-dark: #162035;
  --st-border-dark:     #1E2D4A;

  /* ── Text ── */
  --st-text-primary:   #0F172A;
  --st-text-secondary: #64748B;
  --st-text-muted:     #94A3B8;

  --st-text-primary-dark:   #F8FAFC;
  --st-text-secondary-dark: #94A3B8;
  --st-text-muted-dark:     #475569;

  /* ── Typography ── */
  --st-font-head: 'Inter', system-ui, -apple-system, sans-serif;
  --st-font-body: 'Inter', system-ui, -apple-system, sans-serif;
  --st-font-mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;

  /* ── Font Scale ── */
  --st-text-xs:   0.75rem;
  --st-text-sm:   0.875rem;
  --st-text-base: 1rem;
  --st-text-lg:   1.125rem;
  --st-text-xl:   1.25rem;
  --st-text-2xl:  1.5rem;
  --st-text-3xl:  1.875rem;
  --st-text-4xl:  2.25rem;
  --st-text-5xl:  3rem;
  --st-text-6xl:  3.75rem;

  /* ── Border Radius ── */
  --st-radius-sm:  6px;
  --st-radius:     10px;
  --st-radius-lg:  16px;
  --st-radius-xl:  24px;
  --st-radius-full: 9999px;

  /* ── Spacing ── */
  --st-space-0:   0;
  --st-space-1:   0.25rem;
  --st-space-2:   0.5rem;
  --st-space-3:   0.75rem;
  --st-space-4:   1rem;
  --st-space-5:   1.25rem;
  --st-space-6:   1.5rem;
  --st-space-8:   2rem;
  --st-space-10:  2.5rem;
  --st-space-12:  3rem;
  --st-space-16:  4rem;
  --st-space-20:  5rem;
  --st-space-24:  6rem;

  /* ── Shadows ── */
  --st-shadow-sm:   0 1px 2px rgba(0, 0, 0, 0.05);
  --st-shadow:      0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
  --st-shadow-md:   0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.06);
  --st-shadow-lg:   0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05);
  --st-shadow-xl:   0 20px 25px rgba(0, 0, 0, 0.1), 0 8px 10px rgba(0, 0, 0, 0.04);
  --st-shadow-blue: 0 4px 24px rgba(37, 99, 235, 0.25);

  /* ── Transitions ── */
  --st-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --st-transition: all 0.18s var(--st-ease);
}

/* ── Dark Mode ── */
[data-theme="dark"] {
  --st-bg:         var(--st-bg-dark);
  --st-surface:    var(--st-surface-dark);
  --st-card:       var(--st-card-dark);
  --st-card-hover: var(--st-card-hover-dark);
  --st-border:     var(--st-border-dark);
  --st-text-primary:   var(--st-text-primary-dark);
  --st-text-secondary: var(--st-text-secondary-dark);
  --st-text-muted:     var(--st-text-muted-dark);
}
```

### Button Styles

```css
.st-btn {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-family: var(--st-font-body);
  font-size: var(--st-text-sm);
  font-weight: 600;
  line-height: 1.25rem;
  border-radius: var(--st-radius);
  border: 1px solid transparent;
  cursor: pointer;
  transition: var(--st-transition);
  text-decoration: none;
  white-space: nowrap;
}

.st-btn-primary {
  background: var(--st-primary);
  color: #fff;
  box-shadow: var(--st-shadow-sm);
}
.st-btn-primary:hover {
  background: var(--st-primary-hover);
  transform: translateY(-1px);
  box-shadow: var(--st-shadow-md);
}
.st-btn-primary:active {
  background: var(--st-primary-active);
  transform: translateY(0);
}

.st-btn-secondary {
  background: var(--st-surface);
  color: var(--st-text-primary);
  border-color: var(--st-border);
}
.st-btn-secondary:hover {
  border-color: var(--st-primary);
  color: var(--st-primary);
  background: var(--st-primary-subtle);
}

.st-btn-ghost {
  background: transparent;
  color: var(--st-text-secondary);
}
.st-btn-ghost:hover {
  background: var(--st-surface);
  color: var(--st-text-primary);
}

.st-btn-sm { padding: 0.375rem 0.75rem; font-size: var(--st-text-xs); }
.st-btn-lg { padding: 0.75rem 1.5rem; font-size: var(--st-text-base); }
```

### Card Styles

```css
.st-card {
  background: var(--st-card);
  border: 1px solid var(--st-border);
  border-radius: var(--st-radius-lg);
  padding: var(--st-space-6);
  transition: var(--st-transition);
}
.st-card:hover {
  border-color: var(--st-border-h);
  box-shadow: var(--st-shadow-md);
}
```

### Alert Styles

```css
.st-alert {
  display: flex; gap: var(--st-space-3);
  padding: var(--st-space-4);
  border-radius: var(--st-radius);
  border-left: 3px solid;
  font-size: var(--st-text-sm);
  line-height: 1.5;
}
.st-alert-info    { border-color: var(--st-info);   background: rgba(59,130,246,0.08); }
.st-alert-success { border-color: var(--st-success); background: rgba(34,197,94,0.08); }
.st-alert-warning { border-color: var(--st-warning); background: rgba(245,158,11,0.08); }
.st-alert-error   { border-color: var(--st-error);  background: rgba(239,68,68,0.08); }
```

### Documentation Code Blocks

```css
.st-code-block {
  background: #080D18;
  border: 1px solid var(--st-border-dark);
  border-radius: var(--st-radius);
  overflow: hidden;
  margin: var(--st-space-6) 0;
}
.st-code-header {
  display: flex; align-items: center;
  padding: var(--st-space-3) var(--st-space-4);
  background: #0A1020;
  border-bottom: 1px solid var(--st-border-dark);
  gap: var(--st-space-2);
}
.st-code-dot {
  width: 10px; height: 10px; border-radius: 50%;
}
.st-code-filename {
  font-family: var(--st-font-mono);
  font-size: var(--st-text-xs);
  color: var(--st-text-muted-dark);
  margin-left: auto;
}
.st-code-body {
  padding: var(--st-space-4);
  font-family: var(--st-font-mono);
  font-size: var(--st-text-sm);
  line-height: 1.7;
  overflow-x: auto;
}
```

---

## Phase 9 — SEO Audit

### Current Issues

| Issue | Severity | Details |
|---|---|---|
| No meta description on homepage | CRITICAL | Jekyll frontmatter has description but it's not rendered |
| No Open Graph image | CRITICAL | No `og:image` tag — shares will have no preview |
| No structured data | HIGH | No JSON-LD for software application |
| No h1 on homepage | CRITICAL | No visible heading content |
| No sitemap | HIGH | Sitemap is generated by jekyll-sitemap plugin but no actual pages indexed |
| Blank page content | CRITICAL | Search engines index the CSS, not the content |
| No canonical URLs | MEDIUM | Missing canonical tags |
| No social cards | HIGH | Twitter cards not configured |
| No logo image | MEDIUM | Site logo referenced but no actual image |
| No favicon | LOW | No browser tab icon |

### Recommended Metadata

**Homepage Title:**
> StreetJS Framework — TypeScript Backend Framework for Production APIs

**Homepage Meta Description:**
> StreetJS is a production-grade TypeScript backend framework built on Node.js core. Native PostgreSQL driver, DI container, JWT auth, WebSockets, and clustering — with zero framework dependencies. Bounded memory, security-first.

**Open Graph:**
```html
<meta property="og:title" content="StreetJS Framework — TypeScript Backend Framework" />
<meta property="og:description" content="Build production APIs on Node.js core. Zero fat dependencies." />
<meta property="og:image" content="https://hassanmubiru.github.io/street/assets/images/og-image.png" />
<meta property="og:url" content="https://hassanmubiru.github.io/street" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="StreetJS Framework — TypeScript Backend Framework" />
<meta name="twitter:description" content="Build production APIs on Node.js core. Zero fat dependencies." />
<meta name="twitter:image" content="https://hassanmubiru.github.io/street/assets/images/og-image.png" />
```

**Structured Data (JSON-LD):**
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "StreetJS Framework",
  "applicationCategory": "Backend Framework",
  "operatingSystem": "Linux, macOS, Windows",
  "description": "Production-grade TypeScript backend framework built on Node.js core.",
  "url": "https://hassanmubiru.github.io/street",
  "downloadUrl": "https://www.npmjs.com/package/@streetjs/core",
  "license": "https://opensource.org/licenses/MIT",
  "programmingLanguage": "TypeScript",
  "softwareVersion": "1.0.1"
}
```

---

## Phase 10 — Performance Audit

### Current Issues

| Issue | Impact | Fix |
|---|---|---|
| Google Fonts render-blocking | HIGH | Use `display=swap` and preconnect (already partially done) |
| No CSS minification | MEDIUM | ~12KB of inline CSS could be minified to ~6KB |
| No caching strategy | MEDIUM | GitHub Pages provides some caching, but no explicit strategy |
| No image optimization | LOW | No images currently on site |
| No code splitting | N/A | No JS on site currently |
| No lazy loading | N/A | No assets to lazy load |
| Just-the-docs theme CSS | MEDIUM | Theme loads ~50KB of CSS on every page |

### Ranked Fixes

1. **Add actual HTML content** — The biggest performance and UX win
2. **Minimize CSS** — Purge unused just-the-docs styles, inline critical CSS
3. **Optimize Google Fonts** — Use `preload` for Inter Regular + Bold, subset to latin
4. **Add service worker** — Cache documentation pages for offline access
5. **Use responsive images** — For documentation screenshots and diagrams
6. **Enable Brotli** — Via Cloudflare or CDN (GH Pages doesn't support custom compression)

---

## Phase 11 — Accessibility Audit

### Current Issues

| Issue | WCAG Criterion | Severity |
|---|---|---|
| **No semantic HTML** | 1.3.1 | CRITICAL |
| **No heading hierarchy** | 1.3.1 | CRITICAL |
| **No skip-to-content link** | 2.4.1 | HIGH |
| **No ARIA landmarks** | 1.3.1 | HIGH |
| **Color contrast on just-the-docs** | 1.4.3 | MEDIUM (theme default may have issues) |
| **No keyboard navigation testing** | 2.1.1 | MEDIUM |
| **No focus indicators** | 2.4.7 | MEDIUM |
| **No reduced motion support** | 1.4.4 | LOW (CSS animations exist) |
| **No screen reader testing** | 4.1.2 | HIGH |
| **No alt text on images** | 1.1.1 | N/A (no images) |

### Recommendations

1. Add semantic HTML structure (`<header>`, `<nav>`, `<main>`, `<footer>`, `<article>`, `<section>`)
2. Add skip-to-content link as first focusable element
3. Ensure proper heading hierarchy (h1 → h2 → h3, never skip levels)
4. Add `aria-label` to navigation elements
5. Add `focus-visible` styles (partially done in custom.scss)
6. Implement prefers-reduced-motion media query (partially done)
7. Test with NVDA/VoiceOver
8. Ensure all interactive elements are keyboard-accessible
9. Add proper form labels on search
10. Use `prefers-color-scheme` for theme switching

---

## Phase 12 — Open Source Growth Strategy

### GitHub Presentation Issues

| Issue | Impact |
|---|---|
| **1 star, 0 forks, 0 watchers** | Social proof is critically low. No one adopts a framework with 1 star. |
| **No GitHub Sponsors** | No financial sustainability path |
| **No issue templates** | Missing Bug Report, Feature Request templates |
| **No PR template** | Missing standardized PR format |
| **No code of conduct** | Should link to Contributor Covenant |
| **No security policy** | Missing SECURITY.md |
| **No community discussions** | GitHub Discussions not enabled |
| **No release automation** | Manual release process |

### Growth Strategy Recommendations

| Priority | Action | Expected Impact |
|---|---|---|
| P0 | Fix the website (blank page is killer) | High |
| P1 | Create video content (5-min "Build an API with StreetJS") | High |
| P2 | Write "Why StreetJS" blog posts comparing to Express/NestJS | High |
| P3 | Create GitHub Discussions for community | Medium |
| P4 | Add issue/PR templates | Medium |
| P5 | Create CodeSandbox/StackBlitz starter | Medium |
| P6 | Publish benchmarks vs Express, Fastify, NestJS | Medium |
| P7 | Add GitHub Sponsors | Low (requires traction) |
| P8 | Create plugin ecosystem guide | Low |
| P9 | Create showcase page for projects using StreetJS | Low |
| P10 | Write migration guides (Express → StreetJS, NestJS → StreetJS) | Medium |

### Community Page Content

```
Community
├── GitHub Discussions
├── Discord Server
├── Stack Overflow
├── Contributing Guide
├── Code of Conduct
├── Showcase (projects built with StreetJS)
├── Plugin Development
└── Becoming a Sponsor
```

---

## Phase 13 — Competitor Analysis

### Comparison Table

| Criteria | StreetJS | Next.js | NestJS | Laravel | Astro | Nuxt |
|---|---|---|---|---|---|---|
| **Branding** | ✗ None | ★★★★★ | ★★★★ | ★★★★★ | ★★★★★ | ★★★★ |
| **Website** | ✗ Broken | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ |
| **Docs Quality** | ★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ |
| **DX** | ★★★★ | ★★★★★ | ★★★★ | ★★★★★ | ★★★★★ | ★★★★ |
| **Ecosystem** | ✗ None | ★★★★★ | ★★★★ | ★★★★★ | ★★★★ | ★★★★ |
| **Community** | ✗ None | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ |
| **Adoption** | ✗ 1 star | ★★★★★ | ★★★★ | ★★★★★ | ★★★★★ | ★★★★ |
| **Performance** | ★★★★★ | ★★★★ | ★★★ | ★★★ | ★★★★★ | ★★★★ |

### Key Differentiators StreetJS Must Emphasize

1. **Zero framework dependencies** — No Express, no Zod, no Prisma, no ORM
2. **Bounded memory** — Every component has an enforced memory cap
3. **Node.js core native** — Built on `node:http`, `node:net`, `node:crypto`, `node:stream`, `node:cluster`
4. **Custom PostgreSQL wire protocol driver** — No `pg` dependency, streaming row-by-row
5. **Security-first architecture** — SCRAM-SHA-256, AES-256-GCM, timing-safe JWT

### Competitive Positioning

**StreetJS should not compete head-to-head with Next.js or Laravel.** It should position as:

> The TypeScript framework for engineers who value control over convenience, memory safety over magic, and Node.js core over abstractions.

Target audience: Senior backend engineers, performance-critical applications, fintech, healthcare, real-time systems — where every dependency is audited and memory leaks are unacceptable.

---

## Phase 14 — Complete Redesign Plan

### Implementation Priorities

```
P0 — CRITICAL (Do immediately)
├── Add HTML content to homepage (hero, features, CTAs, footer)
├── Add logo and favicon
├── Fix Open Graph tags and meta description
└── Add sitemap with all pages

P1 — HIGH (Next sprint)
├── Custom brand theme for just-the-docs (overwrite complete)
├── Create OG image (1200×630)
├── Add dark/light theme toggle
├── Add interactive code examples
├── Add "Edit on GitHub" to every doc page
└── Create Getting Started video

P2 — MEDIUM (Next month)
├── Build custom homepage (separate from just-the-docs theme)
├── Add search that works on GitHub Pages
├── Create API reference with TypeDoc
├── Add community page with Discord link
├── Create showcase page
└── Add performance benchmarks

P3 — LOW (Next quarter)
├── Add interactive playground (StackBlitz/ CodeSandbox)
├── Add blog section
├── Add plugin marketplace
├── Add enterprise documentation
├── Add video tutorial series
└── Full migration from just-the-docs to custom design
```

### Implementation Details

#### Step 1: Fix the Homepage (Today)

The `docs/index.md` needs actual HTML content using the CSS classes already defined:

```html
<div class="sp">
  <section class="s-hero">
    <div class="s-hero-inner">
      <div class="s-hero-pill">
        <span class="dot"></span>
        v1.0.1 — Production Ready
      </div>
      <h1 class="gt">Build production APIs<br/>on <span class="gt-blue">Node.js core</span></h1>
      <p class="s-hero-sub">
        StreetJS is a TypeScript-first backend framework with native PostgreSQL,
        dependency injection, JWT auth, WebSockets, and clustering —
        <strong>with zero framework dependencies.</strong>
      </p>
      <p class="s-hero-nodeps">
        Built on <span>node:http</span> · <span>node:crypto</span> · <span>node:net</span> · <span>node:stream</span> · <span>node:cluster</span>
      </p>
      <div class="s-btns">
        <a href="/street/getting-started/installation" class="s-btn s-btn-primary">
          Get Started →
        </a>
        <a href="https://github.com/hassanmubiru/StreetJS" class="s-btn s-btn-ghost">
          View on GitHub
        </a>
      </div>
    </div>
  </section>
</div>
```

#### Step 2: Create Logo

**Text Logo:** "StreetJS" in Inter Bold with a subtle blue accent bar above the 't'. The mark should be a simplified road/street icon — two parallel lines that form an 'S' shape.

**Favicon:** 32×32 SVG of the street mark icon, blue on transparent.

#### Step 3: Theme Migration Path

| Phase | Theme | Timeline |
|---|---|---|
| Now (P0) | just-the-docs with custom SCSS overrides | Week 1 |
| Next (P1) | just-the-docs with complete brand theme | Week 2-3 |
| Future (P3) | Custom static site (Astro or 11ty) | Month 2-3 |

---

## Final Scores

### Category Scores

| Category | Current Score | Target Score |
|---|---|---|
| **Design** | 2/10 | 9/10 |
| **Branding** | 1/10 | 8/10 |
| **Professionalism** | 1/10 | 9/10 |
| **Trust** | 1/10 | 7/10 |
| **Developer Appeal** | 3/10 | 9/10 |
| **Documentation** | 6/10 | 9/10 |
| **SEO** | 1/10 | 8/10 |
| **Accessibility** | 2/10 | 8/10 |
| **Performance** | 5/10 | 9/10 |
| **Community Growth** | 1/10 | 6/10 |

### Overall Score

**Current: 23/100**

**Target after implementation: 82/100**

---

## Top 50 Priority Improvements

1. **Add HTML content to homepage** (hero, features, CTAs, terminal demo, stats)
2. **Create logo and favicon** (SVG, 32×32, 180×180 apple-touch-icon)
3. **Add Open Graph meta tags** (title, description, image, url, type)
4. **Add Twitter Card meta tags**
5. **Add JSON-LD structured data** (SoftwareApplication)
6. **Fix meta description** on every page
7. **Generate OG image** (1200×630 with gradient background + framework name)
8. **Add sitemap.xml** (jekyll-sitemap is configured but needs all pages)
9. **Add robots.txt** (already exists, OK)
10. **Add skip-to-content link** for accessibility
11. **Add ARIA landmarks** (banner, navigation, main, content-info)
12. **Fix heading hierarchy** (ensure single h1 per page)
13. **Add focus-visible styles** (partially done)
14. **Add prefers-reduced-motion support** (partially done)
15. **Test keyboard navigation** across all pages
16. **Test with screen reader** (NVDA, VoiceOver)
17. **Ensure proper color contrast** (WCAG AA minimum 4.5:1)
18. **Theme the just-the-docs sidebar** with brand colors
19. **Create custom 404 page**
20. **Add version selector** in docs (for different StreetJS versions)
21. **Add "Edit on GitHub" link** (already configured, good)
22. **Add dark/light theme toggle** to docs
23. **Create "Why StreetJS" comparison page**
24. **Create migration guides** (Express → StreetJS, NestJS → StreetJS)
25. **Add interactive code examples** (CodeSandbox/StackBlitz)
26. **Add CLI demo GIF** to README
27. **Record getting-started screencast** (< 5 min)
28. **Create API reference** with TypeDoc
29. **Add search functionality** that works on GitHub Pages (Algolia DocSearch)
30. **Add community page** with Discord/Discussions link
31. **Create showcase page** with projects using StreetJS
32. **Add performance benchmarks** vs Express, Fastify, NestJS
33. **Create troubleshooting guide** with common errors
34. **Add quick-start template** on homepage (copy-paste code)
35. **Add social proof section** (npm downloads, GitHub stars, test count)
36. **Create hero animation** (subtle gradient + dot grid is good, build on it)
37. **Add terminal animation** in hero showing `npm create @streetjs/app`
38. **Redesign navigation** with "Star on GitHub" CTA
39. **Add GitHub Discussions link**
40. **Add issue templates** (Bug Report, Feature Request)
41. **Add PR template**
42. **Add SECURITY.md** for vulnerability reporting
43. **Add CODE_OF_CONDUCT.md** (Contributor Covenant)
44. **Create CONTRIBUTING.md** video version
45. **Add GitHub Sponsors** button
46. **Create plugin development guide**
47. **Add enterprise documentation** section
48. **Create blog** for release announcements and tutorials
49. **Add analytics** (Plausible or Umami, privacy-focused)
50. **Set up custom domain** (streetjs.dev or street-framework.dev)

---

## Conclusion

StreetJS Framework has **exceptional technical quality** — the codebase is clean, well-architected, and genuinely innovative in its zero-dependency approach. The documentation is comprehensive and well-written. The design system CSS is well-structured.

However, the **website is critically broken** — the homepage contains zero HTML body content. This single issue is responsible for ~80% of the low scores across all categories. Fixing this alone would move from 23/100 to ~45/100.

The framework has the potential to stand alongside NestJS, Fastify, and other TypeScript backend frameworks for senior engineers who value control and memory safety. But without a professional website, it remains invisible.

**The single highest-impact action:** Add actual HTML markup to `docs/index.md` using the CSS classes already defined. This can be done in under an hour and transforms the site from blank to functional.
