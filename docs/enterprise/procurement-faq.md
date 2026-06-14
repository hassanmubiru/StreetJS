---
layout: default
title: Procurement FAQ
parent: Enterprise
nav_order: 4
description: "StreetJS procurement FAQ for CTOs, architects, and security teams: licensing, support, security, compliance, longevity."
---

# Procurement FAQ

For CTOs, architects, and security/procurement teams evaluating StreetJS.

### What is StreetJS and what is its license?
A TypeScript backend framework built on Node.js core, published on npm
(`streetjs`). **MIT licensed.** Source and CI are public.

### What is the dependency / supply-chain posture?
Core has **two runtime dependencies**. Releases ship with **npm provenance** and
a **CycloneDX SBOM**. CI enforces secret scanning, dependency review, CodeQL, and
workflow static analysis. See the [Security Whitepaper](security-whitepaper.md).

### How are plugins trusted?
Plugin manifests are **Ed25519-signed** and verified by the host before load.
Official plugins are signed with the StreetJS key and published with provenance.
Third-party plugins are graded **Official / Verified / Community**
(`docs/ecosystem/plugin-certification.md`).

### Does StreetJS support our compliance program?
StreetJS provides technical controls (access control, audit logging, encryption,
retention/consent, secrets) mapped to **SOC 2, HIPAA, GDPR, and PCI-DSS** in
`docs/compliance/`. **StreetJS is not "certified compliant"** — compliance is
achieved by you (the operator) through process and an independent audit; the
mappings distinguish framework capabilities from operator responsibilities.

### What databases are supported?
PostgreSQL (native wire driver, SCRAM-SHA-256), MySQL/MariaDB, SQLite, and
MongoDB (via `@streetjs/plugin-mongodb`). A first-party ORM (`@streetjs/orm`)
adds relations and eager/lazy loading.

### How is it deployed?
Distroless Docker image with liveness/readiness endpoints; manifests for Cloud
Run, AWS ECS, Vercel, and Cloudflare Workers. Observability via Prometheus +
OpenTelemetry.

### What is the support / longevity story?
- Releases follow SemVer with a published `docs/lts-policy.md`.
- Governance, an RFC process, and a contributor ladder are documented
  (`GOVERNANCE.md`, `rfcs/`, `docs/community/contributor-path.md`).
- **Honest status:** the project is technically mature but **early on community
  adoption** — see `docs/adoption/adoption-scorecard.md` for the current,
  evidence-based state and targets. Enterprise support/consulting is part of the
  sustainability plan (`docs/sustainability/`).

### How do we report a vulnerability?
Privately, per `SECURITY.md` (coordinated disclosure; severity matrix). Never via
public issues/discussions.

### Can we get the evidence artifacts for our review?
Yes — SBOM (per release), provenance attestations (npm), CI logs, the compliance
control mappings, and the security whitepaper. All are public or attached to
releases.
