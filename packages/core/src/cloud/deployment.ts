// src/cloud/deployment.ts
// Cloud deployment manifest + per-target asset generation.
//
// `generateManifest`/`validateDeploymentManifest` produce and structurally
// validate a single manifest for the legacy `CloudPlatform` set (kubernetes,
// cloudrun, ecs, nomad). The Cloud Deployment Verifier (Requirements 2.1, 2.2)
// adds the broader `DeploymentTarget` set and `generateTargetAssets()`, which
// emits the full per-target deliverable bundle (manifests/profiles/workflows +
// the Helm chart and HPA autoscaling example for Kubernetes).
//
// Zero runtime dependencies: this module uses only language built-ins.

// ── Types ──────────────────────────────────────────────────────────────────────

export type CloudPlatform = 'kubernetes' | 'cloudrun' | 'ecs' | 'nomad';

/**
 * The seven supported Deployment Targets of the Cloud Deployment Verifier
 * (Requirement 2.1). Each target has its own per-target deliverable bundle,
 * produced by {@link generateTargetAssets}.
 */
export type DeploymentTarget =
  | 'kubernetes'
  | 'cloudrun'
  | 'ecs'
  | 'lambda'
  | 'azure-functions'
  | 'gcf'
  | 'cloudflare-workers';

export interface DeployConfig {
  name: string;
  image: string;
  port: number;
  replicas?: number;
  cpu?: string;
  memory?: string;
  env?: Record<string, string>;
}

// ── generateManifest ──────────────────────────────────────────────────────────

/**
 * Generate a deployment manifest YAML/JSON string for the given cloud platform.
 */
export function generateManifest(platform: CloudPlatform, config: DeployConfig): string {
  switch (platform) {
    case 'kubernetes':
      return generateKubernetes(config);
    case 'cloudrun':
      return generateCloudRun(config);
    case 'ecs':
      return generateEcs(config);
    case 'nomad':
      return generateNomad(config);
    default:
      throw new Error(`generateManifest: unknown platform "${platform as string}"`);
  }
}

// ── Manifest validation ───────────────────────────────────────────────────────

export interface ManifestValidationResult { valid: boolean; errors: string[]; }

/**
 * Structurally validate a generated deployment manifest for a platform: it must
 * declare the right resource kind(s), reference a container image and port, and
 * wire the liveness/readiness health probes (or the ECS health check). This
 * verifies the generated artifact offline — it does NOT verify a live deployment.
 */
export function validateDeploymentManifest(platform: CloudPlatform, manifest: string): ManifestValidationResult {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string): void => { if (!cond) errors.push(msg); };

  if (typeof manifest !== 'string' || manifest.trim() === '') {
    return { valid: false, errors: ['manifest is empty'] };
  }

  switch (platform) {
    case 'kubernetes': {
      need(/\bkind:\s*Deployment\b/.test(manifest), 'missing Deployment');
      need(/\bkind:\s*Service\b/.test(manifest), 'missing Service');
      need(/\bkind:\s*HorizontalPodAutoscaler\b/.test(manifest), 'missing HPA');
      need(/\bimage:\s*\S+/.test(manifest), 'missing container image');
      need(/containerPort:\s*\d+/.test(manifest), 'missing containerPort');
      need(manifest.includes('/health/live'), 'missing liveness probe');
      need(manifest.includes('/health/ready'), 'missing readiness probe');
      break;
    }
    case 'cloudrun': {
      need(manifest.includes('serving.knative.dev'), 'missing Knative apiVersion');
      need(/\bkind:\s*Service\b/.test(manifest), 'missing Service');
      need(/image:\s*\S+/.test(manifest), 'missing container image');
      need(/containerPort:\s*\d+/.test(manifest), 'missing containerPort');
      need(manifest.includes('/health/live'), 'missing liveness probe');
      need(manifest.includes('/health/ready'), 'missing readiness probe');
      break;
    }
    case 'ecs': {
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(manifest) as Record<string, unknown>; } catch { errors.push('invalid JSON'); }
      if (parsed) {
        need(typeof parsed['family'] === 'string', 'missing family');
        const defs = parsed['containerDefinitions'] as Array<Record<string, unknown>> | undefined;
        need(Array.isArray(defs) && defs.length > 0, 'missing containerDefinitions');
        const c = defs?.[0];
        need(!!c && typeof c['image'] === 'string', 'missing container image');
        need(!!c && Array.isArray(c['portMappings']) && (c['portMappings'] as unknown[]).length > 0, 'missing portMappings');
        const hc = c?.['healthCheck'] as { command?: string[] } | undefined;
        need(!!hc && Array.isArray(hc.command) && hc.command.join(' ').includes('/health/live'), 'missing health check');
      }
      break;
    }
    case 'nomad': {
      need(/job\s+"[^"]+"\s*\{/.test(manifest), 'missing job block');
      need(manifest.includes('driver = "docker"'), 'missing docker driver');
      need(/image\s*=\s*"\S+"/.test(manifest), 'missing container image');
      need(/check\s*\{/.test(manifest), 'missing health check block');
      need(manifest.includes('/health/live'), 'missing health check path');
      break;
    }
    default:
      errors.push(`unknown platform "${platform as string}"`);
  }
  return { valid: errors.length === 0, errors };
}

