# Changelog

All notable changes to `@streetjs/slack` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial release of the StreetJS Slack connector, built on
  `@streetjs/integrations`.
- `SlackClient` — typed Slack Web API client (`postMessage` incl. ephemeral/
  thread/Block Kit, `updateMessage`, `deleteMessage`, `addReaction`,
  `listConversations`, and a generic `call(method, body)`), unwrapping Slack's
  `{ ok, error }` envelope into thrown `IntegrationError`s.
- `verifySlackRequest` — Slack `v0` request-signature verification with a
  timestamp replay guard and an injectable clock.
- Injectable fetch for network-free testing; ESM. 11 tests, 100% coverage, and a
  runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/slack-v1.0.0
