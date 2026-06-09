# Deployment Manifests

`street deploy:init --platform <kubernetes|cloudrun|ecs|nomad>` generates a
deployment manifest via `generateManifest(platform, config)`. The generated
artifacts are **structurally validated offline** with `validateDeploymentManifest`
— this verifies the manifest is well-formed and wires health probes; it does not
assert a live deployment (that runs in CI against a real cluster).

## Generate

```ts
import { generateManifest, validateDeploymentManifest } from 'streetjs';

const manifest = generateManifest('kubernetes', {
  name: 'street-app', image: 'registry/street-app:1.0.0', port: 8080,
  replicas: 2, cpu: '250m', memory: '256Mi', env: { NODE_ENV: 'production' },
});

const { valid, errors } = validateDeploymentManifest('kubernetes', manifest);
if (!valid) throw new Error(errors.join('; '));
```

## What is validated

| Platform | Checks |
| --- | --- |
| `kubernetes` | `Deployment` + `Service` + `HorizontalPodAutoscaler`; image; `containerPort`; `/health/live` + `/health/ready` probes |
| `cloudrun` | Knative `Service`; image; `containerPort`; liveness + readiness probes |
| `ecs` | valid JSON Fargate task def; `family`; container image; `portMappings`; `/health/live` health check |
| `nomad` | `job` block; `driver = "docker"`; image; `check` block with `/health/live` |

## Status

- **Generation + structural validation:** VERIFIED (offline) — see
  `packages/core/src/tests/deployment-manifest.test.ts` (10 tests across all four
  platforms + validator negatives).
- **Live deployment verification** (apply to a real cluster / service): runs in
  CI with cluster credentials — environment-gated, not asserted here.

```bash
cd packages/core && npx tsc && node --test dist/src/tests/deployment-manifest.test.js
```
