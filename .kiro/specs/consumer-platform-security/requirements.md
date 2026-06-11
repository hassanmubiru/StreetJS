# Requirements Document

## Introduction

This spec defines a roadmap-level upgrade to the Street Framework so it can safely support high-risk consumer applications such as dating apps, social networks, messaging products, creator platforms, and marketplaces. The upgrade is organized as ten phases delivered under a single "Zero-Trust Certification Standard": no feature is considered complete until it has source implementation, public exports, documentation, automated tests, a passing build, green existing test suites, and recorded command evidence of those facts.

The framework is an existing TypeScript monorepo. Core lives at `packages/core/src` and already contains a security module (`packages/core/src/security/`) with `headers.ts`, `ratelimit.ts`, `vault.ts`, `jwt.ts`, `session.ts`, `mtls.ts`, `xss.ts`, and `dast.ts`. A multipart parser exists at `packages/core/src/multipart/parser.ts`. Several phases (rate limiting, security headers, secrets/vault) therefore have partial implementations that this work MUST assess and extend rather than rebuild. The dating reference packages in Phase 10 are new packages under `packages/`.

This spec is complementary to the existing `platform-leadership-gaps` and `street-framework-roadmap` specs and does not supersede them.

Each phase below is expressed at the requirements level with EARS acceptance criteria that are concrete and testable, so that property-based and example-based tests can be derived during design and task execution. Per the Zero-Trust Certification Standard, VERIFIED status and scorecards are produced during task execution from real executed-command evidence; they are never asserted in this document.

## Glossary

- **Street_Framework**: The TypeScript monorepo and its published packages, rooted at `packages/`.
- **Core_Package**: The `@streetjs/core` package located at `packages/core`.
- **Security_Module**: The existing directory `packages/core/src/security/` and any modules added to it by this spec.
- **External_Input**: Any data originating outside the application process: HTTP request body, query string, route parameters, headers, cookies, environment variables, and CLI arguments.
- **Validator**: The runtime input-validation subsystem introduced in Phase 1.
- **Validation_Schema**: A Zod schema supplied by an application to describe the expected shape of an External_Input.
- **ValidationError**: The error type produced by the Validator when an External_Input fails its Validation_Schema.
- **Rate_Limiter**: The rate-limiting subsystem (extending the existing `ratelimit.ts`).
- **Security_Headers_Middleware**: The middleware that applies HTTP security response headers (extending the existing `headers.ts`).
- **Upload_Guard**: The media upload security subsystem introduced in Phase 4.
- **Magic_Byte_Signature**: The leading bytes of a file that identify its true format independent of declared MIME type or filename extension.
- **EncryptedField**: The `EncryptedField<T>` type and supporting subsystem for field-level encryption introduced in Phase 5.
- **Data_Encryption_Key (DEK)**: A per-record or per-field symmetric key used to encrypt field values.
- **Key_Encryption_Key (KEK)**: A long-lived key used to encrypt Data_Encryption_Keys under envelope encryption.
- **Abuse_Engine**: The abuse-prevention subsystem introduced in Phase 6.
- **Account_Lockout**: A state in which authentication attempts for a specific account are refused for a defined duration.
- **Moderation_Toolkit**: The reporting, blocking, muting, queue, and audit subsystem introduced in Phase 7.
- **Audit_Event**: An immutable, timestamped record describing a moderation or privacy action.
- **SecretProvider**: The interface and adapters that retrieve secrets from external secret stores, introduced in Phase 8.
- **Privacy_Controls**: The account deletion, data export, retention, and consent subsystem introduced in Phase 9.
- **Dating_Reference_Module**: The set of new packages `@streetjs/dating-auth`, `@streetjs/dating-profiles`, `@streetjs/dating-messaging`, and `@streetjs/dating-moderation` introduced in Phase 10.
- **Zero_Trust_Standard**: The certification standard defining when any feature in this spec is VERIFIED.
- **Certification_Report**: The final scorecard deliverable summarizing VERIFIED status across all defined categories.
- **VERIFIED**: The status assigned to a feature only when every Zero_Trust_Standard condition is satisfied and evidenced by executed-command output.

## Requirements

### Requirement 1: Zero-Trust Certification Standard (Definition of Done)

**User Story:** As a framework maintainer, I want a single explicit certification standard that defines when any feature is complete, so that consumer-platform features cannot be declared done without verifiable evidence.

#### Acceptance Criteria

