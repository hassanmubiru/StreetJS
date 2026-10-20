# Framework conformance

Run from the workspace root:

```sh
npm ci
npm run test:conformance
```

The pretest hook builds core and its foundation dependencies before testing the
public `streetjs` entry point. `npm run verify` also runs this suite. No new
workspace package or production API is introduced.

## Established invariants

- Two live HTTP applications use separate explicit application containers.
- Application token values, singleton reuse, transient recreation, and scoped
  reuse/separation work through the public API.
- Closing one application repeatedly does not stop the other.
- Each HTTP request disposes its resolved scoped resource.
- Registered controller routes reject trailing slashes.
- Unknown controller failures return sanitized envelopes.
- Plugin middleware is removed on unload and works after reload; registered
  cleanup runs once per unload.

## Coverage still required

The order-service reference adds real SQLite transactions and rollback,
authenticated/authorized HTTP operations, body validation, correlation logging,
health probes and interval-free metrics. See
`examples/reference-apps/order-service/README.md` for its scope and run steps.

This is not complete framework certification. HTTP/2, events, queue workers,
exporter shutdown, cancellation, general startup rollback, and resource-leak
detection remain separate conformance work.

Middleware order remains registration order. Tests use controller endpoints so
that reload is not hidden behind an earlier terminating middleware.
