# Changelog

All notable changes to `@streetjs/gitlab` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Initial release of the StreetJS GitLab connector.
- `GitLabClient extends HttpConnector` (`@streetjs/integrations`) with typed
  methods: `getProject`, `listIssues`, `createIssue`, `createIssueNote`,
  `createMergeRequest`, `triggerPipeline`.
- `PRIVATE-TOKEN` header auth (default) or OAuth `bearer`; self-managed GitLab
  support via a configurable `baseUrl`; projects addressable by id or path.
- `verifyGitLabWebhook` — constant-time comparison of the inbound
  `X-Gitlab-Token` header against the configured secret.
- Injectable `fetch` for fully offline unit tests; 8 tests, 100% line coverage.
- README, ARCHITECTURE, runnable example, and MIT LICENSE.
