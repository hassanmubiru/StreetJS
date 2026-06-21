# Showcase Applications Roadmap — StreetJS Phase 17 (Workstream C)

> Tags: **VERIFIED** · **GAP** · **RECOMMENDATION**.

## Current state — VERIFIED

`examples/` already contains 6 runnable reference apps:
`01-rest-api`, `02-jwt-auth`, `03-background-jobs`, `04-realtime-chat`,
`05-live-dashboard`, `06-multiplayer`, plus a `reference-apps/` set. The docs
site exposes `/showcase/` and example pages (`rest-api`, `websocket-chat`,
`todo-api`, `user-api`, `file-upload`, `streaming-query`). — VERIFIED

GAP: there is no **tiered** learning path (beginner → advanced) and no
full-product reference apps (dating, marketplace, multi-tenant SaaS).

## Plan — tiered reference applications

For each app: architecture · packages used · deployment target · tutorial strategy.

### Beginner (consolidate existing + add)
| App | Architecture | Packages | Deploy | Tutorial |
|---|---|---|---|---|
| Todo API | CRUD controller + repository + sqlite | core | single VPS / Fly | "60-second API" quickstart (maps to `--starter`-less create) |
| Blog API | posts/comments entities, pagination, FTS | core + `@streetjs/search` | VPS | "Build a blog API" written guide |
| Notes API | auth + per-user notes | core (JWT) | VPS | "Add auth to an API" |

Beginner apps already largely exist (`01-rest-api`, `02-jwt-auth`) — VERIFIED;
package as a guided path rather than rebuild.

### Intermediate
| App | Architecture | Packages | Deploy | Tutorial |
|---|---|---|---|---|
| Authentication Service | JWT + sessions + OAuth + RBAC + MFA | core + `plugin-oauth` (GAP) | VPS/Docker | "Build an auth service" series |
| Chat Application | WS channels + presence + history | core + `plugin-redis` | VPS | maps to `--starter realtime` |
| SaaS Backend | teams/roles/billing | core + `plugin-stripe` | Docker | maps to `--starter saas` |

### Advanced (NEW — GAP)
| App | Architecture | Packages | Deploy | Tutorial |
|---|---|---|---|---|
| Dating Platform Backend | profiles, matching, messaging, moderation | `@streetjs/dating-*` (VERIFIED these packages exist) | Docker/K8s | flagship case study |
| Marketplace Platform | products/orders/payments/search | core + `plugin-stripe` + `@streetjs/search` | Docker | maps to `--starter marketplace` |
| Learning Platform | courses, enrollments, video, progress | core + `plugin-s3` | Docker | long-form tutorial |
| Enterprise Multi-Tenant SaaS | tenant isolation, RBAC, audit, billing | core + stripe + observability | K8s | enterprise reference |

## RECOMMENDATIONS

1. **Repackage, don't rebuild.** The 6 existing examples cover most
   beginner/intermediate needs — wrap them in a `/showcase/` learning path with
   difficulty badges and "what you'll learn."
2. **Build the dating backend showcase** — the `@streetjs/dating-*` packages
   already exist (auth, messaging, moderation, profiles); a single deployable
   reference app turns 4 packages into one compelling demo.
3. **Tie showcases to starters 1:1** so every starter has a "see it live" app and
   every showcase has a one-command `create --starter`.
4. **One deploy target per tier** (VPS → Docker → K8s) to demonstrate the
   self-host story without managed-service lock-in.
