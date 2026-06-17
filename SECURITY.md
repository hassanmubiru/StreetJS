# Security Policy

## Supported Versions

Security fixes are provided for the latest published `1.0.x` release line.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Severity Classification

We triage reports with CVSS v3.1 and target the following response/fix windows:

| Severity | CVSS v3.1 | Examples | Target fix |
| --- | --- | --- | --- |
| Critical | 9.0–10.0 | Unauthenticated RCE, auth bypass, secret/key disclosure | ≤ 7 days |
| High | 7.0–8.9 | Privilege escalation, SQL/command injection, stored XSS | ≤ 14 days |
| Medium | 4.0–6.9 | Reflected XSS, CSRF, ReDoS, info leak requiring conditions | ≤ 30 days |
| Low | 0.1–3.9 | Limited-impact issues, hardening gaps, verbose errors | best effort / next release |

Severity may be adjusted based on exploitability, affected configurations
(production-default vs opt-in), and real-world impact. Fixes for Critical/High
issues are released as patch versions on the supported `1.0.x` line and noted in
the changelog and a GitHub Security Advisory.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/hassanmubiru/StreetJS/security/advisories/new):

1. Go to the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Provide a description of the issue, the affected version(s), and clear steps
   to reproduce (a minimal proof-of-concept is ideal).

If you cannot use GitHub's private reporting, open a normal issue that contains
**no exploit details** asking a maintainer to open a private channel.

## What to Expect

- **Acknowledgement** within 3 business days.
- An initial assessment and severity triage within 7 business days.
- Coordinated disclosure: we will agree on a disclosure timeline with you and
  credit you in the release notes unless you prefer to remain anonymous.

## Scope

Vulnerabilities in the `streetjs` core, the `@streetjs/cli`, the
`@streetjs/registry-server`, and the build/release tooling in this repository
are in scope. Issues in third-party dependencies should be reported upstream;
if a dependency issue affects this project, let us know so we can pin or patch.
