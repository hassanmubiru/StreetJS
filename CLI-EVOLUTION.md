# CLI Evolution — StreetJS Phase 17 (Workstream D)

> Tags: **VERIFIED** · **GAP** · **RECOMMENDATION**.

## Current CLI surface — VERIFIED

`packages/cli/src/commands/` ships **21** commands:

`add`, `audit`, `build`, `certify`, `create`, `data-commands`, `deploy`, `dev`,
`diagnostics`, `doctor`, `generate`, `info`, `jobs-dashboard`, `migrate`,
`plugin`, `registry`, `seed`, `start`, `test`, `upgrade`, `verify`.

Sub-surfaces confirmed by reading source:
- `generate`: **controller, service, repository, middleware** — VERIFIED
- `plugin`: **install, add, list** — VERIFIED
- `doctor`, `upgrade`, `info`, `certify`, `deploy`, `diagnostics` — VERIFIED (exist)

## Benchmark vs reference CLIs

| Capability | Nest CLI | Laravel Artisan | Angular CLI | StreetJS |
|---|---|---|---|---|
| scaffold project | ✓ | ✓ (installer) | ✓ | ✓ `create` |
| generate controller/service | ✓ | ✓ (make:) | ✓ | ✓ VERIFIED |
| generate module | ✓ | — | ✓ | **GAP** |
| generate middleware | ✓ | ✓ | — | ✓ VERIFIED |
| generate guard/interceptor | ✓ | — | — | **GAP** |
| generate entity/migration | partial | ✓ (make:model/migration) | — | partial (`migrate`/`seed`) |
| generate plugin | — | — | — | **GAP** (StreetJS-specific opportunity) |
| dev server / watch | — | ✓ (serve) | ✓ | ✓ `dev` |
| doctor / env check | — | ✓ (about) | — | ✓ VERIFIED |
| upgrade / migrate versions | ✓ (update) | — | ✓ (update) | ✓ VERIFIED |
| info / version diagnostics | ✓ | ✓ (about) | ✓ | ✓ VERIFIED |
| plugin install/search | — | — | — | partial (install/list; **search GAP**) |

**Finding:** StreetJS CLI is already broader than Artisan/Angular/Nest in several
areas (doctor, deploy, certify, jobs-dashboard, registry). The gaps are narrow.

## Recommended additions — GAP → RECOMMENDATION

| Command | Status | Effort | Rationale |
|---|---|---|---|
| `street generate module` | GAP | S | Parity with Nest/Angular; group controller+service+repo |
| `street generate guard` / `interceptor` | GAP | S | Common auth/cross-cutting scaffolds |
| `street generate plugin` | GAP | M | Scaffolds a signed `PluginModule` package — grows the ecosystem directly |
| `street plugin search <q>` | GAP | M | Queries the registry (`registry` command exists); discovery |
| `street plugin info <name>` | GAP | S | Show certification level + scorecard |
| `street info` ecosystem view | partial | S | Add installed plugins + versions + doctor summary |

Commands the prompt lists that **already exist** (do not rebuild):
`generate controller/service/middleware`, `plugin install`, `doctor`, `upgrade`,
`info`. — VERIFIED

## Implementation notes

- Extend `generate.ts` with `module`/`guard`/`plugin` subcommands reusing the
  existing template + AST-insert helpers.
- `street generate plugin` should emit a buildable package matching the
  `@streetjs/plugin-*` shape (manifest, `PluginModule` subclass, README with logo,
  example, test) so the Verified-tier checklist passes out of the box.
- `plugin search` calls the existing registry client (`registry.ts`).
- Every new command needs a unit test added to the explicit `package.json`
  `test`/`coverage` file lists (coverage gate 85% branches).

**RECOMMENDATION:** prioritize `street generate plugin` — it is the single CLI
feature that compounds ecosystem growth (lowers the barrier to community plugins),
and no reference CLI has an equivalent.
