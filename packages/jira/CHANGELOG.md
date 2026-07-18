# Changelog

All notable changes to `@streetjs/jira` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Initial release of the StreetJS Jira connector.
- `JiraClient extends HttpConnector` (`@streetjs/integrations`) with typed
  methods: `getIssue`, `createIssue`, `addComment`, `getTransitions`,
  `transitionIssue`, `assignIssue`, `searchJql`.
- HTTP Basic auth (email + API token) against the Jira Cloud REST API v3.
- `textToAdf` — plain-text → Atlassian Document Format conversion, applied
  automatically to descriptions and comments.
- `verifyJiraWebhook` — constant-time HMAC-SHA256 verification of signed inbound
  webhooks (with an optional signature prefix).
- Injectable `fetch` for fully offline unit tests; 8 tests, 100% line coverage.
- README, ARCHITECTURE, runnable example, and MIT LICENSE.
