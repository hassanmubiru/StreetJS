---
layout:       default
title:        "Enterprise"
nav_order:    97
has_children: true
permalink:    /enterprise/
description:   "StreetJS for enterprise — architecture overview, risk assessment, security whitepaper, procurement FAQ, and an honest readiness assessment."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Enterprise</span>
<h1>Enterprise</h1>
<p>The trust package for technical and procurement reviewers — with an honest view of what is and isn't yet verified.</p>
</div>

## Trust package

| Document | What it covers |
|----------|----------------|
| [Architecture Overview](/enterprise/architecture-overview/) | System design, components, data flow |
| [Risk Assessment](/enterprise/risk-assessment/) | Technical + operational risks and mitigations |
| [Security Whitepaper](/enterprise/security-whitepaper/) | Security model, controls, supply-chain integrity |
| [Procurement FAQ](/enterprise/procurement-faq/) | Licensing, support, continuity, vendor-risk answers |

## Built-in enterprise capabilities

RBAC, MFA, JWT/sessions, audit logging, field-level encryption, vault mode, mTLS,
rate limiting, multi-tenancy, and OpenTelemetry/Prometheus observability — all in
core. Admin surfaces ship via [`@streetjs/admin-ui`](https://www.npmjs.com/package/@streetjs/admin-ui)
(RBAC, audit logs, user management, multi-tenancy).

## Supply-chain integrity

Every release is published with **npm provenance** and a **CycloneDX SBOM**;
official plugins are **Ed25519-signed** and verified against an embedded trust key.
CodeQL, secret scanning, and dependency review run in CI.

## Honest readiness

StreetJS does **not** overstate enterprise readiness. Compliance materials
(SOC 2 / HIPAA / GDPR / PCI) are **control mappings, not audited attestations**;
there is no third-party penetration test or certification yet, and the project is
early on community and production proof. See the
[Gap Analysis](/STREETJS-GAP-ANALYSIS/) and
[Readiness Assessment](/STREETJS-READINESS-ASSESSMENT/) for the unvarnished view,
and the [Go-To-Market Roadmap](/adoption/go-to-market-roadmap/) for the
ROI-ranked path to security audit, pen-test, and SOC 2 readiness.

## Talk to us

For procurement or partnership questions, open a
[GitHub Discussion](https://github.com/hassanmubiru/StreetJS/discussions) or see
[Contact](/contact/).
