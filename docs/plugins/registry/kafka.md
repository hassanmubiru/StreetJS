---
layout:      default
title:       "@streetjs/plugin-kafka"
permalink:   /plugins/kafka/
nav_exclude: true
description:  "Official StreetJS plugin: Apache Kafka streaming (wraps the dependency-free core Kafka client). Official, signed, dependency-free StreetJS plugin — install from npm."
---

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareSourceCode","name":"@streetjs/plugin-kafka","description":"Official StreetJS plugin: Apache Kafka streaming (wraps the dependency-free core Kafka client).","codeRepository":"https://github.com/hassanmubiru/StreetJS","programmingLanguage":"TypeScript","runtimePlatform":"Node.js >= 22","softwareVersion":"1.0.2","license":"https://opensource.org/licenses/MIT","isPartOf":{"@type":"SoftwareApplication","name":"StreetJS","applicationCategory":"DeveloperApplication"}}
</script>
# @streetjs/plugin-kafka

**Official StreetJS plugin: Apache Kafka streaming (wraps the dependency-free core Kafka client).**

- **Category:** [Messaging](/StreetJS/plugins/category/messaging/)
- **Tier:** Official · **Signed** · **Dependency-free**
- **Version:** `v1.0.2`
- **Runtime dependencies:** none (third-party) — only `streetjs`
- **npm:** [@streetjs/plugin-kafka](https://www.npmjs.com/package/@streetjs/plugin-kafka)
- **Source:** [packages/plugin-kafka](https://github.com/hassanmubiru/StreetJS/tree/main/packages/plugin-kafka)
- **Maintainer:** street contributors (StreetJS core team)

## Trust signals

- ✅ **Signed manifest** (Ed25519) — `manifest.signed.json` is committed and verified by the plugin host on load
- ✅ **Dependency-free** — no third-party runtime dependencies (only the `streetjs` framework)
- ✅ **MIT licensed** · **Node.js ≥ 20** · **TypeScript-native**
- ✅ **npm provenance** — official plugins are published with build attestations (enforced in CI)

## Install

```bash
npm install @streetjs/plugin-kafka
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

- [@streetjs/plugin-nats](/StreetJS/plugins/nats/) — Official StreetJS plugin: NATS publish/subscribe messaging (dependency-free protocol client).
- [@streetjs/plugin-rabbitmq](/StreetJS/plugins/rabbitmq/) — Official StreetJS plugin: RabbitMQ messaging (wraps the dependency-free core AMQP 0-9-1 transport).
- [@streetjs/plugin-sendgrid](/StreetJS/plugins/sendgrid/) — Official Street Framework plugin: SendGrid email.
- [@streetjs/plugin-twilio](/StreetJS/plugins/twilio/) — Official Street Framework plugin: Twilio SMS.

Browse the full [Plugin Marketplace](/StreetJS/plugins/marketplace/) or all [Messaging](/StreetJS/plugins/category/messaging/) plugins.
