# Changelog

All notable changes to `@streetjs/teams` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Initial release of the StreetJS Microsoft Teams connector.
- `TeamsClient extends HttpConnector` (`@streetjs/integrations`) — a Microsoft
  Graph client with `getTeam`, `listChannels`, `sendChannelMessage`,
  `sendChatMessage`.
- `sendIncomingWebhook` — post a MessageCard / Adaptive Card to a Teams Incoming
  Webhook URL, with an injectable `fetch`.
- `verifyTeamsOutgoingWebhook` / `computeTeamsSignature` — constant-time
  validation of the `Authorization: HMAC <base64>` signature Teams sends to
  outgoing-webhook endpoints (base64 key + digest).
- Injectable `fetch` for fully offline unit tests; 10 tests, 100% line coverage.
- README, ARCHITECTURE, runnable example, and MIT LICENSE.