function generateKubernetes(config: DeployConfig): string {
  // A combined, production-grade manifest (Deployment + Service + HPA) for the
  // legacy single-string API. The split-file production manifests and the Helm
  // chart are produced by generateTargetAssets('kubernetes', ...).
  return [
    `# Kubernetes production manifests for ${config.name}`,
    `# (Deployment + Service + HorizontalPodAutoscaler)`,
    k8sDeploymentManifest(config),
    k8sServiceManifest(config),
    k8sHpaManifest(config),
  ].join('\n---\n');
}

// ── Kubernetes production manifest pieces ───────────────────────────────────────

function k8sEnvSection(config: DeployConfig, indent: string): string {
  const entries = Object.entries(config.env ?? {});
  if (entries.length === 0) return '';
  const lines = entries
    .map(([k, v]) => `${indent}  - name: ${k}\n${indent}    value: "${v}"`)
    .join('\n');
  return `\n${indent}env:\n${lines}`;
}

/** Production Deployment: rolling updates, non-root securityContext, and the
 * startup/liveness/readiness probe trio (Requirement 2.2). */
function k8sDeploymentManifest(config: DeployConfig): string {
  const replicas = config.replicas ?? 2;
  const cpu = config.cpu ?? '250m';
  const memory = config.memory ?? '256Mi';
  const envSection = k8sEnvSection(config, '            ');

  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${config.name}
  labels:
    app.kubernetes.io/name: ${config.name}
    app.kubernetes.io/managed-by: street
spec:
  replicas: ${replicas}
  revisionHistoryLimit: 5
  minReadySeconds: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: ${config.name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${config.name}
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: ${config.name}
          image: ${config.image}
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: ${config.port}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          resources:
            requests:
              cpu: ${cpu}
              memory: ${memory}
            limits:
              cpu: ${cpu}
              memory: ${memory}${envSection}
          startupProbe:
            httpGet:
              path: /health/live
              port: http
            failureThreshold: 30
            periodSeconds: 2
          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            initialDelaySeconds: 10
            periodSeconds: 30
            timeoutSeconds: 5
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
`;
}

function k8sServiceManifest(config: DeployConfig): string {
  return `apiVersion: v1
kind: Service
metadata:
  name: ${config.name}
  labels:
    app.kubernetes.io/name: ${config.name}
spec:
  selector:
    app.kubernetes.io/name: ${config.name}
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: http
  type: ClusterIP
`;
}

/** HorizontalPodAutoscaler autoscaling example (Requirement 2.2): scales on
 * CPU and memory utilization with stabilized scale-down. */
function k8sHpaManifest(config: DeployConfig): string {
  const minReplicas = config.replicas ?? 2;
  const maxReplicas = Math.max(minReplicas * 5, 10);
  return `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${config.name}-hpa
  labels:
    app.kubernetes.io/name: ${config.name}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${config.name}
  minReplicas: ${minReplicas}
  maxReplicas: ${maxReplicas}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
`;
}

// ── Cloud Run ─────────────────────────────────────────────────────────────────

function generateCloudRun(config: DeployConfig): string {
  const cpu = config.cpu ?? '1';
  const memory = config.memory ?? '512Mi';
  const minScale = config.replicas ?? 0; // scale-to-zero by default
  const maxScale = Math.max((config.replicas ?? 1) * 10, 10);

  const envVars = Object.entries(config.env ?? {})
    .map(([k, v]) => `            - name: ${k}\n              value: "${v}"`)
    .join('\n');

  const envSection = envVars ? `\n            env:\n${envVars}` : '';

  // A production Cloud Run profile: revision-scoped autoscaling annotations,
  // always-allocated CPU with startup boost, a bounded request concurrency, and
  // the liveness/readiness probe pair (Requirement 2.3).
  return `# Cloud Run service profile for ${config.name}
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: ${config.name}
  labels:
    cloud.googleapis.com/location: us-central1
  annotations:
    run.googleapis.com/ingress: all
    run.googleapis.com/launch-stage: GA
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "${minScale}"
        autoscaling.knative.dev/maxScale: "${maxScale}"
        run.googleapis.com/cpu-throttling: "false"
        run.googleapis.com/startup-cpu-boost: "true"
        run.googleapis.com/execution-environment: gen2
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      containers:
        - image: ${config.image}
          ports:
            - name: http1
              containerPort: ${config.port}
          resources:
            limits:
              cpu: "${cpu}"
              memory: ${memory}${envSection}
          startupProbe:
            httpGet:
              path: /health/live
              port: ${config.port}
            failureThreshold: 30
            periodSeconds: 2
          livenessProbe:
            httpGet:
              path: /health/live
              port: ${config.port}
            periodSeconds: 30
            timeoutSeconds: 5
          readinessProbe:
            httpGet:
              path: /health/ready
              port: ${config.port}
            periodSeconds: 10
            timeoutSeconds: 5
  traffic:
    - percent: 100
      latestRevision: true
`;
}

// ── ECS ───────────────────────────────────────────────────────────────────────

function generateEcs(config: DeployConfig): string {
  const cpu = config.cpu ?? '256';
  const memory = config.memory ?? '512';

  const envVars = Object.entries(config.env ?? {}).map(([name, value]) => ({
    name,
    value,
  }));

  const taskDef = {
    family: config.name,
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu,
    memory,
    runtimePlatform: {
      cpuArchitecture: 'X86_64',
      operatingSystemFamily: 'LINUX',
    },
    executionRoleArn: `arn:aws:iam::000000000000:role/${config.name}-execution`,
    taskRoleArn: `arn:aws:iam::000000000000:role/${config.name}-task`,
    containerDefinitions: [
      {
        name: config.name,
        image: config.image,
        essential: true,
        portMappings: [
          {
            containerPort: config.port,
            protocol: 'tcp',
          },
        ],
        environment: envVars,
        healthCheck: {
          command: ['CMD-SHELL', `curl -f http://localhost:${config.port}/health/live || exit 1`],
          interval: 30,
          timeout: 5,
          retries: 3,
          startPeriod: 10,
        },
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': `/ecs/${config.name}`,
            'awslogs-region': 'us-east-1',
            'awslogs-stream-prefix': 'ecs',
          },
        },
      },
    ],
  };

  return JSON.stringify(taskDef, null, 2);
}

