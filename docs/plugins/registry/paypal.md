---
layout:      default
title:       "@streetjs/plugin-paypal"
permalink:   /plugins/paypal/
nav_exclude: true
description:  "Official StreetJS plugin: PayPal Orders v2 (dependency-free HTTPS client). Official, signed, dependency-free StreetJS plugin — install from npm."
---

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareSourceCode","name":"@streetjs/plugin-paypal","description":"Official StreetJS plugin: PayPal Orders v2 (dependency-free HTTPS client).","codeRepository":"https://github.com/hassanmubiru/StreetJS","programmingLanguage":"TypeScript","runtimePlatform":"Node.js >= 22","softwareVersion":"1.0.2","license":"https://opensource.org/licenses/MIT","isPartOf":{"@type":"SoftwareApplication","name":"StreetJS","applicationCategory":"DeveloperApplication"}}
</script>
# @streetjs/plugin-paypal

**Official StreetJS plugin: PayPal Orders v2 (dependency-free HTTPS client).**

- **Category:** [Payments](/StreetJS/plugins/category/payments/)
- **Tier:** Official · **Signed** · **Dependency-free**
- **Version:** `v1.0.2`
- **Runtime dependencies:** none (third-party) — only `streetjs`
- **npm:** [@streetjs/plugin-paypal](https://www.npmjs.com/package/@streetjs/plugin-paypal)
- **Source:** [packages/plugin-paypal](https://github.com/hassanmubiru/StreetJS/tree/main/packages/plugin-paypal)
- **Maintainer:** street contributors (StreetJS core team)

## Trust signals

- ✅ **Signed manifest** (Ed25519) — `manifest.signed.json` is committed and verified by the plugin host on load
- ✅ **Dependency-free** — no third-party runtime dependencies (only the `streetjs` framework)
- ✅ **MIT licensed** · **Node.js ≥ 20** · **TypeScript-native**
- ✅ **npm provenance** — official plugins are published with build attestations (enforced in CI)

## Install

```bash
npm install @streetjs/plugin-paypal
```

## Quick start

Register the plugin with the StreetJS plugin host, then use it from your
controllers/services. See the package README on npm for the full configuration
and API, and the [Plugin System](/StreetJS/plugins/) guide for registration,
capabilities and signature verification.

## Compatibility

| | |
|---|---|
| StreetJS | `^1.0.6` |
| Node.js | `>=20.0.0` |
| TypeScript | `>=5.0.0` (NodeNext) |

Derived from this package's `dependencies.streetjs`, `engines.node`, and
`peerDependencies.typescript`. See the [compatibility matrix](/StreetJS/compatibility/) for the full support grid.

## Certification

This is an **Official** plugin — maintained by the StreetJS team in the monorepo,
CI-tested, and published with a signed manifest. See the
[plugin certification levels](/StreetJS/ecosystem/plugin-certification/).

## Related plugins

- [@streetjs/plugin-marzpay](/StreetJS/plugins/marzpay/) — Official StreetJS plugin: MarzPay payments (dependency-free HTTPS client).
- [@streetjs/plugin-stripe](/StreetJS/plugins/stripe/) — Official Street Framework plugin: Stripe payments.

Browse the full [Plugin Marketplace](/StreetJS/plugins/marketplace/) or all [Payments](/StreetJS/plugins/category/payments/) plugins.
