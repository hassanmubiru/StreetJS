// tests/deployment-manifest.test.ts
// Validates that generated deployment manifests (k8s/Cloud Run/ECS/Nomad) are
// structurally well-formed and wire health probes. This verifies the generated
// artifacts offline; it does not assert a live deployment.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateManifest, validateDeploymentManifest, type CloudPlatform, type DeployConfig } from '../cloud/deployment.js';

const config: DeployConfig = {
  name: 'street-app', image: 'registry.example.com/street-app:1.0.0', port: 8080,
  replicas: 2, cpu: '250m', memory: '256Mi', env: { NODE_ENV: 'production', LOG_LEVEL: 'info' },
};

const platforms: CloudPlatform[] = ['kubernetes', 'cloudrun', 'ecs', 'nomad'];

describe('deployment manifests — generated output validates', () => {
  for (const platform of platforms) {
    it(`generates a valid ${platform} manifest with health probes + image + port`, () => {
      const manifest = generateManifest(platform, config);
      const r = validateDeploymentManifest(platform, manifest);
      assert.equal(r.valid, true, `${platform}: ${r.errors.join('; ')}`);
      assert.ok(manifest.includes(config.image), 'image present');
    });
  }

  it('kubernetes manifest contains Deployment + Service + HPA', () => {
    const m = generateManifest('kubernetes', config);
    assert.match(m, /kind:\s*Deployment/);
    assert.match(m, /kind:\s*Service/);
    assert.match(m, /kind:\s*HorizontalPodAutoscaler/);
  });

  it('ecs manifest is valid JSON with a Fargate task definition', () => {
    const m = generateManifest('ecs', config);
    const parsed = JSON.parse(m);
    assert.equal(parsed.family, 'street-app');
    assert.deepEqual(parsed.requiresCompatibilities, ['FARGATE']);
    assert.equal(parsed.containerDefinitions[0].image, config.image);
  });
});

describe('deployment manifests — validator negatives', () => {
  it('rejects an empty manifest', () => {
    assert.equal(validateDeploymentManifest('kubernetes', '').valid, false);
  });
  it('rejects a k8s manifest missing health probes', () => {
    const broken = 'kind: Deployment\nkind: Service\nkind: HorizontalPodAutoscaler\nimage: x\ncontainerPort: 8080\n';
    const r = validateDeploymentManifest('kubernetes', broken);
    assert.equal(r.valid, false);
    assert.match(r.errors.join(';'), /liveness|readiness/);
  });
  it('rejects invalid ECS JSON', () => {
    const r = validateDeploymentManifest('ecs', '{ not json');
    assert.equal(r.valid, false);
    assert.match(r.errors.join(';'), /invalid JSON/);
  });
  it('rejects a nomad manifest missing the docker driver', () => {
    const r = validateDeploymentManifest('nomad', 'job "x" {\n  check {\n  }\n /health/live\n}');
    assert.equal(r.valid, false);
    assert.match(r.errors.join(';'), /docker driver|container image/);
  });
});