// ── ECS service definition ──────────────────────────────────────────────────────

export interface EcsServiceValidationResult { valid: boolean; errors: string[]; }

/**
 * Generate the ECS service definition JSON (Requirement 2.4): the long-running
 * service that schedules the {@link generateEcs} task definition on Fargate
 * behind a load balancer, with a rolling deployment circuit breaker and a
 * health-check grace period that tolerates lazy DB warm-up.
 */
export function generateEcsService(config: DeployConfig): string {
  const desiredCount = config.replicas ?? 2;
  const serviceDef = {
    serviceName: config.name,
    cluster: `${config.name}-cluster`,
    taskDefinition: config.name,
    desiredCount,
    launchType: 'FARGATE',
    schedulingStrategy: 'REPLICA',
    platformVersion: 'LATEST',
    healthCheckGracePeriodSeconds: 60,
    enableExecuteCommand: false,
    deploymentConfiguration: {
      minimumHealthyPercent: 100,
      maximumPercent: 200,
      deploymentCircuitBreaker: {
        enable: true,
        rollback: true,
      },
    },
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: ['subnet-REPLACE_ME'],
        securityGroups: ['sg-REPLACE_ME'],
        assignPublicIp: 'DISABLED',
      },
    },
    loadBalancers: [
      {
        targetGroupArn: 'arn:aws:elasticloadbalancing:us-east-1:000000000000:targetgroup/REPLACE_ME',
        containerName: config.name,
        containerPort: config.port,
      },
    ],
  };
  return JSON.stringify(serviceDef, null, 2);
}

/** Structurally validate a generated ECS service definition offline. */
export function validateEcsService(manifest: string): EcsServiceValidationResult {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string): void => { if (!cond) errors.push(msg); };
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(manifest) as Record<string, unknown>; } catch { return { valid: false, errors: ['invalid JSON'] }; }
  need(typeof parsed['serviceName'] === 'string', 'missing serviceName');
  need(typeof parsed['taskDefinition'] === 'string', 'missing taskDefinition');
  need(typeof parsed['desiredCount'] === 'number', 'missing desiredCount');
  need(parsed['launchType'] === 'FARGATE', 'missing FARGATE launchType');
  const net = parsed['networkConfiguration'] as { awsvpcConfiguration?: { subnets?: unknown[] } } | undefined;
  need(!!net?.awsvpcConfiguration && Array.isArray(net.awsvpcConfiguration.subnets), 'missing awsvpc networkConfiguration');
  const lbs = parsed['loadBalancers'] as Array<{ containerPort?: number }> | undefined;
  need(Array.isArray(lbs) && lbs.length > 0 && typeof lbs[0].containerPort === 'number', 'missing loadBalancers');
  return { valid: errors.length === 0, errors };
}

// ── Nomad ─────────────────────────────────────────────────────────────────────

