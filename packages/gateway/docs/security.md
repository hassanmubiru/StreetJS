# Security guide

The gateway is an edge component, so it applies defensive controls to every
request. This guide describes what ships in the box and what remains the
operator's responsibility.

## Security headers

`applySecurityHeaders` sets a conservative default header set
(`DEFAULT_SECURITY_HEADERS`) on every response and merges any overrides from
`security.headers`. Explicit values in `security.headers` win over the defaults.

```ts
security: {
  headers: {
    "content-security-policy": "default-src 'self'",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
  },
}
```

## Request size limits

`security.maxBodyBytes` caps the request body. A larger body is rejected with a
`PayloadTooLargeError` (`413`) before it is forwarded, protecting upstreams from
memory-exhaustion payloads.

## Timeout protection

Every forward runs under a per-attempt timeout (`policy.timeoutMs`, default
30s). A slow or hung upstream is abandoned via `AbortSignal` and surfaces as an
`UpstreamTimeoutError`, so a single bad backend cannot pin gateway resources.

## Slowloris protection

`security.headerTimeoutMs` bounds how long a client may take to finish sending
request headers. `resolveHeaderTimeoutMs` exposes this value so it can be applied
to the underlying `node:http` server's `headersTimeout`/`requestTimeout` when you
bind the gateway to a transport. Enforcing it at the server edge is the
operator's responsibility — the gateway supplies the policy value.

## CORS

Disallowed origins are rejected with `403` (`ForbiddenError`); genuine
preflights are answered with `204` and the negotiated CORS headers. Prefer an
explicit `origins` allow-list over `"*"`, and only enable `credentials: true`
with a concrete allow-list (never with `"*"`).

## Authentication & authorization

- Authentication runs before authorization; an unauthenticated principal is
  `null`. Custom verifiers should treat any malformed/absent credential as
  unauthenticated (return `null`) rather than throwing.
- Authorization failures surface as `403` (`ForbiddenError`); missing
  authentication where it is required surfaces as `401` (`UnauthenticatedError`).
- Rate limiting runs *before* auth in the pipeline; user/api-key scopes fall back
  to their anonymous bucket until an identity is resolved. Combine an `ip`-scoped
  limit with a per-user limit for defence in depth.

## Health-gated traffic

Only targets not marked `unhealthy` receive traffic (`filterHealthy` is
fail-open: `healthy`/`unknown`/unrecorded all pass). Probe upstreams with
`httpChecker`/`tcpChecker` so a failing instance is removed from rotation.

## Error hygiene

All errors are normalized to a consistent JSON shape (`{ error, message }`, plus
`issues` for validation errors). Upstream error internals are never echoed to the
client; non-gateway throwables become `502`.

## Operator checklist

- Terminate TLS at or before the gateway; forward only over trusted networks.
- Set `maxBodyBytes` and apply `headerTimeoutMs` at the HTTP server.
- Use an explicit CORS allow-list; avoid `"*"` with credentials.
- Add authentication/authorization policies to every non-public route.
- Register health checks so unhealthy upstreams are drained automatically.
- Treat all forwarded/inbound content as untrusted.
