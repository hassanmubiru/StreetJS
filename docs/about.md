---
layout:    default
title:     "About"
nav_order: 95
permalink: /about/
description: "What StreetJS is and why it exists — a comprehensive, dependency-light, supply-chain-safe TypeScript backend framework built on Node.js core."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">About</span>
<h1>About StreetJS</h1>
<p>A batteries-included TypeScript backend framework built straight from Node.js core — auth, realtime, jobs, ORM, AI, and security in one signed, dependency-light runtime.</p>
</div>

## Mission

Make it possible to build and **self-host** a complete, production-grade backend in
TypeScript without assembling a dozen third-party services and dependencies — and
without the cost and lock-in that usually comes with "batteries-included" platforms.

## Why StreetJS exists

Most Node backends are assembled from many libraries (Express + pg + an ORM +
passport + a queue + a realtime SaaS + …). That means more dependencies to audit
and patch, more bills for managed services, and more glue code. StreetJS takes the
opposite bet: **implement the core capabilities in-house, on Node.js primitives,
with a tiny dependency footprint**, and ship them as one coherent framework.

## Philosophy & design principles

1. **Dependency-light.** Core has ~2 runtime dependencies; a native PostgreSQL
   driver (no `pg`), native auth, realtime, and jobs.
2. **Supply-chain integrity first.** Every release ships with npm provenance and an
   SBOM; official plugins are Ed25519-signed and verified against a trust key.
3. **Cohesion over assembly.** Auth, realtime, ORM, jobs, cache, and observability
   are designed to work together, not bolted on.
4. **Production-focused defaults.** Security headers, rate limiting, validation, and
   graceful shutdown are on by default.
5. **Backend-first, additive frontend.** A typed client SDK + React/Vue/Next/Nuxt
   adapters consume public APIs; **no frontend dependency enters core**.
6. **Honesty over hype.** Capabilities are tiered by evidence (verified / implemented
   / partial / gap); the project states plainly what is *not* yet proven.

## Governance

StreetJS is MIT-licensed and governed by a documented model with a Steering
Committee and a public RFC process. See [Community](/community/) and the
[`GOVERNANCE.md`](https://github.com/hassanmubiru/StreetJS/blob/main/GOVERNANCE.md).

## Roadmap vision

The engineering foundation is mature and continuously re-verified in CI (runtime
certification, reproducible builds, signed ecosystem). The next chapter is about
**adoption**: community, contributors, production proof, comparative benchmarks,
and enterprise trust (security audit → pen-test → SOC 2). The plan is public in the
[Go-To-Market Roadmap](/adoption/go-to-market-roadmap/) and the [Roadmap](/roadmap/).

## Status

StreetJS core is published and CI-green. Frontend/UI packages are `0.1.x` previews
(pre-1.0; APIs may change). See the honest [Gap Analysis](/STREETJS-GAP-ANALYSIS/).
