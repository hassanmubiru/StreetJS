---
layout: default
title: Adoption Scorecard
nav_order: 70
permalink: /adoption/adoption-scorecard/
description: "Measurable StreetJS adoption KPIs across community, ecosystem, enterprise, and documentation, with quarterly targets."
sitemap: false
noindex: true
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Adoption</span>
<h1>Adoption Scorecard</h1>
<p>Measurable KPIs, refreshed quarterly. Values are <strong>measured signals</strong>, not estimates — where a value is not yet measurable it is marked <code>n/a (no signal)</code> rather than guessed. Honesty over optics.</p>
</div>

> **Baseline (2026-Q2):** the project is technically mature but early on
> adoption. Most community/ecosystem signals are at or near zero — that is the
> accurate starting point, not a failure.

<p class="scorecard-legend">In each table the <span class="sc-base">baseline</span> is the honest starting point and the highlighted <span class="sc-goal">Q+4</span> column is the one-year target.</p>

## KPIs and targets

### Community

<div class="scorecard" markdown="1">

| Metric | Baseline | Q+1 | Q+2 | Q+4 | Source |
|--------|:--------:|:---:|:---:|:---:|--------|
| External contributors (merged PR) | 0 | 3 | 8 | 20 | GitHub |
| Merged community PRs / quarter | 0 | 10 | 25 | 60 | GitHub |
| Active Discussions threads / quarter | 0 | 20 | 50 | 150 | GitHub Discussions |
| Discord members | 0 | 100 | 300 | 1000 | Discord |
| Active release-capable maintainers (bus factor) | 1 | 2 | 3 | 3+ | MAINTAINERS |

</div>

### Ecosystem

<div class="scorecard" markdown="1">

| Metric | Baseline | Q+1 | Q+2 | Q+4 | Source |
|--------|:--------:|:---:|:---:|:---:|--------|
| Official plugins | 18 | 18 | 20 | 24 | monorepo |
| Verified (3rd-party) plugins | 0 | 2 | 5 | 15 | registry |
| Community plugins listed | 0 | 5 | 15 | 40 | registry |
| `streetjs` weekly npm downloads | measure | +50% | +150% | +500% | npm |

</div>

### Enterprise

<div class="scorecard" markdown="1">

| Metric | Baseline | Q+1 | Q+2 | Q+4 | Source |
|--------|:--------:|:---:|:---:|:---:|--------|
| Documented evaluations | 0 | 2 | 5 | 12 | inbound |
| Pilots | 0 | 1 | 3 | 6 | inbound |
| Production deployments (reported) | n/a (no signal) | 1 | 3 | 8 | case studies |
| Compliance evidence requests served | 0 | 2 | 5 | 12 | inbound |

</div>

### Documentation

<div class="scorecard" markdown="1">

| Metric | Baseline | Q+1 | Q+2 | Q+4 | Source |
|--------|:--------:|:---:|:---:|:---:|--------|
| Guides with runnable examples | high | maintain | maintain | maintain | docs CI |
| Docs search usage (queries/mo) | measure | grow | grow | grow | site analytics |
| Migration guides | 3 | 3 | 4 | 5 | docs |
| Reproducible case studies | 0 | 1 | 3 | 6 | `docs/case-studies/` |

</div>

## How metrics are collected

- **GitHub:** contributors, PRs, Discussions via the GitHub API (no manual entry).
- **npm:** downloads via the npm registry API.
- **Registry:** plugin counts/levels from the StreetJS registry.
- **Enterprise/case studies:** counted only when a verifiable artifact exists
  (a merged case study, a recorded evaluation) — never self-asserted.

## Update cadence

Refreshed at the start of each quarter; the prior quarter's actuals are recorded
alongside the targets so trends are visible and targets stay honest.
