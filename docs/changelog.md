---
layout:    default
title:     "Changelog"
nav_order: 17
permalink: /changelog/
description: "Street Framework changelog — release history for @streetjs/core and @streetjs/cli."
---

# Changelog

All notable changes to Street Framework are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Full changelog: [CHANGELOG.md on GitHub](https://github.com/hassanmubiru/blob/main/CHANGELOG.md)

---

## @streetjs/core@1.0.5 · @streetjs/cli@1.0.3 — 2026-05-30

### Added

- **README.md** for both npm packages — `@streetjs/core` and `@streetjs/cli` now display full documentation on their npm package pages
- **`packages/core/README.md`** — covers install, quick start, tsconfig requirements, all modules (HTTP, router, DI, PostgreSQL, security, WebSocket, SSE, cache, telemetry, cluster, multipart, webhook, OpenAPI), all subpath exports, and environment variables
- **`packages/cli/README.md`** — covers install, all 9 CLI commands with full examples, generated project structure, Docker usage, and all generated project scripts

---

## @streetjs/cli@1.0.2 — 2026-05-30

### Fixed

- **`street generate repository` log message** — success message printed `src/repositorys/` (naive `type + 's'`) instead of `src/repositories/`. Fixed by routing through the existing `toPlural()` helper which correctly handles the `y → ies` rule. The generated file path was always correct — only the console output was wrong.

---

## @streetjs/core@1.0.4 · @streetjs/cli@1.0.1 — 2026-05-29

### Fixed

**@streetjs/core — publish artifact pollution (critical)**
- `"files"` array replaced the wildcard `"dist/**/*.js"` with explicit per-subdirectory globs. The wildcard was matching `dist/src/**` (stale artifact) and `dist/tests/**` (all test files), shipping ~600 kB of unwanted code. Published package is now 73.9 kB / 113 files (down from 205.8 kB / 305 files).

**@streetjs/cli — publish artifact pollution (critical)**
- `"files"` array replaced `"dist/**/*.js"` with explicit paths to prevent `dist/tests/*.js` from being published. Package is now 24.5 kB / 43 files (down from 29.5 kB / 49 files).
- Source maps (`dist/**/*.js.map`) are now correctly included.

**@streetjs/cli — generated project structure**
- `street create <name>` now generates `tests/` at the project root instead of `src/tests/`
- `migrations/` directory now includes a `.gitkeep`
- `README.md` template updated to show the correct project tree

**@streetjs/cli — version test**
- `VERSION_OUTPUT` constant now reads the version dynamically from `package.json` instead of being hardcoded

### Changed

**CI/CD**
- `test-and-publish` job now publishes both `@streetjs/core` and `@streetjs/cli`
- Added pack validation steps and scaffolding smoke test before publish

**Release tooling**
- Added `scripts/release.sh` — interactive release script
- Added `scripts/validate-publish.sh` — 44-check pre-publish validator
- Added `scripts/post-publish-verify.sh` — post-publish end-to-end verification

---

## @streetjs/core@1.0.3 — 2026-05-28

### Fixed

- CI publish workflow robustness — split combined test step into separate per-suite steps

---

## @streetjs/core@1.0.2 — 2026-05-28

### Fixed

- **Critical: empty package fix** — corrected `"files"` pattern from `dist/src/**/*.js` → `dist/**/*.js`
- Updated all 20+ `"exports"` subpath mappings to remove spurious `src/` segment

### Added

- Full SCRAM-SHA-256 PostgreSQL authentication
- SQL injection prevention via parameterized queries throughout
- Comprehensive system tests (fuzz, load, chaos, security, memory-safety, infrastructure)
- Docker Compose for local development
- GitHub Actions CI/CD workflows
- Dependabot configuration

---

## @streetjs/core@1.0.0 — 2024-01-15

### Added

Initial release including:

- IoC container with constructor injection
- HTTP server and router
- PostgreSQL wire protocol v3 client
- Connection pool
- Repository pattern
- Migration runner
- JWT, sessions, vault mode
- Rate limiter, XSS sanitizer, security headers, CORS
- WebSocket server, SSE
- LRU cache, telemetry, cluster coordinator
- Webhook dispatcher
- OpenAPI 3.1 spec generation
- CLI kernel with `@Command` decorator
