# @streetjs/edge

Edge/serverless runtime adapters for the [StreetJS](https://hassanmubiru.github.io/StreetJS/)
framework. Bridges a StreetJS HTTP handler to platform-specific request/response
shapes so the same app runs on Node, edge runtimes, and cloud function providers.

## Install

```bash
npm install @streetjs/edge streetjs
```

`streetjs` is a peer dependency.

## Adapters

- **Generic edge adapter** (`adapter`) — maps the Web `Request`/`Response` (Fetch
  API) surface used by edge runtimes (Cloudflare Workers, Vercel Edge) onto a
  StreetJS handler.
- **AWS Lambda** (`lambda`) — adapts API Gateway / Lambda function URL events.
- **Google Cloud Functions** (`gcf`) and **Azure Functions** (`azure`) — adapt the
  respective provider request/response objects.

```ts
import { toEdgeHandler } from '@streetjs/edge';

// `app` is a StreetJS HTTP handler; `handler` is a Fetch-API edge entrypoint.
export const handler = toEdgeHandler(app);
```

See the source entrypoints (`adapter`, `lambda`, `gcf`, `azure`) for the exact
exported adapter functions and their signatures.

## Scripts

- `npm run build` — compile to `dist/` (production build excludes test files).
- `npm test` — compile with tests and run the `node:test` suites
  (`adapter.test`, `cloud-adapters.test`, `lambda.test`).

## License

MIT
