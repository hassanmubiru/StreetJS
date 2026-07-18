# Changelog

All notable changes to `@streetjs/integrations` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial release of the StreetJS integration foundation.
- `HttpConnector` — base client with injectable fetch, bearer/header/none auth,
  query building, JSON (de)serialization, normalized errors, and idempotent
  retry/backoff.
- Webhook verification primitives: `verifyHmacSignature`, `hmacHex`,
  `timingSafeCompare`.
- Typed errors (`IntegrationError`, `IntegrationRequestError`,
  `WebhookVerificationError`) and a `ConnectorInfo` descriptor.
- Zero runtime dependencies (Node core only); ESM. 11 tests, ≥99% line coverage,
  and a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/integrations-v1.0.0
