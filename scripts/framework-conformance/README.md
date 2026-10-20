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

This initial slice is not a complete framework certification. It does not yet
prove configuration validation, HTTP/2, database transactions, events, queue
workers, observability shutdown, cancellation, startup rollback, resource-leak
detection, or a realistic golden-path reference application. Existing reference
applications must be reviewed before selecting or extending one for that role.

Middleware order remains registration order. Tests use controller endpoints so
that reload is not hidden behind an earlier terminating middleware.
