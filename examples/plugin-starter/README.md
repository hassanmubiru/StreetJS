# StreetJS Plugin Starter

A minimal, dependency-free StreetJS plugin template. Pairs with the
[plugin author guide](../../docs/plugin-authoring.md).

## Use this template

1. Copy this directory out of the StreetJS repo and rename it.
2. In `package.json`: set a unique `name`, remove `"private": true`, and adjust
   `version`.
3. Replace the middleware/lifecycle logic in `src/index.ts` and the metadata in
   `manifest.json` (`capabilities`, `permissions` — request the least you need).

## Develop

```bash
npm install          # brings in streetjs (peer dependency) + typescript
npm run build        # tsc → dist/
npm test             # offline contract test
node example/index.mjs
```

## Publish

```bash
npm publish --provenance --access public
# or via the Network Plugin Registry:  street registry publish
```

Before publishing, `npm pack --dry-run` should list your `dist/**` modules and
`manifest.json`, with **zero** `*.test.*` files. Sign the manifest in a
release-only step (never with an ephemeral key) — see the author guide and
[RFC 0005](../../rfcs/0005-keyless-signing.md) for the signing roadmap.

## Layout

| Path | Purpose |
|------|---------|
| `src/index.ts` | The `PluginModule` subclass (default export). |
| `manifest.json` | Identity + capabilities/permissions. |
| `test/contract.test.mjs` | Offline contract test. |
| `example/index.mjs` | Runnable usage example. |
| `package.json` | Note the `files` allowlist (ships `dist/**`, excludes tests). |