1. THE Zero_Trust_Standard SHALL define a feature as VERIFIED only WHEN all of the following exist: source implementation, public package exports, written documentation, automated tests, a passing build, passing pre-existing test suites, and recorded executed-command evidence.
2. WHERE a feature is missing any one of the Zero_Trust_Standard conditions, THE Zero_Trust_Standard SHALL classify that feature as NOT VERIFIED.
3. THE Zero_Trust_Standard SHALL require that VERIFIED status be derived from executed-command output captured during task execution rather than asserted in specification documents.
4. WHEN a feature is reported as VERIFIED, THE Zero_Trust_Standard SHALL require an associated reference to the command and its output that demonstrates each satisfied condition.
5. THE Zero_Trust_Standard SHALL apply uniformly to every phase defined in Requirements 2 through 11.

### Requirement 2: Runtime Input Validation (Phase 1)

**User Story:** As an application developer, I want every external input validated at runtime against a schema, so that malformed or malicious input is rejected before it reaches business logic.

#### Acceptance Criteria

1. THE Validator SHALL accept a Validation_Schema for each of the following External_Input sources independently: request body, query string, route parameters, headers, and cookies.
2. WHEN a route declares a Validation_Schema for an External_Input source and an incoming request supplies a value that conforms to that schema, THE Validator SHALL pass the parsed and typed value to the route handler.
3. IF an incoming request supplies a value that does not conform to its declared Validation_Schema, THEN THE Validator SHALL reject the request with HTTP status 400 before the route handler begins execution, so that the route handler does not run at all.
4. WHEN the Validator rejects an External_Input, THE Validator SHALL produce a ValidationError whose serialized form lists each failing field path and the reason for failure.
5. THE Validator SHALL format ValidationError responses so that the response body excludes raw stack traces and internal type information.
6. WHEN a route handler receives a value validated by the Validator, THE Core_Package SHALL infer the handler parameter type from the Validation_Schema.
7. THE Validator SHALL validate declared environment variables and CLI arguments against a Validation_Schema at process startup.
8. IF a declared environment variable or CLI argument fails its Validation_Schema at startup, THEN THE Core_Package SHALL terminate startup with a non-zero exit code and SHALL emit the failing variable name without emitting the variable value.
9. FOR ALL values that conform to a Validation_Schema, validating the value SHALL return a value structurally equal to the schema-parsed value across repeated validations of the same input.

### Requirement 3: Global Rate Limiting (Phase 2)

**User Story:** As a platform operator, I want configurable global, per-IP, and per-user rate limits, so that abusive traffic and bursts are throttled before they degrade service.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL extend the existing `packages/core/src/security/ratelimit.ts` implementation rather than replace it.
2. THE Rate_Limiter SHALL support a global limiter, a per-IP limiter, and a per-user limiter, each configured by a maximum request count and a time window.
3. WHEN the number of requests counted for a given key within the configured sliding window reaches the configured maximum, THE Rate_Limiter SHALL reject further requests for that key with HTTP status 429.
4. WHEN the Rate_Limiter rejects a request with status 429, THE Rate_Limiter SHALL include a `Retry-After` response header expressing the number of seconds until the key is permitted again.
5. WHILE the count for a key is below the configured maximum within the window, THE Rate_Limiter SHALL permit the request and SHALL include the remaining allowance in a response header.
6. THE Rate_Limiter SHALL compute request counts using a sliding-window algorithm over the configured time window.
7. THE Rate_Limiter SHALL expose a configuration interface equivalent to `rateLimit({ requests: 100, window: "1m" })`, accepting a human-readable window duration.
8. THE Rate_Limiter SHALL provide a backing-store abstraction that supports a shared external store so that counts can be enforced consistently across multiple application instances.
9. THE Rate_Limiter SHALL include a reproducible benchmark that measures throughput and per-request overhead under load.

### Requirement 4: Security Headers (Phase 3)

**User Story:** As a security-conscious developer, I want secure HTTP response headers applied by default, so that browsers enforce strong protections without manual configuration.

#### Acceptance Criteria

1. THE Security_Headers_Middleware SHALL extend the existing `packages/core/src/security/headers.ts` implementation rather than replace it.
2. THE Security_Headers_Middleware SHALL apply, by default on every HTTP response, the following headers: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.
3. THE Security_Headers_Middleware SHALL set production-safe default values for each header that restrict content sources to the same origin and deny framing.
4. WHERE an application supplies a header configuration, THE Security_Headers_Middleware SHALL apply the supplied value in place of the corresponding default.
5. WHERE an application explicitly disables an individual header, THE Security_Headers_Middleware SHALL omit that header from the response.
6. FOR ALL responses produced with default configuration, the set of security header names present SHALL be identical regardless of route or response body.

### Requirement 5: Media Upload Security (Phase 4)

**User Story:** As a developer accepting user uploads, I want uploads validated for size, type, and authenticity, so that malicious or oversized files are rejected.

