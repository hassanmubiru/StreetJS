# Bugfix Requirements Document

## Introduction

CodeQL static analysis on the `main` branch of the Street framework reported a batch of security alerts spanning several defect classes: a disabled TLS certificate validation path in the webhook dispatcher, multiple polynomial (ReDoS-prone) regular expressions applied to uncontrolled input, incomplete string escaping in the SBOM generator, incomplete multi-character XSS sanitization, weak password-hash computational effort in the MySQL wire driver (plus related test fixtures), and several GitHub Actions workflows missing an explicit top-level `permissions` block.

These are existing defects in shipped code. The fix must close each genuine vulnerability while preserving all currently-correct behavior. Some alerts (the MySQL wire-protocol SHA1/SHA256 usage and its test fixtures) implement the MySQL Client/Server authentication protocol as specified; for those the defect to resolve is the absence of a documented justification/suppression rather than a behavioral change, since altering the hash would break protocol compatibility.

The alerts are grouped below into defect classes. Each class defines the bug condition (what triggers it), the corrected behavior, and the surrounding behavior that must remain unchanged.

## Bug Analysis

### Current Behavior (Defect)

**Defect Class A — Disabled TLS certificate validation (alert #24, `packages/core/src/webhook/dispatcher.ts`)**

1.1 WHEN a webhook target is configured with `tls.rejectUnauthorized === false` THEN the system passes `rejectUnauthorized: false` to the HTTPS request, disabling certificate validation and allowing dispatch to endpoints presenting untrusted or forged certificates.

**Defect Class B — Polynomial regular expression on uncontrolled data / ReDoS (alerts #26, #20, #19)**

1.2 WHEN `packages/core/src/auth/mfa.ts` processes externally-supplied input through its polynomial regular expression (line ~31) THEN worst-case input causes super-linear backtracking, enabling a denial-of-service via CPU exhaustion.

1.3 WHEN `packages/cli/src/commands/generate.ts` applies its polynomial regular expression to an uncontrolled path/argument value (line ~126) THEN worst-case input causes super-linear backtracking.

1.4 WHEN `packages/core/src/microservices/grpc/proto-parser.ts` parses uncontrolled `.proto` source through its polynomial regular expression (line ~40) THEN worst-case input causes super-linear backtracking.

**Defect Class C — Incomplete string escaping or encoding (alert #25, `scripts/generate-sbom.mjs`)**

1.5 WHEN the SBOM generator builds a package URL (purl) from a package name (line ~44) THEN it escapes only a single/first occurrence of the special character rather than all required characters, producing an incompletely-encoded purl for names that contain multiple or additional special characters.

**Defect Class D — Incomplete multi-character sanitization (alerts #7, #6, source `packages/core/src/security/xss.ts`)**

1.6 WHEN `sanitizeString` removes dangerous substrings (e.g. tags or protocol prefixes) in a way that can be reconstituted after a single pass THEN crafted input can bypass sanitization and yield a residual dangerous string. (Note: the alert points at `dist/security/xss.js`, which is build output; the fix belongs in the corresponding source file `packages/core/src/security/xss.ts`.)

**Defect Class E — Password hash with insufficient computational effort (alerts #4, #3 in `packages/core/src/database/mysql/wire.ts`; alerts #18, #17, #16, #15 in MySQL auth tests)**

1.7 WHEN CodeQL inspects `nativePasswordHash` / `sha2PasswordHash` in `packages/core/src/database/mysql/wire.ts` (lines ~83 and ~110) THEN it flags the SHA1/SHA256 usage as a password hash with insufficient computational effort, even though these computations implement the MySQL `mysql_native_password` and `caching_sha2_password` wire-protocol challenge-response exactly as specified and are not at-rest password storage.

1.8 WHEN CodeQL inspects the MySQL auth protocol test fixtures (`tests/mysql-caching-sha2-password.test`, `tests/mysql-native-password.test`) THEN it flags the same SHA1/SHA256 usage, which mirrors the protocol-mandated hashing under test.

**Defect Class F — Workflow does not contain permissions (alerts #30, #29, #28, #27, #23, #22, #21)**

1.9 WHEN any of the workflows `vendor-integration.yml`, `observability.yml`, `deploy-verify.yml`, `dast.yml`, `browser-compat.yml`, `kafka-integration.yml`, or `rabbitmq-integration.yml` runs THEN it executes with the repository's default `GITHUB_TOKEN` permissions because no top-level `permissions` block is declared, granting broader token scope than the jobs require.

### Expected Behavior (Correct)

**Defect Class A**

2.1 WHEN a webhook target is configured with `tls.rejectUnauthorized === false` THEN the system SHALL NOT disable certificate validation; it SHALL keep certificate validation enabled (rejecting untrusted certificates) so that no dispatch path transmits payloads over an unverified TLS connection.

**Defect Class B**

2.2 WHEN `packages/core/src/auth/mfa.ts` processes externally-supplied input THEN the system SHALL use a linear-time matching/parsing approach (e.g. a non-backtracking regex, anchored/bounded pattern, or direct string operations) so that processing time remains bounded regardless of input.

2.3 WHEN `packages/cli/src/commands/generate.ts` derives values from an uncontrolled path/argument THEN the system SHALL use a linear-time approach so that processing time remains bounded regardless of input.

2.4 WHEN `packages/core/src/microservices/grpc/proto-parser.ts` parses uncontrolled `.proto` source THEN the system SHALL use a linear-time approach so that parsing time remains bounded regardless of input.

**Defect Class C**

2.5 WHEN the SBOM generator builds a purl from a package name THEN the system SHALL fully and correctly encode all characters that require escaping (e.g. via global replacement or a proper URL/purl encoder) so that the resulting purl is valid for any input package name.

**Defect Class D**

2.6 WHEN `sanitizeString` removes dangerous substrings THEN the system SHALL ensure the result cannot be reconstituted into a dangerous string (e.g. by applying replacement to a fixed point / until stable, or using a non-reconstitutable transform) so that no residual dangerous substring remains after sanitization.

**Defect Class E**

2.7 WHEN the MySQL wire-protocol hashing in `wire.ts` is evaluated THEN the team SHALL confirm whether each finding is a true defect or protocol-mandated; for protocol-mandated computations the system SHALL retain the specified behavior and SHALL carry a documented suppression/justification (e.g. an inline CodeQL suppression with rationale) so the alert is resolved without breaking MySQL authentication.

2.8 WHEN the MySQL auth protocol test fixtures are evaluated THEN they SHALL be handled consistently with their corresponding source-code decision (suppression/justification) so the alerts are resolved without weakening the tests' protocol coverage.

**Defect Class F**

2.9 WHEN any of the seven listed workflows runs THEN it SHALL declare an explicit top-level `permissions` block scoped to the minimum required (least privilege, e.g. `contents: read` plus only the additional scopes each job genuinely needs) so that the `GITHUB_TOKEN` is no longer granted broad default permissions.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a webhook target is configured normally (HTTPS with default or `true` `rejectUnauthorized`, with or without a custom `tls.ca`) THEN the system SHALL CONTINUE TO dispatch webhooks successfully, apply HMAC-SHA256 signing, honor retries, and enforce the existing SSRF/blocked-address protections.

3.2 WHEN the MFA, CLI generate, and proto-parser code receives valid, well-formed input THEN the system SHALL CONTINUE TO produce the same results (TOTP/base32 handling, generated gRPC filenames and types, and parsed proto AST) as before the fix.

3.3 WHEN the SBOM generator processes package names that contain no special characters THEN the system SHALL CONTINUE TO produce the same purls and overall SBOM output as before.

3.4 WHEN `sanitizeString` / `sanitizeDeep` receives benign input (no dangerous substrings) THEN the system SHALL CONTINUE TO return equivalent sanitized output and preserve existing depth, length, array, and key-count bounds.

3.5 WHEN a MySQL server requires `mysql_native_password` or `caching_sha2_password` authentication THEN the system SHALL CONTINUE TO compute the exact protocol-correct challenge responses and authenticate successfully, and the related tests SHALL CONTINUE TO pass.

3.6 WHEN the seven workflows run after adding the `permissions` block THEN they SHALL CONTINUE TO complete all steps that previously succeeded, with no job failing due to insufficient token scope.

3.7 WHEN any other workflow, module, or code path not listed in this document executes THEN the system SHALL CONTINUE TO behave exactly as before.

## Bug Condition Methodology

The fix is validated against bug conditions per defect class. `F` denotes the original (unfixed) code and `F'` the fixed code.

### Defect Class A — TLS validation

```pascal
FUNCTION isBugCondition_A(target)
  INPUT: target of type WebhookTarget
  OUTPUT: boolean
  RETURN target.tls != null AND target.tls.rejectUnauthorized = false
END FUNCTION
```

```pascal
// Property: Fix Checking
FOR ALL target WHERE isBugCondition_A(target) DO
  options ← buildRequestOptions'(target)
  ASSERT options.rejectUnauthorized != false   // validation never disabled
END FOR
```

### Defect Class B — ReDoS

```pascal
FUNCTION isBugCondition_B(input)
  INPUT: input of type string   // uncontrolled data reaching the flagged regex
  OUTPUT: boolean
  RETURN true   // every input is processed by the flagged pattern
END FUNCTION
```

```pascal
// Property: Fix Checking — bounded matching time
FOR ALL input WHERE isBugCondition_B(input) DO
  ASSERT matchTime'(input) is O(n)   // no super-linear backtracking
  ASSERT result'(input) = result(input) for all well-formed input
END FOR
```

### Defect Class C — Incomplete encoding

```pascal
FUNCTION isBugCondition_C(name)
  INPUT: name of type string   // package name
  OUTPUT: boolean
  RETURN name contains a character requiring escaping beyond the first occurrence
END FUNCTION
```

```pascal
// Property: Fix Checking — full encoding
FOR ALL name WHERE isBugCondition_C(name) DO
  purl ← buildPurl'(name)
  ASSERT purl contains no unescaped special characters
END FOR
```

### Defect Class D — Incomplete multi-character sanitization

```pascal
FUNCTION isBugCondition_D(input)
  INPUT: input of type string
  OUTPUT: boolean
  RETURN sanitizeOnce(input) still contains a dangerous substring
END FUNCTION
```

```pascal
// Property: Fix Checking — no reconstitution
FOR ALL input WHERE isBugCondition_D(input) DO
  out ← sanitizeString'(input)
  ASSERT out contains no dangerous substring (stable fixed point)
END FOR
```

### Defect Class E — Protocol-mandated hashing (justification/suppression)

```pascal
FUNCTION isBugCondition_E(callSite)
  INPUT: callSite   // a flagged SHA1/SHA256 use in MySQL wire/auth code
  OUTPUT: boolean
  RETURN callSite implements the MySQL wire-protocol challenge-response
END FUNCTION
```

```pascal
// Property: Fix Checking — resolved without behavioral change
FOR ALL callSite WHERE isBugCondition_E(callSite) DO
  ASSERT hashOutput'(callSite) = hashOutput(callSite)   // unchanged behavior
  ASSERT alert is resolved via documented suppression/justification
END FOR
```

### Defect Class F — Missing workflow permissions

```pascal
FUNCTION isBugCondition_F(workflow)
  INPUT: workflow   // a GitHub Actions workflow file
  OUTPUT: boolean
  RETURN workflow has no top-level `permissions` block
END FUNCTION
```

```pascal
// Property: Fix Checking — explicit least-privilege permissions
FOR ALL workflow WHERE isBugCondition_F(workflow) DO
  ASSERT workflow' declares a top-level `permissions` block
  ASSERT declared scopes are the minimum required by its jobs
END FOR
```

### Preservation (all classes)

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT (isBugCondition_A(X) OR isBugCondition_B(X) OR isBugCondition_C(X)
                     OR isBugCondition_D(X) OR isBugCondition_E(X) OR isBugCondition_F(X)) DO
  ASSERT F(X) = F'(X)
END FOR
```
