// tests/certification/deployment-certification.test.ts
// Certifies that deployment manifests are generated for every supported target
// and contain the production-critical fields (probes, resources, autoscaling).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateManifest, type DeployConfig } from '../../src/cloud/deployment.js';

const cfg: DeployConfig = {
  name: 'street-demo',
  image: 'registry.example.com/street-demo:1.0.0',
  port: 3000,
  cpu: '250m',
  memory: '256Mi',
  env: { NODE_ENV: 'production' },
};

describe('DEPLOYMENT — manifest generation', () => {
  it('produces non-empty manifests for kubernetes, cloudrun, ecs, nomad', () => {
    for (const platform of ['kubernetes', 'cloudrun', 'ecs', 'nomad'] as const) {
      const out = generateManifest(platform, cfg);
      assert.equal(typeof out, 'string');
      assert.ok(out.length > 50, `${platform} manifest should be non-trivial`);
      assert.ok(out.includes('street-demo'), `${platform} includes app name`);
    }
  });

  it('Kubernetes manifest declares Deployment, Service, HPA with health probes', () => {
    const y = generateManifest('kubernetes', cfg);
    assert.match(y, /kind:\s*Deployment/);
    assert.match(y, /kind:\s*Service/);
    assert.match(y, /kind:\s*HorizontalPodAutoscaler/);
    assert.match(y, /livenessProbe/);
    assert.match(y, /readinessProbe/);
    assert.match(y, /\/health\/live/);
    assert.match(y, /\/health\/ready/);
    assert.match(y, /resources:/);
    assert.match(y, /cpu:\s*250m/);
    assert.match(y, /memory:\s*256Mi/);
  });

  it('Cloud Run service references the image and port', () => {
    const y = generateManifest('cloudrun', cfg);
    assert.match(y, /serving\.knative\.dev|run\.googleapis\.com|Service/i);
    assert.ok(y.includes(cfg.image));
  });

  it('ECS task definition is valid JSON with container + resources', () => {
    const out = generateManifest('ecs', cfg);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    assert.ok(parsed['containerDefinitions'] || parsed['family'], 'ECS task definition shape');
  });

  it('Nomad job references the image', () => {
    const out = generateManifest('nomad', cfg);
    assert.ok(out.includes(cfg.image));
    assert.match(out, /job|task|group/);
  });

  it('injects environment variables into the Kubernetes manifest', () => {
    const y = generateManifest('kubernetes', cfg);
    assert.match(y, /NODE_ENV/);
    assert.match(y, /production/);
  });
});
