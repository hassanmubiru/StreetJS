# Dating App — StreetJS reference application

A dating backend built on `@streetjs/dating-profiles`:

- `ProfileService` — profiles, likes, and **reciprocal matching**
- **Bios encrypted at rest** via the core `FieldCipher` + `Keyring` (field-level
  AES encryption — sensitive text is never stored in plaintext)
- HTTP health endpoints

This is a *reference app*: a runnable, tested starting point you adapt — not an
npm package.

## Run

```bash
# from the repo root (resolves the local `streetjs` build)
npm run build -w packages/core
node examples/reference-apps/dating/server.mjs        # starts on :3000
```

HTTP endpoints:

- `GET /health/live`, `GET /health/ready` — liveness/readiness

The domain is driven through the exported `createDating({ cipher })` factory,
which returns `{ profiles, http, listen, close }`. Use `profiles` to create
encrypted profiles, record likes, and compute reciprocal matches in code/tests.
(The HTTP surface here is intentionally minimal — add your own authenticated
routes over `profiles` for a real app.)

## Verification (executed)

```bash
node examples/reference-apps/dating/smoke-test.mjs    # checks pass, exit non-zero on failure
```

Smoke covers encrypted-bio round-trip and reciprocal matching. Covered by CI in
`.github/workflows/reference-apps.yml`; the like/match op is MEASURED in
`scripts/benchmark-reference-apps.mjs` (relative, in-memory single-instance).

## Security & privacy configuration

- Bios are encrypted with `FieldCipher` (`Keyring`); the demo generates an
  ephemeral key with `randomBytes(32)`. **In production, load a persistent key
  from your secret store** (rotating it via the keyring) so encrypted data
  survives restarts and supports rotation.
- This app handles sensitive personal data — add authentication, authorization,
  consent/retention controls (`docs/compliance/`), and rate limiting before any
  real deployment. Do not store real PII in a public demo.
- In production set `ALLOWED_ORIGINS`, `JWT_SECRET`, `SESSION_KEY`, `KEK`, `PG_*`.

## Deployment

Reuses the repo's deployment artifacts (`deploy/`): Docker, Kubernetes
(`deploy/helm/street`), or Cloud Run (`deploy/cloud-run/service.yaml`). Probes hit
`/health/live` and `/health/ready`. Validate with `scripts/deploy/smoke-test.sh`.

## Scaling notes

Persist profiles/likes/matches in PostgreSQL (repository pattern) with the
encrypted-field columns; keep the encryption keyring in a managed secret store.