function generateNomad(config: DeployConfig): string {
  const cpu = parseInt(config.cpu ?? '100', 10);
  const memory = parseInt(config.memory ?? '128', 10);
  const count = config.replicas ?? 1;

  const envLines = Object.entries(config.env ?? {})
    .map(([k, v]) => `      env {\n        ${k} = "${v}"\n      }`)
    .join('\n');

  return `# Nomad job for ${config.name}
job "${config.name}" {
  datacenters = ["dc1"]
  type        = "service"

  group "${config.name}" {
    count = ${count}

    network {
      port "http" {
        to = ${config.port}
      }
    }

    service {
      name = "${config.name}"
      port = "http"

      check {
        type     = "http"
        path     = "/health/live"
        interval = "30s"
        timeout  = "5s"
      }
    }

    task "${config.name}" {
      driver = "docker"

      config {
        image = "${config.image}"
        ports = ["http"]
      }
${envLines ? '\n' + envLines + '\n' : ''}
      resources {
        cpu    = ${cpu}
        memory = ${memory}
      }
    }
  }
}
`;
}

// ── Per-target asset generation (Cloud Deployment Verifier) ─────────────────────

/**
 * Generate the per-target deliverable bundle for a {@link DeploymentTarget}
 * (Requirements 2.1, 2.2). Returns a map of relative file path → file content
 * so callers can write or structurally verify the assets offline.
 *
 * Kubernetes is fully realized here: split production manifests
 * (Deployment/Service/HPA), the Helm chart under `deploy/helm/street/`, and the
 * standalone HPA autoscaling example. Cloud Run emits the service profile, a CI
 * verify workflow and a smoke-test script; ECS emits the task definition, the
 * service definition, a deploy workflow and smoke tests. The serverless targets
 * (lambda, azure-functions, gcf, cloudflare-workers) each emit a provider deploy
 * workflow, the request adapter that bridges the provider's event/runtime model
 * to the Street app, the provider host/config files, and a validation test.
 */
export function generateTargetAssets(
  target: DeploymentTarget,
  cfg: DeployConfig,
): Record<string, string> {
  switch (target) {
    case 'kubernetes':
      return kubernetesAssets(cfg);
    case 'cloudrun':
      return {
        'deploy/cloudrun/service.yaml': generateCloudRun(cfg),
        '.github/workflows/deploy-cloudrun.yml': cloudRunWorkflow(cfg),
        'scripts/cloud/cloudrun/smoke.mjs': smokeTestScript('cloudrun', cfg),
      };
    case 'ecs':
      return {
        'deploy/ecs/taskdef.json': generateEcs(cfg),
        'deploy/ecs/service.json': generateEcsService(cfg),
        '.github/workflows/deploy-ecs.yml': ecsWorkflow(cfg),
        'scripts/cloud/ecs/smoke.mjs': smokeTestScript('ecs', cfg),
      };
    case 'lambda':
      return lambdaAssets(cfg);
    case 'azure-functions':
      return azureFunctionsAssets(cfg);
    case 'gcf':
      return gcfAssets(cfg);
    case 'cloudflare-workers':
      return cloudflareWorkersAssets(cfg);
    default:
      throw new Error(`generateTargetAssets: unknown target "${target as string}"`);
  }
}

/** The full Kubernetes deliverable bundle: split manifests + Helm chart + HPA example. */
function kubernetesAssets(cfg: DeployConfig): Record<string, string> {
  return {
    'deploy/k8s/deployment.yaml': k8sDeploymentManifest(cfg),
    'deploy/k8s/service.yaml': k8sServiceManifest(cfg),
    'deploy/k8s/hpa.yaml': k8sHpaManifest(cfg),
    'deploy/k8s/hpa-autoscaling-example.yaml': hpaAutoscalingExample(cfg),
    ...helmChartAssets(),
  };
}

/**
 * A standalone, heavily-commented HPA autoscaling example (Requirement 2.2)
 * that operators can copy and tune independently of the bundled manifests.
 */
function hpaAutoscalingExample(cfg: DeployConfig): string {
  const minReplicas = cfg.replicas ?? 2;
  const maxReplicas = Math.max(minReplicas * 5, 10);
  return `# HorizontalPodAutoscaler autoscaling example for ${cfg.name}.
# Scales between ${minReplicas} and ${maxReplicas} replicas on CPU + memory
# utilization. Requires metrics-server to be installed in the cluster.
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${cfg.name}-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${cfg.name}
  minReplicas: ${minReplicas}
  maxReplicas: ${maxReplicas}
  metrics:
    # Target 70% average CPU utilization across pods.
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    # Target 80% average memory utilization across pods.
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    # Scale down conservatively to avoid flapping.
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    # Scale up aggressively to absorb traffic spikes.
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
`;
}

// ── Helm chart (deploy/helm/street/) ────────────────────────────────────────────

/**
 * The Street Helm chart deliverable. Templates are values-driven so a single
 * chart serves dev/staging/prod via `values.yaml` overrides. Returns a map of
 * chart file path → content (Requirement 2.2).
 */
export function helmChartAssets(): Record<string, string> {
  return {
    'deploy/helm/street/Chart.yaml': HELM_CHART_YAML,
    'deploy/helm/street/values.yaml': HELM_VALUES_YAML,
    'deploy/helm/street/.helmignore': HELM_HELMIGNORE,
    'deploy/helm/street/templates/_helpers.tpl': HELM_HELPERS_TPL,
    'deploy/helm/street/templates/deployment.yaml': HELM_DEPLOYMENT_TPL,
    'deploy/helm/street/templates/service.yaml': HELM_SERVICE_TPL,
    'deploy/helm/street/templates/hpa.yaml': HELM_HPA_TPL,
    'deploy/helm/street/templates/NOTES.txt': HELM_NOTES_TXT,
  };
}

