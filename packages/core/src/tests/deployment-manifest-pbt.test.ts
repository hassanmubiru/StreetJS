// tests/deployment-manifest-pbt.test.ts
// Layer A — pure, offline property test for the Cloud Deployment Verifier's
// manifest generators. It generates DeployConfig variations and asserts that
// the manifests produced by `generateManifest`/`generateTargetAssets` are
// structurally valid (per `validateDeploymentManifest`) for every supported
// target. This verifies the generated artifacts offline; it NEVER raises a
// capability to VERIFIED and does not assert a live deployment.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  generateManifest,
  generateTargetAssets,
  validateDeploymentManifest,
  type DeployConfig,
} from '../cloud/deployment.js';

// The targets this property covers are members of BOTH the legacy
// `CloudPlatform` set (accepted by validateDeploymentManifest/generateManifest)
// and the `DeploymentTarget` set (accepted by generateTargetAssets).
type SupportedTarget = 'kubernetes' | 'cloudrun' | 'ecs';

// ── Smart generators constrained to the realistic DeployConfig input space ──────

// Deployment names are DNS-label-like: lowercase alphanumerics + hyphens.
const nameArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 1,
    maxLength: 30,
  })
  .map((chars) => `app-${chars.join('')}`);

// Container references: registry / repository : tag. Always a non-empty \S+ ref.
const imageArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('registry.example.com', 'docker.io/library', 'ghcr.io/org', 'public.ecr.aws/x'),
    fc
      .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
        minLength: 1,
        maxLength: 20,
      })
      .map((c) => c.join('')),
    fc.constantFrom('1.0.0', 'latest', 'sha-abc123', '2.3.4', 'edge'),
  )
  .map(([registry, repo, tag]) => `${registry}/${repo}:${tag}`);

// Valid TCP port range.
const portArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 65535 });

const cpuArb = fc.constantFrom('100m', '250m', '500m', '1', '2');
const memoryArb = fc.constantFrom('128Mi', '256Mi', '512Mi', '1Gi');

// Environment variables: UPPER_SNAKE keys, plain values free of YAML-breaking
// control characters / quotes (so the generated YAML stays well-formed).
const envKeyArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'.split('')), {
    minLength: 1,
    maxLength: 15,
  })
  .map((c) => `K${c.join('')}`);
const envValArb: fc.Arbitrary<string> = fc
  .string({ maxLength: 24 })
  .filter((s) => !/["\n\r\t\\]/.test(s));
const envArb = fc.dictionary(envKeyArb, envValArb, { maxKeys: 5 });

const deployConfigArb: fc.Arbitrary<DeployConfig> = fc.record({
  name: nameArb,
  image: imageArb,
  port: portArb,
  replicas: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
  cpu: fc.option(cpuArb, { nil: undefined }),
  memory: fc.option(memoryArb, { nil: undefined }),
  env: envArb,
});

// The supported targets this property covers (Requirements 2.2/2.3/2.4).
const TARGETS: readonly CloudPlatform[] = ['kubernetes', 'cloudrun', 'ecs'];
const targetArb = fc.constantFrom(...TARGETS);

const NUM_RUNS = 200; // ≥ 100 runs as required.

// Feature: platform-leadership-gaps, Property 4: Generated deployment manifests are structurally valid for every supported target
// Validates: Requirements 2.2, 2.3, 2.4
describe('Property 4: generated deployment manifests are structurally valid for every supported target', () => {
  it('generateManifest produces a manifest that validateDeploymentManifest accepts (kubernetes, cloudrun, ecs)', () => {
    fc.assert(
      fc.property(targetArb, deployConfigArb, (target, cfg) => {
        const manifest = generateManifest(target, cfg);
        const result = validateDeploymentManifest(target, manifest);
        assert.equal(
          result.valid,
          true,
          `${target}: ${result.errors.join('; ')}`,
        );
        // Required fields are present: the manifest references the container image.
        assert.ok(manifest.includes(cfg.image), `${target}: manifest must reference the image`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('generated manifests always reference both health probe paths / health check', () => {
    fc.assert(
      fc.property(targetArb, deployConfigArb, (target, cfg) => {
        const manifest = generateManifest(target, cfg);
        if (target === 'ecs') {
          // ECS wires a container health check command against /health/live.
          assert.ok(manifest.includes('/health/live'), 'ecs: health check present');
        } else {
          assert.ok(manifest.includes('/health/live'), `${target}: liveness probe present`);
          assert.ok(manifest.includes('/health/ready'), `${target}: readiness probe present`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('generateTargetAssets emits structurally valid manifest assets for each target', () => {
    fc.assert(
      fc.property(targetArb, deployConfigArb, (target, cfg) => {
        const assets = generateTargetAssets(target, cfg);

        if (target === 'kubernetes') {
          // The split production manifests, recombined, form a complete and
          // valid Kubernetes manifest (Deployment + Service + HPA + probes).
          for (const path of ['deploy/k8s/deployment.yaml', 'deploy/k8s/service.yaml', 'deploy/k8s/hpa.yaml']) {
            assert.ok(typeof assets[path] === 'string' && assets[path].length > 0, `missing ${path}`);
          }
          const combined = [
            assets['deploy/k8s/deployment.yaml'],
            assets['deploy/k8s/service.yaml'],
            assets['deploy/k8s/hpa.yaml'],
          ].join('\n---\n');
          const result = validateDeploymentManifest('kubernetes', combined);
          assert.equal(result.valid, true, `kubernetes assets: ${result.errors.join('; ')}`);
          // The Helm chart deliverable is also emitted (Requirement 2.2).
          assert.ok(typeof assets['deploy/helm/street/Chart.yaml'] === 'string', 'missing Helm chart');
          return;
        }

        const path = target === 'cloudrun' ? 'deploy/cloudrun/service.yaml' : 'deploy/ecs/taskdef.json';
        const content = assets[path];
        assert.ok(typeof content === 'string' && content.length > 0, `missing ${path}`);
        const result = validateDeploymentManifest(target, content);
        assert.equal(result.valid, true, `${target} asset: ${result.errors.join('; ')}`);
        assert.ok(content.includes(cfg.image), `${target} asset: must reference the image`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the ECS task definition is valid JSON describing a Fargate task for any config', () => {
    fc.assert(
      fc.property(deployConfigArb, (cfg) => {
        const manifest = generateManifest('ecs', cfg);
        const parsed = JSON.parse(manifest) as {
          family: string;
          requiresCompatibilities: string[];
          containerDefinitions: Array<{ image: string; portMappings: unknown[] }>;
        };
        assert.equal(parsed.family, cfg.name);
        assert.deepEqual(parsed.requiresCompatibilities, ['FARGATE']);
        assert.equal(parsed.containerDefinitions[0].image, cfg.image);
        assert.ok(parsed.containerDefinitions[0].portMappings.length > 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