#### Acceptance Criteria

1. THE Upload_Guard SHALL build on the existing `packages/core/src/multipart/parser.ts` rather than introduce a separate upload parser.
2. IF an uploaded file exceeds the configured maximum size, THEN THE Upload_Guard SHALL reject the upload with HTTP status 413 and SHALL NOT persist the file.
3. WHEN an uploaded file is received, THE Upload_Guard SHALL determine the file's true format from its Magic_Byte_Signature.
4. IF the Magic_Byte_Signature of an uploaded file does not match the file's declared MIME type, THEN THE Upload_Guard SHALL reject the upload with HTTP status 415.
5. WHERE image-only mode is enabled, IF an uploaded file's Magic_Byte_Signature is not an allowed image format, THEN THE Upload_Guard SHALL reject the upload with HTTP status 415.
6. WHEN an image upload is accepted in EXIF-stripping mode, THE Upload_Guard SHALL produce a stored image whose output contains no EXIF metadata segments.
7. THE Upload_Guard SHALL invoke a configured malware-scan hook for each accepted upload before the upload is persisted.
8. IF the configured malware-scan hook reports an uploaded file as malicious, THEN THE Upload_Guard SHALL reject the upload and SHALL NOT persist the file.
9. WHEN the Upload_Guard accepts a file, THE Upload_Guard SHALL generate a stored filename that excludes path separators and the client-supplied filename.

### Requirement 6: Field-Level Encryption (Phase 5)

**User Story:** As a developer storing sensitive personal data, I want field-level encryption for selected fields, so that messages, contact details, and private notes are protected at rest.

#### Acceptance Criteria

1. THE EncryptedField SHALL provide an `EncryptedField<T>` type usable for message content, phone numbers, addresses, private notes, and profile metadata.
2. WHEN a value is assigned to an EncryptedField and persisted, THE EncryptedField SHALL store the value as AES-256-GCM ciphertext rather than plaintext.
3. WHEN an EncryptedField value is read by an authorized caller, THE EncryptedField SHALL return plaintext equal to the value originally assigned.
4. FOR ALL supported plaintext values, decrypting the result of encrypting a value under a given key SHALL produce a value equal to the original plaintext (round-trip property).
5. THE EncryptedField SHALL use envelope encryption in which each Data_Encryption_Key is encrypted under a Key_Encryption_Key.
6. WHEN a Key_Encryption_Key is rotated, THE EncryptedField SHALL continue to decrypt values that were encrypted under a previous Key_Encryption_Key.
7. IF ciphertext or its authentication tag has been altered, THEN the EncryptedField SHALL fail decryption with an error and SHALL NOT return plaintext.

### Requirement 7: Abuse Prevention (Phase 6)

**User Story:** As a platform operator, I want login and signup abuse controls, so that credential attacks and automated abuse are detected and blocked.

#### Acceptance Criteria

1. WHEN the number of failed login attempts for an account reaches the configured threshold within the configured window, THE Abuse_Engine SHALL place the account into Account_Lockout for the configured duration.
2. WHILE an account is in Account_Lockout, THE Abuse_Engine SHALL refuse authentication attempts for that account and SHALL return a response indicating the lockout.
3. WHEN the number of signup attempts from a single source reaches the configured threshold within the configured window, THE Abuse_Engine SHALL throttle further signup attempts from that source.
4. WHEN repeated failed logins across multiple accounts originate from a single source within the configured window, THE Abuse_Engine SHALL classify the activity as a password-spray pattern.
5. THE Abuse_Engine SHALL compute a suspicious-activity score for an authentication attempt from configured signals.
6. WHEN a computed suspicious-activity score reaches the configured threshold, THE Abuse_Engine SHALL trigger the configured response action.
7. THE Abuse_Engine SHALL expose an IP-reputation hook that is consulted during authentication attempts.

### Requirement 8: Moderation Toolkit (Phase 7)

**User Story:** As a trust-and-safety engineer, I want APIs to report, block, and mute users with an auditable queue, so that harmful behavior can be acted on and reviewed.

#### Acceptance Criteria

1. WHEN a user submits a report against another user through the report API, THE Moderation_Toolkit SHALL store the report and SHALL place it in the moderation queue.
2. WHEN a user blocks another user through the block API, THE Moderation_Toolkit SHALL record the block relationship.
3. WHILE a block relationship exists from user A to user B, THE Moderation_Toolkit SHALL prevent user B from sending messages to user A.
4. WHEN a user mutes another user through the mute API, THE Moderation_Toolkit SHALL suppress delivery of muted-user content to the muting user while preserving the content for other recipients.
5. WHEN any report, block, mute, or moderation-queue action occurs, THE Moderation_Toolkit SHALL create an Audit_Event recording the actor, the target, the action, and the timestamp.
6. THE Moderation_Toolkit SHALL expose the moderation queue so that a moderator can list pending reports and record a resolution for each report.
7. THE Moderation_Toolkit SHALL store Audit_Events such that recorded events are not modifiable through the public moderation API.

