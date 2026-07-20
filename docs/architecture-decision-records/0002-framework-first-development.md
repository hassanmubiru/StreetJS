---
layout: default
title: "ADR-0002: Framework-first development"
nav_exclude: true
description: "ADR-0002: Framework-first development — reusable infrastructure lives in StreetJS; StreetStudio is a consumer that owns only product-specific code."
sitemap: false
noindex: true
---

# ADR-0002: Framework-first development

- Status: Accepted
- Date: 2026-07-20
- Context commit: `de890042`

## Context

StreetJS is the reusable application framework. StreetStudio is the first large
product built on top of StreetJS.

To preserve a clean architecture, reusable infrastructure must remain inside
StreetJS while product-specific functionality remains inside StreetStudio.

Without a governing rule, there is a risk that reusable infrastructure will
gradually be implemented inside StreetStudio, creating duplication, diverging
implementations, and making future products unable to benefit from common
functionality.

A pre-development framework audit (see `plans/STREETJS-PROJECT-STATUS.md`)
verified — against implemented APIs, not package names — that StreetJS already
provides essentially all reusable infrastructure StreetStudio requires, and that
every planned StreetStudio module maps entirely to existing published StreetJS
packages. This ADR records the rule that keeps that boundary intact over time.

## Decision

StreetStudio is a **consumer** of StreetJS.

Before implementing any new capability in StreetStudio, contributors must
determine whether it represents **reusable framework infrastructure** or
**product-specific behavior**.

### Reusable infrastructure

If the capability is reusable outside StreetStudio, it must be implemented in
StreetJS first. Contributors must:

1. Determine whether the capability fits an existing StreetJS package.
2. **Extend an existing package whenever possible.**
3. Create a new package only when **all** of the following hold:
   - the responsibility is clearly distinct,
   - it has value beyond StreetStudio,
   - extending an existing package would reduce cohesion, and
   - it introduces no dependency cycles.
4. Publish the updated StreetJS package (with provenance).
5. Upgrade StreetStudio to consume the published package.

StreetStudio must never become the second implementation of reusable
infrastructure.

### Product functionality

If the capability represents StreetStudio-specific concepts, it belongs in
StreetStudio. Examples: recordings, projects, folders, workspaces, review
sessions, timeline editing, review comments, branding, dashboards, product
workflows, business rules, and product UX. These are intentionally outside the
scope of StreetJS.

## Architecture principles

All framework work follows these principles:

- Extend before creating new packages.
- Favor high cohesion and low coupling.
- Keep framework packages product-independent.
- Avoid circular dependencies.
- Minimize package proliferation.
- Publish reusable functionality before consuming it.

## Enforcement

The following checks enforce this decision:

- **Circular dependency analysis** — `scripts/audit/circular-scan.mjs`, run by
  the Runtime Certification workflow; product code cannot be coupled into
  framework packages without failing CI.
- **Package dependency graph validation** and public-API / package-boundary
  checks in CI.
- **Code review against the framework-first rule.**

During code review, contributors answer one question:

> Can this capability be reused by another StreetJS application?

- If **yes**, it belongs in StreetJS.
- If **no**, it belongs in StreetStudio.

## Consequences

### Positive

- Prevents duplicated infrastructure.
- Keeps StreetJS cohesive.
- Keeps StreetStudio focused on product development.
- Lets future StreetJS applications benefit from shared infrastructure.
- Encourages reusable, well-tested framework components.
- Preserves a clear separation between framework and product.

### Trade-offs

- Some features require a framework change before product implementation.
- Framework evolution may slightly precede product work.
- Contributors must evaluate reusability before implementing.

## Long-term development model

1. Implement a StreetStudio feature.
2. Identify reusable infrastructure.
3. Add or extend the appropriate StreetJS package.
4. Publish the package.
5. Upgrade StreetStudio.
6. Continue product development.

This keeps StreetJS the reusable foundation while StreetStudio remains a consumer
focused on delivering product-specific capabilities.

## Precedent (this engagement)

The framework-readiness work that preceded StreetStudio applied this rule
end-to-end: six capabilities were delivered as **two new leaf packages**
(`@streetjs/flags`, `@streetjs/i18n`) and **four additive extensions**
(`@streetjs/media` captions/waveform, `@streetjs/commerce` subscriptions/seats,
`@streetjs/config` secret rotation, `@streetjs/security` field encryption) —
extending before creating, with no new dependency cycles.
