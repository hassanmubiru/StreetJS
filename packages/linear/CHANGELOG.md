# Changelog

All notable changes to `@streetjs/linear` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Initial release of the StreetJS Linear connector.
- `LinearClient extends HttpConnector` (`@streetjs/integrations`) with a generic
  `query` method plus typed helpers: `viewer`, `getIssue`, `createIssue`,
  `createComment`.
- API-key (raw `Authorization`) auth by default, or OAuth `bearer`.
- GraphQL `errors` / missing-`data` / `success=false` responses are unwrapped
  into thrown errors.
- `verifyLinearWebhook` — constant-time HMAC-SHA256 verification of the inbound
  `Linear-Signature` header.
- Injectable `fetch` for fully offline unit tests; 10 tests, 100% line coverage.
- README, ARCHITECTURE, runnable example, and MIT LICENSE.
