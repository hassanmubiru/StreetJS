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

  it('kubernetes manifest places env + envFrom at container level (not under resources)', () => {
    const m = generateManifest('kubernetes', config);
    // env must be a container-level key (10-space indent), NOT nested under
    // resources: (which would make Kubernetes silently drop the env vars).
    assert.match(m, /\n {10}env:\n {12}- name: NODE_ENV/);
    // Required secrets are pulled from a Secret via envFrom (fail-fast in prod).
    assert.match(m, /\n {10}envFrom:\n {12}- secretRef:\n {14}name: street-app-secrets/);
    // The header comment documents creating that Secret before apply.
    assert.match(m, /kubectl create secret generic street-app-secrets/);
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

import {
  generateTargetAssets,
  generateEcsService,
  validateEcsService,
  type DeploymentTarget,
} from '../cloud/deployment.js';

describe('Cloud Run target assets', () => {
  it('emits a service profile, deploy workflow, and smoke-test script', () => {
    const assets = generateTargetAssets('cloudrun', config);
    const profile = assets['deploy/cloudrun/service.yaml'];
    assert.ok(typeof profile === 'string' && profile.includes(config.image));
    assert.equal(validateDeploymentManifest('cloudrun', profile).valid, true);
    assert.match(profile, /autoscaling\.knative\.dev\/maxScale/);
    assert.match(profile, /startup-cpu-boost/);
    assert.ok(assets['.github/workflows/deploy-cloudrun.yml'].includes('deploy-cloudrun'));
    assert.ok(assets['scripts/cloud/cloudrun/smoke.mjs'].includes('/health/ready'));
  });
});

describe('ECS target assets', () => {
  it('emits a task definition, a service definition, and a deploy workflow', () => {
    const assets = generateTargetAssets('ecs', config);
    assert.equal(validateDeploymentManifest('ecs', assets['deploy/ecs/taskdef.json']).valid, true);
    const svc = assets['deploy/ecs/service.json'];
    assert.equal(validateEcsService(svc).valid, true, validateEcsService(svc).errors.join('; '));
    assert.ok(assets['.github/workflows/deploy-ecs.yml'].includes('update-service'));
  });

  it('generateEcsService produces a valid Fargate service definition', () => {
    const svc = JSON.parse(generateEcsService(config));
    assert.equal(svc.serviceName, config.name);
    assert.equal(svc.taskDefinition, config.name);
    assert.equal(svc.launchType, 'FARGATE');
    assert.equal(svc.loadBalancers[0].containerPort, config.port);
    assert.equal(svc.deploymentConfiguration.deploymentCircuitBreaker.enable, true);
  });

  it('validateEcsService rejects malformed definitions', () => {
    assert.equal(validateEcsService('{ not json').valid, false);
    assert.equal(validateEcsService(JSON.stringify({ serviceName: 'x' })).valid, false);
  });
});

describe('AWS Lambda target assets', () => {
  it('emits a handler adapter, cold-start validation, and deploy workflow', () => {
    const assets = generateTargetAssets('lambda', config);
    assert.ok(assets['deploy/lambda/handler.mjs'].includes('export async function handler'));
    assert.ok(assets['deploy/lambda/coldstart-validate.mjs'].includes('cold start'));
    assert.ok(assets['.github/workflows/deploy-lambda.yml'].includes('update-function-code'));
    assert.ok(assets['.github/workflows/deploy-lambda.yml'].includes('coldstart-validate'));
  });
});

describe('Azure Functions target assets', () => {
  it('emits host config, function binding, adapter, validation, and workflow', () => {
    const assets = generateTargetAssets('azure-functions', config);
    const host = JSON.parse(assets['deploy/azure-functions/host.json']);
    assert.equal(host.version, '2.0');
    const fn = JSON.parse(assets['deploy/azure-functions/api/function.json']);
    assert.equal(fn.bindings.find((b: { type: string }) => b.type === 'httpTrigger').route, '{*path}');
    assert.ok(assets['deploy/azure-functions/api/index.mjs'].includes('app.fetch'));
    assert.ok(assets['.github/workflows/deploy-azure-functions.yml'].includes('functions-action'));
  });
});

describe('Google Cloud Functions target assets', () => {
  it('emits an entrypoint adapter, validation, and workflow', () => {
    const assets = generateTargetAssets('gcf', config);
    assert.ok(assets['deploy/gcf/index.mjs'].includes('export const street'));
    assert.ok(assets['deploy/gcf/validate.mjs'].includes('/health/live'));
    assert.ok(assets['.github/workflows/deploy-gcf.yml'].includes('functions deploy'));
  });
});

describe('Cloudflare Workers target assets', () => {
  it('emits a wrangler config, Worker adapter, validation, and workflow', () => {
    const assets = generateTargetAssets('cloudflare-workers', config);
    const toml = assets['deploy/cloudflare-workers/wrangler.toml'];
    assert.match(toml, /main\s*=\s*"worker\.mjs"/);
    assert.match(toml, /compatibility_date/);
    assert.ok(assets['deploy/cloudflare-workers/worker.mjs'].includes('async fetch('));
    const wf = assets['.github/workflows/deploy-cloudflare-workers.yml'];
    assert.ok(wf.includes('wrangler deploy --dry-run'));
    assert.ok(wf.includes('wrangler deploy --config'));
  });
});

describe('every DeploymentTarget produces a non-empty asset bundle', () => {
  const targets: DeploymentTarget[] = ['kubernetes', 'cloudrun', 'ecs', 'lambda', 'azure-functions', 'gcf', 'cloudflare-workers'];
  for (const target of targets) {
    it(`generateTargetAssets('${target}') returns at least one deliverable`, () => {
      const assets = generateTargetAssets(target, config);
      const entries = Object.entries(assets);
      assert.ok(entries.length > 0, `${target}: no assets`);
      for (const [path, content] of entries) {
        assert.ok(typeof content === 'string' && content.length > 0, `${target}: empty ${path}`);
      }
    });
  }
});
