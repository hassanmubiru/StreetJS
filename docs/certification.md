---
layout:     default
title:      "Certification"
nav_order:  16
permalink:  /certification/
description: "Street Framework certification summary — 10/10 production gates passed, with the full gate matrix, domain coverage, and links to detailed reports."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Certification</span>
<h1>Certification Summary</h1>
<p>An at-a-glance view of Street's production-readiness gates. Every result below was produced by executing the certification suites — re-run <code>node scripts/run-certification.mjs</code> to regenerate <code>certification-report.json</code>.</p>
</div>

## Verdict

<div class="st-score">
  <div class="st-score-ring" style="--p:100">
    <span><b>10/10</b><small>Gates</small></span>
  </div>
  <div class="st-score-meta">
    <h3>Status: Certified</h3>
    <span class="st-status">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      Advanced Production Ready
    </span>
    <p>All 10 automated gates pass on a clean build — lint, build, tests, and five domain certifications. Last generated 7 Jun 2026.</p>
  </div>
</div>

<div class="st-metrics">
  <div class="st-metric is-accent"><span class="m-val">10<span class="m-u">/10</span></span><span class="m-lbl">Gates passed</span></div>
  <div class="st-metric"><span class="m-val">0</span><span class="m-lbl">High/critical CVEs</span><span class="m-sub">npm audit</span></div>
  <div class="st-metric"><span class="m-val">1,100<span class="m-u">+</span></span><span class="m-lbl">Tests</span><span class="m-sub">unit + integration</span></div>
  <div class="st-metric"><span class="m-val">~18<span class="m-u">s</span></span><span class="m-lbl">Total gate time</span><span class="m-sub">clean run</span></div>
</div>

## Gate matrix

{% include callout.html type="tip" title="Every gate is a real command" body="The suite fails closed — a single non-zero exit blocks certification. Commands and timings below come straight from the generated report." %}

<div class="st-gates">

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Typecheck &amp; Lint</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">npm run lint</code>
    <div class="st-gate-meta">Strict <code>tsc --noEmit</code> · 3.1s</div>
  </div>

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Build</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">npm run build</code>
    <div class="st-gate-meta">ESM + declarations · 3.5s</div>
  </div>

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Compile Tests</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">npx tsc</code>
    <div class="st-gate-meta">Test sources compile · 3.9s</div>
  </div>

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Unit + Integration</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">node --test dist/src/tests/</code>
    <div class="st-gate-meta">0 todo · 2.9s</div>
  </div>

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Security</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">security-certification.test.js</code>
    <div class="st-gate-meta">JWT, vault, headers, rate-limit · 4.0s</div>
  </div>

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Observability</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">observability-certification.test.js</code>
    <div class="st-gate-meta">Prometheus, Grafana, tracing · 0.3s</div>
  </div>

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Deployment</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">deployment-certification.test.js</code>
    <div class="st-gate-meta">Manifest generation &amp; validation · 0.07s</div>
  </div>

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Enterprise</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">enterprise-certification.test.js</code>
    <div class="st-gate-meta">RBAC, multi-tenant, audit · 0.10s</div>
  </div>

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Documentation</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">documentation-certification.test.js</code>
    <div class="st-gate-meta">Doc sources present &amp; valid · 0.07s</div>
  </div>

  <div class="st-gate">
    <div class="st-gate-top"><span class="st-gate-name">Repository</span><span class="st-pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Pass</span></div>
    <code class="st-gate-cmd">repository-certification.test.js</code>
    <div class="st-gate-meta">License, metadata, hygiene · 0.07s</div>
  </div>

</div>

## Domain coverage

<div class="st-cards">

  <a class="st-card has-ic" href="https://github.com/hassanmubiru/street/blob/main/docs/SECURITY-CERTIFICATION.md">
    <span class="st-card-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
    <div><p class="st-card-t">Security</p><p class="st-card-d">JWT, AES-256-GCM sessions, scrypt vault, rate limiting, security headers — 74/74 system checks.</p></div>
  </a>

  <a class="st-card has-ic" href="https://github.com/hassanmubiru/street/blob/main/docs/PERFORMANCE-CERTIFICATION.md">
    <span class="st-card-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>
    <div><p class="st-card-t">Performance</p><p class="st-card-d">27.5k req/s median, 2ms P50, 70ms startup — measured, run-by-run.</p></div>
  </a>

  <a class="st-card has-ic" href="https://github.com/hassanmubiru/street/blob/main/docs/OBSERVABILITY-CERTIFICATION.md">
    <span class="st-card-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg></span>
    <div><p class="st-card-t">Observability</p><p class="st-card-d">Prometheus rules (promtool-validated), Grafana dashboard, tracing and health checks.</p></div>
  </a>

  <a class="st-card has-ic" href="https://github.com/hassanmubiru/street/blob/main/docs/DEPLOYMENT-CERTIFICATION.md">
    <span class="st-card-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0 0-9 5.8 5.8 0 0 0-11.3-1.6A4 4 0 0 0 6.5 19z"/></svg></span>
    <div><p class="st-card-t">Deployment</p><p class="st-card-d">Kubernetes manifest generation, kind-cluster apply and liveness smoke test.</p></div>
  </a>

</div>

## Known follow-ups

{% include callout.html type="warning" title="Tracked, low-impact" body="In the spirit of honest reporting — none of these block production use." %}

<ul class="st-remain">
  <li>One documented dynamic-import cycle (MySQL detection seam) — slated for a factory-layer refactor</li>
  <li>Plugin marketplace / registry hardening</li>
  <li>Additional official plugins</li>
  <li>Broader live deployment verification</li>
</ul>
