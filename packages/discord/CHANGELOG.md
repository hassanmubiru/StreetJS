# Changelog

All notable changes to `@streetjs/discord` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Initial release of the StreetJS Discord connector.
- `DiscordClient extends HttpConnector` (`@streetjs/integrations`) with typed
  methods: `getChannel`, `createMessage`, `editMessage`, `deleteMessage`,
  `createReaction`, `executeWebhook`.
- Bot-token auth (`Authorization: Bot <token>`).
- `verifyDiscordInteraction` — Ed25519 verification of inbound interaction
  requests (`X-Signature-Ed25519` / `X-Signature-Timestamp`) via `node:crypto`,
  plus the `ed25519PublicKeyFromHex` helper.
- Injectable `fetch` and in-process keypair tests for fully offline coverage;
  8 tests, 100% line coverage.
- README, ARCHITECTURE, runnable example, and MIT LICENSE.
