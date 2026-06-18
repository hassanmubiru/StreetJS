# Requirements Document

## Introduction

This feature hardens the backend project that the StreetJS CLI's `street create`
command scaffolds, so that the generated project **boots out-of-the-box** and is
**secure-by-default**. Two outcomes define success:

- **Boots out-of-the-box**: a freshly generated project starts on first run for
  both the SQLite (zero-config) and PostgreSQL drivers without crashing — even
  when database credentials are missing or the database is unreachable.
- **Secure-by-default**: the generated application never silently runs with an
  open (wildcard) CORS policy or weak signing secrets in production; unsafe
  defaults are tolerated only in development and always surfaced with a warning,
  and are refused outright (fail loud) in production.

This document follows the StreetJS `CLAUDE.md` "8-Rule Architecture" governance:
simplicity-first, surgical changes, and fail-loud behavior. Some requirements
below describe behavior that is **already implemented and verified** and is
captured here to lock it in as expected behavior; others describe behavior that
must be (re-)implemented. The requirements are stated in terms of observable
system behavior and are independent of current implementation state.

Scope note: this spec covers only the scaffolded backend's first-run boot
behavior and its secure-by-default configuration surface (CORS, signing secrets,
database degradation, and the example-route safety comment). It does not change
the framework runtime, the frontend scaffolds, or unrelated generator output.

## Glossary

- **Scaffold_Generator**: The `street create <name>` command (implemented by
  `CreateCommand` in `packages/cli/src/commands/create.ts`) that writes a new
  project's files from embedded templates.
- **Generated_Application**: The runtime backend application produced by the
  Scaffold_Generator and started from the generated `src/main.ts` entry point.
- **SQLite_Driver**: The database driver selected with `--database sqlite`
  (the default), which requires no external database server or credentials.
- **PostgreSQL_Driver**: The database driver selected with `--database postgres`,
  intended for production use and requiring explicit credentials.
- **Items_Table**: The example database table named `items` that the
  Generated_Application uses for its example route.
- **Database_Backed_Route**: A generated HTTP route whose handler reads from or
  writes to the configured database.
- **Health_Route**: The generated HTTP route that reports application liveness
  and does not require database access.
- **CORS_Allowlist**: The ordered set of trusted origins the Generated_Application
  permits for cross-origin requests.
- **Production_Mode**: The runtime state in which the `NODE_ENV` environment
  variable is set to the value `production`.
- **JWT_SECRET**: The environment variable holding the signing secret for JSON
  Web Tokens.
- **SESSION_KEY**: The environment variable holding the key used to sign session
  data.
- **CORS_ORIGINS**: The environment variable holding a comma-separated allowlist
  of trusted cross-origin request origins.
- **ServiceUnavailableException**: The exception type exported by the `streetjs`
  package that maps to an HTTP 503 response.

## Requirements

### Requirement 1: SQLite zero-config first-run boot

**User Story:** As a developer, I want the generated SQLite project to start on
first run with no configuration, so that I can begin developing immediately.

#### Acceptance Criteria

1. WHILE the SQLite_Driver is selected, WHEN the Generated_Application starts, THE Generated_Application SHALL initialize the SQLite database without requiring any database credentials.
2. WHEN the Generated_Application initializes the SQLite database, THE Generated_Application SHALL create the Items_Table if the Items_Table does not already exist.
3. IF the `SQLITE_PATH` environment variable is unset, THEN THE Generated_Application SHALL use an in-process in-memory SQLite database.
4. WHEN the SQLite database initialization completes, THE Generated_Application SHALL emit a database-ready log message and continue startup.

### Requirement 2: Development secret generation with production fail-fast

**User Story:** As a developer, I want valid signing secrets generated
automatically in development and required explicitly in production, so that the
project runs with zero setup locally but never starts with throwaway keys in
production.

#### Acceptance Criteria

1. WHILE the Generated_Application is not in Production_Mode, WHEN JWT_SECRET is unset at startup, THE Generated_Application SHALL generate a 48-character hexadecimal value as the JWT_SECRET for the running process.
2. WHILE the Generated_Application is not in Production_Mode, WHEN SESSION_KEY is unset at startup, THE Generated_Application SHALL generate a 64-character hexadecimal value as the SESSION_KEY for the running process.
3. WHEN the Generated_Application generates an ephemeral JWT_SECRET or SESSION_KEY, THE Generated_Application SHALL emit a warning that names the affected environment variable and states that the value is ephemeral.
4. IF the Generated_Application is in Production_Mode AND JWT_SECRET is unset, THEN THE Generated_Application SHALL terminate startup before binding the HTTP port and report an error that names JWT_SECRET.
5. IF the Generated_Application is in Production_Mode AND SESSION_KEY is unset, THEN THE Generated_Application SHALL terminate startup before binding the HTTP port and report an error that names SESSION_KEY.

