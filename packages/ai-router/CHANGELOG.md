# Changelog

All notable changes to `@streetjs/ai-router` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial release of the StreetJS AI router.
- `ModelRegistry` — model metadata (provider, capabilities, cost, context
  window) with `get`/`providerFor`/`list(capability)`/`cheapest(capability)`.
- `AiRouter` — an `@streetjs/ai` `AiProvider` that routes `chat`/`embed`/
  `transcribe` by pinned model, `ordered` or `cheapest` strategy, with automatic
  fallback and an `AiRoutingError` (carrying causes) when all providers fail.
  `transcribe` skips providers that don't implement it.
- Depends only on `@streetjs/ai`; ESM. 13 tests, 100% line coverage, and a
  runnable offline example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/ai-router-v1.0.0
