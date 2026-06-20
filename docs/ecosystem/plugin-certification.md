---
layout: default
title: Plugin Certification
parent: Ecosystem
nav_order: 1
permalink: /ecosystem/plugin-certification/
description: "StreetJS plugin certification levels (Official, Verified, Community), review checklists, and the plugin scorecard."
sitemap:     false
noindex:     true
---

# Plugin Certification Program

A consistent, repeatable way to grade and review StreetJS plugins so consumers
know what trust a plugin carries.

## Certification levels

| Level | Who maintains | Requirements | Signature | Listing |
|-------|---------------|--------------|-----------|---------|
| **Official** | StreetJS core team | in this monorepo; CI-tested; structure-suite passes | StreetJS official key | `@streetjs/plugin-*` |
| **Verified** | third party | passes the **security** + **compatibility** + **structure** review below; signed | verified-publisher key (key registered with the registry) | "Verified" badge |
| **Community** | third party | well-formed, signed manifest; no review | self-signed | "Community" |

Levels are a **trust gradient**, not a quality ranking — a well-built Community
plugin may be excellent; it simply hasn't been reviewed.

## Review checklist (Verified tier)

A plugin is promoted to **Verified** only when all three checklists pass and the
result is recorded.

### Structure checklist
- [ ] `src/index.ts` defines or re-exports a `PluginModule` subclass.
- [ ] Well-formed `manifest.json` (name, version, capabilities, known permissions).
- [ ] `manifest.signed.json` verifies against the published `manifest.pub`.
- [ ] `README.md` documents config, usage, and security notes.
- [ ] Runnable `example/`.
- [ ] Declares the `streetjs` dependency with a valid version range.

### Security checklist
- [ ] Requests **only** the permissions it uses (least privilege).
- [ ] No secrets in source; secrets read via config/`SecretsProvider`.
- [ ] No dynamic code execution of untrusted input; inputs validated.
- [ ] Parameterized queries / safe identifiers (no injection).
- [ ] Network egress is limited to documented endpoints (`net` permission justified).
- [ ] Dependency tree reviewed (`npm audit` clean at high severity).

### Compatibility checklist
- [ ] Declares the supported `streetjs` semver range and Node version.
- [ ] Builds and its tests pass against the declared range.
- [ ] No reliance on undocumented/internal StreetJS APIs.
- [ ] Provides an upgrade note for breaking changes (SemVer-correct).

## Plugin scorecard

Each listed plugin shows a scorecard so consumers can judge fitness at a glance.

| Dimension | Signal (how it's measured) |
|-----------|----------------------------|
| **Maintenance** | last release date; open-issue response time; declared support window |
| **Testing** | presence + pass state of unit/integration tests in CI |
| **Security** | certification level; `npm audit` status; permission scope |
| **Adoption** | npm downloads; dependent count |

Scorecards are generated from registry + npm metadata (no self-reported claims).
A plugin failing the security checklist cannot hold the Verified badge regardless
of adoption.

## Submitting a plugin for Verified review

1. Publish the plugin (signed) and register your publisher key with the registry.
2. Open an issue with the `ecosystem` label linking the package + repo.
3. A maintainer runs the three checklists; the result and date are recorded.
4. On pass, the registry marks the plugin **Verified**.
