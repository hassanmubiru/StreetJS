# Changelog

All notable changes to `@streetjs/notifications` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial release of the StreetJS unified notification layer.
- `Notifier` — channel-agnostic dispatch with template rendering, preference
  gating, multi-recipient fan-out, resilient per-delivery error capture, an
  `onResult` observer, and one `DeliveryResult` per recipient × channel.
- `NotificationChannel` contract + built-in `MemoryChannel` and `FunctionChannel`.
- `renderTemplate` (`{{ var }}` / dotted paths) + `InMemoryTemplateStore`.
- `PreferenceStore` contract + `InMemoryPreferenceStore` (channel/category opt-out,
  mandatory categories) and `AllowAllPreferences`.
- `NotificationError` for configuration errors (unknown template, no channels).
- Zero runtime dependencies; ESM; `browser` export condition. 15 tests, 100% line
  coverage, and a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/notifications-v1.0.0
