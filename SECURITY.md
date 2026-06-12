# Security Policy

## Supported Versions

Security fixes are provided for the latest published `1.0.x` release line.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/hassanmubiru/street/security/advisories/new):

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