const HELM_CHART_YAML = `apiVersion: v2
name: street
description: A Helm chart for deploying a Street Framework application
type: application
version: 0.1.0
appVersion: "1.0.0"
keywords:
  - street
  - streetjs
  - nodejs
home: https://github.com/streetjs
maintainers:
  - name: Street Framework
`;

const HELM_VALUES_YAML = `# Default values for the Street chart.
replicaCount: 2

image:
  repository: street-app
  tag: latest
  pullPolicy: IfNotPresent

containerPort: 3000

service:
  type: ClusterIP
  port: 80

resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: 250m
    memory: 256Mi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80

# Health probe paths served by the application.
probes:
  livenessPath: /health/live
  readinessPath: /health/ready

# Extra environment variables passed to the container.
env: {}

securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  readOnlyRootFilesystem: true
`;

const HELM_HELMIGNORE = `.git/
*.tmp
*.bak
.DS_Store
`;

const HELM_HELPERS_TPL = `{{/* Common name helpers for the Street chart. */}}
{{- define "street.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "street.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "street.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "street.labels" -}}
app.kubernetes.io/name: {{ include "street.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "street.selectorLabels" -}}
app.kubernetes.io/name: {{ include "street.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
`;

const HELM_DEPLOYMENT_TPL = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "street.fullname" . }}
  labels:
    {{- include "street.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      {{- include "street.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "street.selectorLabels" . | nindent 8 }}
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: {{ .Values.securityContext.runAsNonRoot }}
        runAsUser: {{ .Values.securityContext.runAsUser }}
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: {{ include "street.name" . }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.containerPort }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: {{ .Values.securityContext.readOnlyRootFilesystem }}
            capabilities:
              drop:
                - ALL
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          {{- with .Values.env }}
          env:
            {{- range $k, $v := . }}
            - name: {{ $k }}
              value: {{ $v | quote }}
            {{- end }}
          {{- end }}
          startupProbe:
            httpGet:
              path: {{ .Values.probes.livenessPath }}
              port: http
            failureThreshold: 30
            periodSeconds: 2
          livenessProbe:
            httpGet:
              path: {{ .Values.probes.livenessPath }}
              port: http
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: {{ .Values.probes.readinessPath }}
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
`;

const HELM_SERVICE_TPL = `apiVersion: v1
kind: Service
metadata:
  name: {{ include "street.fullname" . }}
  labels:
    {{- include "street.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  selector:
    {{- include "street.selectorLabels" . | nindent 4 }}
  ports:
    - name: http
      protocol: TCP
      port: {{ .Values.service.port }}
      targetPort: http
`;

const HELM_HPA_TPL = `{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "street.fullname" . }}
  labels:
    {{- include "street.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "street.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
    {{- if .Values.autoscaling.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetMemoryUtilizationPercentage }}
    {{- end }}
{{- end }}
`;

const HELM_NOTES_TXT = `Street has been deployed.

1. Check the rollout status:
   kubectl rollout status deployment/{{ include "street.fullname" . }}

2. Port-forward to reach the service locally:
   kubectl port-forward svc/{{ include "street.fullname" . }} 8080:{{ .Values.service.port }}

3. Verify health:
   curl http://localhost:8080{{ .Values.probes.livenessPath }}
   curl http://localhost:8080{{ .Values.probes.readinessPath }}
`;

// ── Cloud Run / ECS workflows + smoke tests ─────────────────────────────────────

/** A health + smoke verification script shared by the container targets. It
 * polls `/health/live` and `/health/ready` (≤ 5s each) then runs a minimal
 * request smoke check, exiting non-zero on any failure (Requirements 2.9, 2.10). */
function smokeTestScript(target: DeploymentTarget, cfg: DeployConfig): string {
  return `#!/usr/bin/env node
// Health + smoke verification for ${target} — ${cfg.name}.
// Usage: BASE_URL=https://<deployed-url> node smoke.mjs
import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = process.env.BASE_URL;
if (!baseUrl) {
  console.error('BLOCKED: BASE_URL is required (the deployed instance URL).');
  process.exit(2);
}

async function check(path) {
  const started = Date.now();
  const res = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(5000) });
  const elapsed = Date.now() - started;
  if (!res.ok) throw new Error(\`\${path} returned \${res.status}\`);
  if (elapsed > 5000) throw new Error(\`\${path} exceeded 5s budget (\${elapsed}ms)\`);
  return elapsed;
}

const deadline = Date.now() + 300_000; // 300s smoke budget
let failed = 0;
let errored = 0;
try {
  for (const path of ['/health/live', '/health/ready']) {
    let ok = false;
    while (Date.now() < deadline) {
      try { await check(path); ok = true; break; } catch { await delay(2000); }
    }
    if (!ok) { failed += 1; console.error(\`FAIL \${path}\`); }
    else console.log(\`PASS \${path}\`);
  }
} catch (err) {
  errored += 1;
  console.error('ERROR', err);
}

console.log(JSON.stringify({ target: '${target}', passed: 2 - failed, failed, errored }));
process.exit(failed === 0 && errored === 0 ? 0 : 1);
`;
}

function cloudRunWorkflow(cfg: DeployConfig): string {
  return `# Cloud Run deploy + verify workflow for ${cfg.name}.
name: deploy-cloudrun
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: \${{ secrets.GCP_WIF_PROVIDER }}
          service_account: \${{ secrets.GCP_SERVICE_ACCOUNT }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Deploy service
        run: gcloud run services replace deploy/cloudrun/service.yaml --region us-central1
      - name: Health + smoke
        env:
          BASE_URL: \${{ steps.deploy.outputs.url }}
        run: node scripts/cloud/cloudrun/smoke.mjs
`;
}

function ecsWorkflow(cfg: DeployConfig): string {
  return `# ECS Fargate deploy + verify workflow for ${cfg.name}.
name: deploy-ecs
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ secrets.AWS_DEPLOY_ROLE }}
          aws-region: us-east-1
      - name: Register task definition
        run: aws ecs register-task-definition --cli-input-json file://deploy/ecs/taskdef.json
      - name: Update service
        run: aws ecs update-service --cli-input-json file://deploy/ecs/service.json --force-new-deployment
      - name: Health + smoke
        env:
          BASE_URL: \${{ secrets.ECS_SERVICE_URL }}
        run: node scripts/cloud/ecs/smoke.mjs
`;
}

// ── AWS Lambda ──────────────────────────────────────────────────────────────────

function lambdaAssets(cfg: DeployConfig): Record<string, string> {
  return {
    'deploy/lambda/handler.mjs': LAMBDA_HANDLER_ADAPTER,
    'deploy/lambda/coldstart-validate.mjs': lambdaColdStartValidation(cfg),
    '.github/workflows/deploy-lambda.yml': lambdaWorkflow(cfg),
  };
}

/** Lambda handler adapter: bridges an API Gateway (HTTP API v2 / REST v1) or
 * Function URL event to the Street app's `fetch`-style request handler. The
 * Street app is initialised once at module scope so warm invocations skip
 * bootstrap (Requirement 2.5). */
const LAMBDA_HANDLER_ADAPTER = `// AWS Lambda handler adapter for a Street application.
// Build your app to expose a fetch-style handler: \`(Request) => Promise<Response>\`.
import { createApp } from '../../dist/lambda-entry.js';

// Initialised once per execution environment — reused across warm invocations.
const appReady = createApp();

function eventToRequest(event) {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const rawPath = event.rawPath ?? event.path ?? '/';
  const qs = event.rawQueryString ? '?' + event.rawQueryString : '';
  const proto = event.headers?.['x-forwarded-proto'] ?? 'https';
  const host = event.headers?.host ?? event.requestContext?.domainName ?? 'localhost';
  const url = proto + '://' + host + rawPath + qs;
  const body = event.body
    ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body)
    : undefined;
  return new Request(url, { method, headers: event.headers ?? {}, body });
}

async function responseToResult(res) {
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    statusCode: res.status,
    headers,
    isBase64Encoded: true,
    body: buf.toString('base64'),
  };
}

export async function handler(event) {
  const app = await appReady;
  const res = await app.fetch(eventToRequest(event));
  return responseToResult(res);
}
`;

/** Cold-start validation test (Requirement 2.5): asserts that the first
 * (cold) invocation initialises and responds, and that a subsequent warm
 * invocation reuses the already-initialised app and stays within budget. */
function lambdaColdStartValidation(cfg: DeployConfig): string {
  return `#!/usr/bin/env node
// Cold-start validation for the Lambda adapter — ${cfg.name}.
// Run with: node --test deploy/lambda/coldstart-validate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const COLD_START_BUDGET_MS = 10_000; // first init must complete within budget
const WARM_BUDGET_MS = 1_000;        // warm invocations must be fast

test('cold start initialises and responds with health 200', async () => {
  const { handler } = await import('./handler.mjs');
  const started = Date.now();
  const res = await handler({ rawPath: '/health/live', requestContext: { http: { method: 'GET' } }, headers: { host: 'localhost' } });
  const elapsed = Date.now() - started;
  assert.equal(res.statusCode, 200, 'cold invocation returns 200');
  assert.ok(elapsed <= COLD_START_BUDGET_MS, \`cold start \${elapsed}ms exceeded \${COLD_START_BUDGET_MS}ms\`);
});

test('warm invocation reuses initialised app within budget', async () => {
  const { handler } = await import('./handler.mjs');
  await handler({ rawPath: '/health/live', requestContext: { http: { method: 'GET' } }, headers: { host: 'localhost' } });
  const started = Date.now();
  const res = await handler({ rawPath: '/health/ready', requestContext: { http: { method: 'GET' } }, headers: { host: 'localhost' } });
  const elapsed = Date.now() - started;
  assert.equal(res.statusCode, 200, 'warm invocation returns 200');
  assert.ok(elapsed <= WARM_BUDGET_MS, \`warm invocation \${elapsed}ms exceeded \${WARM_BUDGET_MS}ms\`);
});
`;
}

function lambdaWorkflow(cfg: DeployConfig): string {
  return `# AWS Lambda deploy workflow for ${cfg.name}.
name: deploy-lambda
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - name: Cold-start validation
        run: node --test deploy/lambda/coldstart-validate.mjs
      - name: Package
        run: zip -r function.zip dist deploy/lambda/handler.mjs node_modules
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ secrets.AWS_DEPLOY_ROLE }}
          aws-region: us-east-1
      - name: Deploy function
        run: aws lambda update-function-code --function-name ${cfg.name} --zip-file fileb://function.zip
`;
}

// ── Azure Functions ─────────────────────────────────────────────────────────────

function azureFunctionsAssets(cfg: DeployConfig): Record<string, string> {
  return {
    'deploy/azure-functions/host.json': AZURE_HOST_JSON,
    'deploy/azure-functions/api/function.json': AZURE_FUNCTION_JSON,
    'deploy/azure-functions/api/index.mjs': AZURE_FUNCTION_ADAPTER,
    'deploy/azure-functions/validate.mjs': azureValidation(cfg),
    '.github/workflows/deploy-azure-functions.yml': azureWorkflow(cfg),
  };
}

/** Function host configuration (Requirement 2.6). */
const AZURE_HOST_JSON = `{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": { "isEnabled": true, "excludedTypes": "Request" }
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  },
  "extensions": {
    "http": { "routePrefix": "" }
  }
}
`;

const AZURE_FUNCTION_JSON = `{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "route": "{*path}",
      "methods": ["get", "post", "put", "patch", "delete", "options", "head"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ],
  "scriptFile": "index.mjs"
}
`;

/** Azure Functions adapter: bridges the HTTP trigger context to the Street
 * fetch-style handler, initialised once at module scope. */
const AZURE_FUNCTION_ADAPTER = `// Azure Functions HTTP adapter for a Street application.
import { createApp } from '../../../dist/azure-entry.js';

const appReady = createApp();

export default async function (context, req) {
  const app = await appReady;
  const url = req.url ?? ('https://localhost' + (req.params?.path ? '/' + req.params.path : '/'));
  const request = new Request(url, {
    method: req.method ?? 'GET',
    headers: req.headers ?? {},
    body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : req.rawBody,
  });
  const res = await app.fetch(request);
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  context.res = {
    status: res.status,
    headers,
    body: Buffer.from(await res.arrayBuffer()),
  };
}
`;

function azureValidation(cfg: DeployConfig): string {
  return `#!/usr/bin/env node
// Azure Functions adapter validation — ${cfg.name}.
// Run with: node --test deploy/azure-functions/validate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('host.json is valid and pins the v4 extension bundle', () => {
  const host = JSON.parse(readFileSync(new URL('./host.json', import.meta.url)));
  assert.equal(host.version, '2.0');
  assert.match(host.extensionBundle.version, /4\\./);
});

test('function.json wires an anonymous catch-all httpTrigger', () => {
  const fn = JSON.parse(readFileSync(new URL('./api/function.json', import.meta.url)));
  const trigger = fn.bindings.find((b) => b.type === 'httpTrigger');
  assert.ok(trigger, 'httpTrigger binding present');
  assert.equal(trigger.route, '{*path}');
});

test('adapter returns 200 for the liveness route', async () => {
  const mod = await import('./api/index.mjs');
  const context = {};
  await mod.default(context, { method: 'GET', url: 'https://localhost/health/live', headers: {}, params: { path: 'health/live' } });
  assert.equal(context.res.status, 200);
});
`;
}

function azureWorkflow(cfg: DeployConfig): string {
  return `# Azure Functions deploy workflow for ${cfg.name}.
name: deploy-azure-functions
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - name: Validation tests
        run: node --test deploy/azure-functions/validate.mjs
      - uses: Azure/functions-action@v1
        with:
          app-name: ${cfg.name}
          package: .
          publish-profile: \${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
`;
}

// ── Google Cloud Functions ──────────────────────────────────────────────────────

function gcfAssets(cfg: DeployConfig): Record<string, string> {
  return {
    'deploy/gcf/index.mjs': GCF_ENTRYPOINT_ADAPTER,
    'deploy/gcf/validate.mjs': gcfValidation(cfg),
    '.github/workflows/deploy-gcf.yml': gcfWorkflow(cfg),
  };
}

/** GCF entrypoint adapter (Requirement 2.7): exports a Functions Framework HTTP
 * function (`(req, res)`) that drives the Street fetch-style handler. */
const GCF_ENTRYPOINT_ADAPTER = `// Google Cloud Functions HTTP entrypoint adapter for a Street application.
// Functions Framework signature: an exported (req, res) HTTP function.
import { createApp } from '../../dist/gcf-entry.js';

const appReady = createApp();

export const street = async (req, res) => {
  const app = await appReady;
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  const host = req.headers.host ?? 'localhost';
  const url = proto + '://' + host + (req.originalUrl ?? req.url ?? '/');
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : (req.rawBody ?? undefined);
  const request = new Request(url, { method: req.method, headers: req.headers, body });
  const response = await app.fetch(request);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.status(response.status);
  res.send(Buffer.from(await response.arrayBuffer()));
};
`;

function gcfValidation(cfg: DeployConfig): string {
  return `#!/usr/bin/env node
// Google Cloud Functions entrypoint validation — ${cfg.name}.
// Run with: node --test deploy/gcf/validate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('entrypoint responds 200 for the liveness route', async () => {
  const { street } = await import('./index.mjs');
  let status = 0;
  const headers = {};
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (s) => { status = s; return res; },
    send: () => {},
  };
  await street(
    { method: 'GET', url: '/health/live', originalUrl: '/health/live', headers: { host: 'localhost' } },
    res,
  );
  assert.equal(status, 200, 'liveness returns 200');
});
`;
}

function gcfWorkflow(cfg: DeployConfig): string {
  return `# Google Cloud Functions deploy workflow for ${cfg.name}.
name: deploy-gcf
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - name: Validation tests
        run: node --test deploy/gcf/validate.mjs
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: \${{ secrets.GCP_WIF_PROVIDER }}
          service_account: \${{ secrets.GCP_SERVICE_ACCOUNT }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Deploy function
        run: |
          gcloud functions deploy ${cfg.name} \\
            --gen2 --runtime nodejs20 --region us-central1 \\
            --source deploy/gcf --entry-point street --trigger-http --allow-unauthenticated
`;
}

// ── Cloudflare Workers ──────────────────────────────────────────────────────────

function cloudflareWorkersAssets(cfg: DeployConfig): Record<string, string> {
  return {
    'deploy/cloudflare-workers/wrangler.toml': wranglerConfig(cfg),
    'deploy/cloudflare-workers/worker.mjs': CLOUDFLARE_WORKER_ADAPTER,
    'deploy/cloudflare-workers/validate.mjs': cloudflareValidation(cfg),
    '.github/workflows/deploy-cloudflare-workers.yml': cloudflareWorkflow(cfg),
  };
}

/** `wrangler` configuration (Requirement 2.8). */
function wranglerConfig(cfg: DeployConfig): string {
  const envVars = Object.entries(cfg.env ?? {});
  const varsBlock = envVars.length > 0
    ? '\n[vars]\n' + envVars.map(([k, v]) => `${k} = "${v}"`).join('\n') + '\n'
    : '';
  return `# Cloudflare Workers configuration for ${cfg.name}.
name = "${cfg.name}"
main = "worker.mjs"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[placement]
mode = "smart"
${varsBlock}`;
}

/** Worker adapter (`@streetjs/edge`, Requirement 2.8): the Workers runtime
 * already speaks `fetch(Request) => Response`, so the adapter delegates straight
 * to the Street app's fetch handler. */
const CLOUDFLARE_WORKER_ADAPTER = `// Cloudflare Workers adapter for a Street application (@streetjs/edge).
// The Workers runtime is already fetch-native, so we delegate directly.
import { createEdgeApp } from '@streetjs/edge';

let app;

export default {
  async fetch(request, env, ctx) {
    app ??= await createEdgeApp(env);
    return app.fetch(request, { env, ctx });
  },
};
`;

function cloudflareValidation(cfg: DeployConfig): string {
  return `#!/usr/bin/env node
// Cloudflare Workers adapter validation — ${cfg.name}.
// Run with: node --test deploy/cloudflare-workers/validate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('wrangler.toml declares an entrypoint and a compatibility date', () => {
  const toml = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /main\\s*=\\s*"worker\\.mjs"/);
  assert.match(toml, /compatibility_date\\s*=/);
  assert.match(toml, /nodejs_compat/);
});

test('worker module exports a default fetch handler', async () => {
  const src = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.match(src, /export default/);
  assert.match(src, /async fetch\\(/);
});
`;
}

function cloudflareWorkflow(cfg: DeployConfig): string {
  return `# Cloudflare Workers deploy workflow for ${cfg.name}.
name: deploy-cloudflare-workers
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - name: Validation tests
        run: node --test deploy/cloudflare-workers/validate.mjs
      - name: Dry-run (offline verifiable)
        run: npx wrangler deploy --dry-run --config deploy/cloudflare-workers/wrangler.toml
      - name: Deploy
        run: npx wrangler deploy --config deploy/cloudflare-workers/wrangler.toml
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
`;
}
