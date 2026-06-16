---
layout: default
title: Adoption Scorecard
nav_order: 70
permalink: /adoption/adoption-scorecard/
description: "Measurable StreetJS adoption KPIs across community, ecosystem, enterprise, and documentation, with quarterly targets."
---

# Adoption Scorecard

Measurable KPIs, updated quarterly. Values are **measured signals**, not
estimates — where a value is not yet measurable it is marked `n/a (no signal)`
rather than guessed. Honesty over optics.

> **Baseline (2026-Q2):** the project is technically mature but early on
> adoption. Most community/ecosystem signals are at or near zero — that is the
> accurate starting point, not a failure.

## KPIs and targets

### Community
| Metric | Baseline | Q+1 | Q+2 | Q+4 | Source |
|--------|:--------:|:---:|:---:|:---:|--------|
| External contributors (merged PR) | 0 | 3 | 8 | 20 | GitHub |
| Merged community PRs / quarter | 0 | 10 | 25 | 60 | GitHub |
| Active Discussions threads / quarter | 0 | 20 | 50 | 150 | GitHub Discussions |
| Discord members | 0 | 100 | 300 | 1000 | Discord |
| Active release-capable maintainers (bus factor) | 1 | 2 | 3 | 3+ | MAINTAINERS |

### Ecosystem
| Metric | Baseline | Q+1 | Q+2 | Q+4 | Source |
|--------|:--------:|:---:|:---:|:---:|--------|
| Official plugins | 18 | 18 | 20 | 24 | monorepo |
| Verified (3rd-party) plugins | 0 | 2 | 5 | 15 | registry |
| Community plugins listed | 0 | 5 | 15 | 40 | registry |
| `streetjs` weekly npm downloads | measure | +50% | +150% | +500% | npm |

### Enterprise
| Metric | Baseline | Q+1 | Q+2 | Q+4 | Source |
|--------|:--------:|:---:|:---:|:---:|--------|
| Documented evaluations | 0 | 2 | 5 | 12 | inbound |
| Pilots | 0 | 1 | 3 | 6 | inbound |
| Production deployments (reported) | n/a (no signal) | 1 | 3 | 8 | case studies |
| Compliance evidence requests served | 0 | 2 | 5 | 12 | inbound |

### Documentation
| Metric | Baseline | Q+1 | Q+2 | Q+4 | Source |
|--------|:--------:|:---:|:---:|:---:|--------|
| Guides with runnable examples | high | maintain | maintain | maintain | docs CI |
| Docs search usage (queries/mo) | measure | grow | grow | grow | site analytics |
| Migration guides | 3 | 3 | 4 | 5 | docs |
| Reproducible case studies | 0 | 1 | 3 | 6 | `docs/case-studies/` |

## How metrics are collected

- **GitHub:** contributors, PRs, Discussions via the GitHub API (no manual entry).
- **npm:** downloads via the npm registry API.
- **Registry:** plugin counts/levels from the StreetJS registry.
- **Enterprise/case studies:** counted only when a verifiable artifact exists
  (a merged case study, a recorded evaluation) — never self-asserted.

## Update cadence

Refreshed at the start of each quarter; the prior quarter's actuals are recorded
alongside the targets so trends are visible and targets stay honest.
