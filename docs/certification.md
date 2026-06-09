---
layout:     default
title:      "Certification"
nav_order:  16
permalink:  /certification/
description: "Street Framework certification summary — 10/10 production gates passed, with links to the full security, performance, observability and deployment reports."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Certification</span>
<h1>Certification Summary</h1>
<p>An at-a-glance view of Street's production-readiness gates. Every result below was produced by executing the certification suites — the full reports are linked at the bottom.</p>
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
    <p>All 10 automated gates pass on a clean build (lint, build, tests, and five domain certifications). Generated 2026-06-07.</p>
  </div>
</div>

## Highlights

<ul class="st-check">
  <li>0 high/critical npm audit findings</li>
  <li>Lint &amp; strict typecheck clean</li>
  <li>1,100+ unit &amp; integration tests pass</li>
  <li>Security certification verified</li>
  <li>Observability certification verified</li>
  <li>Deployment certification verified</li>
  <li>Enterprise certification verified</li>
  <li>PostgreSQL wire driver verified</li>
  <li>Kafka &amp; RabbitMQ integration verified</li>
  <li>Documentation &amp; repository gates pass</li>
</ul>

## Gate breakdown

<div class="st-metrics">
  <div class="st-metric is-accent"><span class="m-val">10<span class="m-u">/10</span></span><span class="m-lbl">Gates passed</span></div>
  <div class="st-metric"><span class="m-val">0</span><span class="m-lbl">High/critical CVEs</span><span class="m-sub">npm audit</span></div>
  <div class="st-metric"><span class="m-val">1,100<span class="m-u">+</span></span><span class="m-lbl">Tests</span><span class="m-sub">unit + integration</span></div>
  <div class="st-metric"><span class="m-val">2</span><span class="m-lbl">Runtime deps</span></div>
</div>

## Known follow-ups

{% include callout.html type="warning" title="Tracked, low-impact" body="In the spirit of honest reporting, these are open items — none block production use." %}

<ul class="st-remain">
  <li>One documented dynamic-import cycle (MySQL detection seam) — slated for a factory-layer refactor</li>
  <li>Plugin marketplace / registry hardening</li>
  <li>Additional official plugins</li>
  <li>Broader live deployment verification</li>
</ul>

## Full reports

<div class="st-cards">
  <a class="st-card" href="https://github.com/hassanmubiru/street/blob/main/docs/SECURITY-CERTIFICATION.md">
    <p class="st-card-t">Security Certification →</p>
    <p class="st-card-d">JWT, sessions, vault, rate limiting, headers — controls verified.</p>
  </a>
  <a class="st-card" href="https://github.com/hassanmubiru/street/blob/main/docs/PERFORMANCE-CERTIFICATION.md">
    <p class="st-card-t">Performance Certification →</p>
    <p class="st-card-d">Throughput, latency, startup and memory, run-by-run.</p>
  </a>
  <a class="st-card" href="https://github.com/hassanmubiru/street/blob/main/docs/OBSERVABILITY-CERTIFICATION.md">
    <p class="st-card-t">Observability Certification →</p>
    <p class="st-card-d">Prometheus rules, Grafana dashboard, tracing and health checks.</p>
  </a>
  <a class="st-card" href="https://github.com/hassanmubiru/street/blob/main/docs/DEPLOYMENT-CERTIFICATION.md">
    <p class="st-card-t">Deployment Certification →</p>
    <p class="st-card-d">Manifest generation, kind-cluster apply and liveness smoke test.</p>
  </a>
</div>
