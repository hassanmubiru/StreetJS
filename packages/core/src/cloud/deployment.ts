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

  const envVars = Object.entries(config.env ?? {})
    .map(([k, v]) => `        - name: ${k}\n          value: "${v}"`)
    .join('\n');

  const envSection = envVars ? `\n        env:\n${envVars}` : '';

  return `# Cloud Run service.yaml for ${config.name}
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: ${config.name}
  annotations:
    run.googleapis.com/ingress: all
spec:
  template:
    spec:
      containers:
        - image: ${config.image}
          ports:
            - containerPort: ${config.port}
          resources:
            limits:
              cpu: "${cpu}"
              memory: ${memory}${envSection}
          livenessProbe:
            httpGet:
              path: /health/live
              port: ${config.port}
          readinessProbe:
            httpGet:
              path: /health/ready
              port: ${config.port}
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
 * standalone HPA autoscaling example. The Cloud Run and ECS bundles reuse the
 * existing offline generators. The serverless targets (lambda, azure-functions,
 * gcf, cloudflare-workers) carry a baseline deploy workflow here; their handler
 * adapters and full workflows are filled in by a later task.
 */
export function generateTargetAssets(
  target: DeploymentTarget,
  cfg: DeployConfig,
): Record<string, string> {
  switch (target) {
    case 'kubernetes':
      return kubernetesAssets(cfg);
    case 'cloudrun':
      return { 'deploy/cloudrun/service.yaml': generateCloudRun(cfg) };
    case 'ecs':
      return { 'deploy/ecs/taskdef.json': generateEcs(cfg) };
    case 'lambda':
      return { '.github/workflows/deploy-lambda.yml': baselineDeployWorkflow('lambda', cfg) };
    case 'azure-functions':
      return { '.github/workflows/deploy-azure-functions.yml': baselineDeployWorkflow('azure-functions', cfg) };
    case 'gcf':
      return { '.github/workflows/deploy-gcf.yml': baselineDeployWorkflow('gcf', cfg) };
    case 'cloudflare-workers':
      return { '.github/workflows/deploy-cloudflare-workers.yml': baselineDeployWorkflow('cloudflare-workers', cfg) };
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

// ── Serverless baseline workflows (extended by a later task) ─────────────────────

/**
 * A minimal, valid GitHub Actions deploy workflow scaffold for a serverless
 * target. The full handler adapters and provider-specific steps are added by a
 * later task; this establishes the workflow file so the target is wired.
 */
function baselineDeployWorkflow(target: DeploymentTarget, cfg: DeployConfig): string {
  return `# Baseline deploy workflow for ${target} — ${cfg.name}.
name: deploy-${target}
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
      # Provider-specific deploy + validation steps are added by a later task.
`;
}
