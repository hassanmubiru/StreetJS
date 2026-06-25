---
layout: default
title: "Deployment Certification"
nav_exclude: true
description: "Deployment Certification — StreetJS, the production-grade, memory-safe TypeScript backend framework for Node.js."
sitemap:     false
noindex:     true
---

# Deployment Certification

Run: `node --test packages/core/dist/tests/certification/deployment-certification.test.js`

Verifies `generateManifest()` for every supported target. Wired into
`street certify` and CI.

| Target | Verified |
| --- | --- |
| Kubernetes | `Deployment` + `Service` + `HorizontalPodAutoscaler`; `/health/live` + `/health/ready` probes; CPU/memory resource limits; env var injection |
| Cloud Run | service manifest referencing image + port |
| ECS | task definition emits valid JSON (container definitions / family) |
| Nomad | job spec references the image |

Manifests are produced by `generateManifest(platform, config)` and the K8s
output parses as three valid YAML documents.

## Container / CI assets

- Multi-stage `Dockerfile`, `docker-compose.yml`, `infra/docker/compose/docker-compose.kafka.yml`,
  `infra/docker/compose/docker-compose.rabbitmq.yml`.
- CI workflows: `ci-cd.yml` (incl. `policy-checks`), `kafka-integration.yml`,
  `rabbitmq-integration.yml`, `browser-compat.yml`, `codeql.yml`.

## Result

All assertions pass. Deployment manifests valid for K8s, Cloud Run, ECS, Nomad.