### Requirement 9: Secrets Management (Phase 8)

**User Story:** As a platform operator, I want a pluggable secrets provider with first-class adapters, so that secrets are sourced securely and never leak into logs.

#### Acceptance Criteria

1. THE SecretProvider SHALL build on the existing `packages/core/src/security/vault.ts` capabilities rather than replace them.
2. THE SecretProvider SHALL define a single interface implemented by adapters for GitHub Secrets, AWS Secrets Manager, Azure Key Vault, and GCP Secret Manager.
3. WHEN the application requests a secret by name, THE SecretProvider SHALL retrieve the secret value through the configured adapter.
4. THE SecretProvider SHALL ensure that retrieved secret values are excluded from log output produced by the Core_Package, including log output produced during startup error handling.
5. IF a secret that is declared as required cannot be retrieved at startup, THEN THE Core_Package SHALL terminate startup with a non-zero exit code and SHALL emit the missing secret's name without emitting its value.
6. WHEN a secret value is rotated in the external store, THE SecretProvider SHALL retrieve the rotated value on the next request for that secret without requiring a process restart.

### Requirement 10: Privacy Controls (Phase 9)

**User Story:** As a data-protection officer, I want account deletion, data export, retention, and consent tracking, so that the platform can meet privacy obligations.

#### Acceptance Criteria

1. WHEN a data-export request is made for a user, THE Privacy_Controls SHALL generate an export package containing the personal data the platform holds for that user.
2. WHEN an account-deletion request is completed for a user, THE Privacy_Controls SHALL remove the user's personal data such that subsequent reads for that user return no personal data.
3. THE Privacy_Controls SHALL apply a configured retention policy that removes records once they exceed their configured retention period.
4. WHEN a retention period for a record elapses, THE Privacy_Controls SHALL remove that record on the next retention enforcement cycle.
5. WHEN a user grants or withdraws consent for a defined purpose, THE Privacy_Controls SHALL record the consent decision with the purpose and timestamp.
6. WHILE a user has withdrawn consent for a defined purpose, THE Privacy_Controls SHALL refuse processing that depends on that purpose.

### Requirement 11: Dating App Reference Module (Phase 10)

**User Story:** As a developer building a dating app, I want official reference packages, so that I can assemble profiles, matching, messaging, and moderation on hardened primitives.

#### Acceptance Criteria

1. THE Dating_Reference_Module SHALL publish four packages under `packages/`: `@streetjs/dating-auth`, `@streetjs/dating-profiles`, `@streetjs/dating-messaging`, and `@streetjs/dating-moderation`.
2. THE `@streetjs/dating-profiles` package SHALL provide profile creation and likes, and SHALL record a match WHEN two users have liked each other.
3. THE `@streetjs/dating-messaging` package SHALL enable messaging between matched users and SHALL build on the EncryptedField for message content.
4. THE `@streetjs/dating-moderation` package SHALL provide blocking and reporting that build on the Moderation_Toolkit.
5. WHILE a block relationship exists between two users, THE `@streetjs/dating-messaging` package SHALL prevent messaging between those users.
6. THE Dating_Reference_Module SHALL include, for each of its four packages, source implementation, documentation, automated tests, and runnable examples.
7. THE `@streetjs/dating-auth` package SHALL build on the Core_Package authentication and Abuse_Engine primitives rather than introduce independent authentication logic.

### Requirement 12: Certification Report and Scorecard (Final Deliverable)

**User Story:** As a framework maintainer, I want a final certification report scoring the platform across defined categories, so that consumer-platform readiness is summarized from real evidence.

#### Acceptance Criteria

1. THE Certification_Report SHALL report a status for each of the following categories: Security, Privacy, Abuse Prevention, Authentication, Moderation, Developer Experience, Enterprise Readiness, and Production Readiness.
2. THE Certification_Report SHALL derive each category status from the VERIFIED status of the features that contribute to that category as defined by the Zero_Trust_Standard.
3. WHERE any feature contributing to a category is NOT VERIFIED, THE Certification_Report SHALL report that category as not fully certified and SHALL list the unverified features.
4. THE Certification_Report SHALL reference the executed-command evidence supporting each VERIFIED feature it counts.
5. THE Certification_Report SHALL be produced during task execution from captured command evidence rather than asserted within specification documents.