### Requirement 3: PostgreSQL graceful degradation on first run

**User Story:** As a developer, I want the generated PostgreSQL project to start
even when credentials are missing or the database is unreachable, so that I
receive actionable guidance instead of a crash.

#### Acceptance Criteria

1. IF the PostgreSQL_Driver is selected AND any of `PG_USER`, `PG_PASSWORD`, or `PG_DATABASE` is unset, THEN THE Generated_Application SHALL start the HTTP server and log guidance that lists each missing environment variable.
2. IF the PostgreSQL_Driver is selected AND the database connection attempt fails, THEN THE Generated_Application SHALL start the HTTP server and log the connection error together with remediation guidance.
3. WHILE the PostgreSQL connection is unavailable, WHEN a request targets a Database_Backed_Route, THE Generated_Application SHALL respond with HTTP status 503.
4. WHILE the PostgreSQL connection is unavailable, WHEN the Generated_Application responds to a Database_Backed_Route, THE Generated_Application SHALL signal the unavailability using the ServiceUnavailableException type from the `streetjs` package.
5. WHILE the PostgreSQL connection is unavailable, WHEN a request targets the Health_Route, THE Generated_Application SHALL respond with HTTP status 200.

### Requirement 4: Configurable, secure-by-default CORS

**User Story:** As an operator, I want cross-origin access controlled by an
explicit allowlist, so that the deployed API rejects untrusted origins and never
silently accepts requests from any website.

#### Acceptance Criteria

1. WHEN CORS_ORIGINS is set to a non-empty value, THE Generated_Application SHALL build the CORS_Allowlist from the comma-separated origins in CORS_ORIGINS.
2. WHEN the Generated_Application builds the CORS_Allowlist from CORS_ORIGINS, THE Generated_Application SHALL trim surrounding whitespace from each origin and exclude empty entries.
3. THE Generated_Application SHALL apply the CORS_Allowlist as the active CORS policy for all incoming HTTP requests.
4. WHILE the Generated_Application is not in Production_Mode, WHEN CORS_ORIGINS is unset or contains no non-empty origins, THE Generated_Application SHALL set the CORS_Allowlist to allow all origins and emit a warning that wildcard CORS is enabled for development only.
5. IF the Generated_Application is in Production_Mode AND CORS_ORIGINS is unset or contains no non-empty origins, THEN THE Generated_Application SHALL terminate startup before binding the HTTP port and report an error that CORS_ORIGINS is required.

### Requirement 5: CORS configuration documented in generated environment templates

**User Story:** As a developer, I want CORS_ORIGINS documented in the generated
environment and container templates, so that I know how to configure it for each
deployment target.

#### Acceptance Criteria

1. WHEN the Scaffold_Generator generates a project using the SQLite_Driver, THE Scaffold_Generator SHALL include a CORS_ORIGINS entry in the generated `.env.example` file.
2. WHEN the Scaffold_Generator generates a project using the PostgreSQL_Driver, THE Scaffold_Generator SHALL include a CORS_ORIGINS entry in the generated `.env.example` file.
3. WHERE the generated `docker-compose.yml` defines an application service, THE Scaffold_Generator SHALL include CORS_ORIGINS in that service's environment block.
4. WHEN the Scaffold_Generator writes a CORS_ORIGINS entry, THE Scaffold_Generator SHALL accompany the entry with a comment that describes the development wildcard behavior and the Production_Mode requirement.

### Requirement 6: Example routes documented as unauthenticated

**User Story:** As a developer, I want a clear warning that the generated example
routes are unauthenticated, so that I protect them before exposing the
application publicly.

#### Acceptance Criteria

1. WHEN the Scaffold_Generator generates the example route controller, THE Scaffold_Generator SHALL include a code comment stating that the example routes are unauthenticated.
2. WHEN the Scaffold_Generator generates the example route controller, THE Scaffold_Generator SHALL include a code comment advising that the example routes be protected before public exposure.
