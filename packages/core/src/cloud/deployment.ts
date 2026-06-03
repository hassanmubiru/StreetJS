// src/cloud/deployment.ts
// Cloud deployment manifest generation for Kubernetes, Cloud Run, ECS, and Nomad.

// ── Types ──────────────────────────────────────────────────────────────────────

export type CloudPlatform = 'kubernetes' | 'cloudrun' | 'ecs' | 'nomad';

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

// ── Kubernetes ────────────────────────────────────────────────────────────────

function generateKubernetes(config: DeployConfig): string {
  const replicas = config.replicas ?? 1;
  const cpu = config.cpu ?? '100m';
  const memory = config.memory ?? '128Mi';

  const envVars = Object.entries(config.env ?? {})
    .map(([k, v]) => `        - name: ${k}\n          value: "${v}"`)
    .join('\n');

  const envSection = envVars ? `\n        env:\n${envVars}` : '';

  return `# Kubernetes Deployment, Service, and HPA for ${config.name}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${config.name}
  labels:
    app: ${config.name}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${config.name}
  template:
    metadata:
      labels:
        app: ${config.name}
    spec:
      containers:
        - name: ${config.name}
          image: ${config.image}
          ports:
            - containerPort: ${config.port}
          resources:
            requests:
              cpu: ${cpu}
              memory: ${memory}
            limits:
              cpu: ${cpu}
              memory: ${memory}${envSection}
          livenessProbe:
            httpGet:
              path: /health/live
              port: ${config.port}
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health/ready
              port: ${config.port}
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: ${config.name}
spec:
  selector:
    app: ${config.name}
  ports:
    - protocol: TCP
      port: 80
      targetPort: ${config.port}
  type: ClusterIP
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${config.name}-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${config.name}
  minReplicas: ${replicas}
  maxReplicas: ${Math.max(replicas * 3, 3)}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
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
