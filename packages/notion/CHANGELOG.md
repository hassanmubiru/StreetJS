# Changelog

All notable changes to `@streetjs/notion` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Initial release of the StreetJS Notion connector.
- `NotionClient extends HttpConnector` (`@streetjs/integrations`) with typed
  methods: `retrievePage`, `createPage`, `updatePage`, `retrieveDatabase`,
  `queryDatabase`, `appendBlockChildren`, `search`.
- Bearer-token auth and the required `Notion-Version` header (configurable).
- `verifyNotionWebhook` — constant-time HMAC-SHA256 verification of the inbound
  `X-Notion-Signature` header (`sha256=` prefix).
- Injectable `fetch` for fully offline unit tests; 7 tests, 100% line coverage.
- README, ARCHITECTURE, runnable example, and MIT LICENSE.
