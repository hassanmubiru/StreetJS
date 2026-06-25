# Security Policy — @streetjs/plugin-twilio

Vulnerabilities in this plugin are handled under the StreetJS project security
policy. **Do not** report security issues through public GitHub issues, discussions,
or pull requests.

- **Report privately** via the root [`SECURITY.md`](../../SECURITY.md) (GitHub
  private vulnerability reporting). Acknowledgement within 3 business days; triage
  within 7; severity windows per the project CVSS policy.
- **Integrity:** this plugin ships an Ed25519-signed manifest
  (`manifest.signed.json` / `manifest.pub`) verified in CI against the official
  signing key (`packages/core/src/platform/plugins/official-key.ts`).
- **Plugin security analysis:** see `security/PLUGIN-SECURITY-AUDIT.md`.
