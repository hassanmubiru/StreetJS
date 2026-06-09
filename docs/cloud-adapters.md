---
layout: default
title: "Serverless & Cloud Adapters"
nav_exclude: true
---

# Serverless & Cloud Adapters

`@streetjs/edge` adapts a `StreetApp` to serverless and edge runtimes by mapping
each platform's request shape to a Web Fetch `Request`, dispatching through
`handleEdgeRequest`, and converting the `Response` back to the platform result.

| Platform | Adapter | Status | Tests |
| --- | --- | --- | --- |
| AWS Lambda (API Gateway v1 + v2) | `createLambdaHandler(app)` | VERIFIED | `lambda.test.ts` (5) |
| Azure Functions (v4 HTTP) | `createAzureHandler(app)` | VERIFIED | `cloud-adapters.test.ts` (3) |
| Google Cloud Functions (HTTP) | `createGcfHandler(app)` | VERIFIED | `cloud-adapters.test.ts` (3) |
| Cloudflare Workers / Vercel Edge / Deno Deploy | `handleEdgeRequest(request, app)` | VERIFIED | `adapter.test.ts` (3) |

All adapters are dependency-free (no `aws-sdk`, `@azure/functions`, or
`functions-framework` runtime dependency) and accept minimal structural request
types, so they are testable without the cloud runtime installed.

## AWS Lambda

```ts
import { streetApp } from 'streetjs';
import { createLambdaHandler } from '@streetjs/edge';
const app = streetApp();
app.use(async (ctx) => ctx.json({ ok: true }));
export const handler = createLambdaHandler(app); // API Gateway v1 or v2
```

## Azure Functions (v4)

```ts
import { app } from '@azure/functions';
import { streetApp } from 'streetjs';
import { createAzureHandler } from '@streetjs/edge';
const street = streetApp();
app.http('api', { route: '{*path}', methods: ['GET', 'POST'], handler: createAzureHandler(street) });
```

## Google Cloud Functions

```ts
import { http } from '@google-cloud/functions-framework';
import { streetApp } from 'streetjs';
import { createGcfHandler } from '@streetjs/edge';
const street = streetApp();
http('api', createGcfHandler(street));
```

## Cloudflare Workers / Vercel Edge / Deno Deploy

These runtimes implement the WinterCG Fetch standard, so `handleEdgeRequest`
works directly:

```ts
import { handleEdgeRequest } from '@streetjs/edge';
export default { fetch: (req: Request) => handleEdgeRequest(req, app) };  // CF Workers
```

## Verification

```bash
npm run build -w packages/edge
node --test packages/edge/dist/*.test.js   # 14 tests, 0 fail
```

## Limitations

- Adapters cover the HTTP request/response path. Platform-specific bindings
  (queues, blob triggers, durable functions) are out of scope.
- Azure/GCP deployment manifests and example apps are not yet included
  (roadmap).
