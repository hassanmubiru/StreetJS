# Changelog

All notable changes to `@streetjs/github` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Initial release of the StreetJS GitHub connector.
- `GitHubClient extends HttpConnector` (`@streetjs/integrations`) with typed
  methods: `getRepo`, `listIssues`, `createIssue`, `updateIssue`,
  `commentOnIssue`, `createPullRequest`, `createRelease`, `repositoryDispatch`,
  `dispatchWorkflow`.
- Bearer-token auth, `X-GitHub-Api-Version` header, and GitHub Enterprise
  support via a configurable `baseUrl`.
- `verifyGitHubWebhook` — constant-time HMAC-SHA256 verification of inbound
  `X-Hub-Signature-256` webhook signatures (legacy `sha1=` rejected).
- Injectable `fetch` for fully offline unit tests; 11 tests, 100% line coverage.
- README, ARCHITECTURE, runnable example, and MIT LICENSE.
