# security/

Security analyses, reviews, and process runbooks for the StreetJS ecosystem.
The **public reporting policy** lives in the root [`SECURITY.md`](../SECURITY.md);
this folder holds the supporting evidence and process docs.

| Document | Purpose |
|---|---|
| `PHASE-19-MASTER-AUDIT.md` | Latest full governance/security/org audit (Phases 1–10) |
| `SECURITY-HARDENING-SPRINT.md` | Executable P0/P1/P2 remediation plan |
| `SECURITY-AUDIT.md` | Repository security posture (signing trust model, secrets, CI) |
| `KEY-ROTATION-RUNBOOK.md` | Step-by-step signing-key rotation procedure |
| `PLUGIN-SECURITY-AUDIT.md` | Per-plugin control matrix (21 plugins + 2 modules) |
| `MARZPAY-SECURITY-REVIEW.md` | Deep review of `@streetjs/plugin-marzpay` |
| `PAYMENTS-SECURITY-REVIEW.md` | Payments-surface review |
| `PLUGIN-SIGNING-REVIEW.md` | Plugin signing infrastructure review |
| `THREAT-MODEL-2026.md`, `THREAT-MODEL-UPDATE.md` | Threat models |
| `SECURITY-SCORECARD.md` | Scorecard summary |
| `PRIVACY-POLICY-FOR-REPO.md` | Contributor exposure/privacy policy |

> Security documents must contain **no secret values** — only fingerprints, paths, and process.
