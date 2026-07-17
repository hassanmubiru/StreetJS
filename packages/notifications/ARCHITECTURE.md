# Architecture — @streetjs/notifications

## Purpose

`@streetjs/notifications` is the framework's unified notification dispatcher. It
decouples "what to send and to whom" from "how each channel delivers it," so
applications (StreetStudio and others) express a single `notify(...)` call and
the framework handles rendering, preference gating, fan-out, and per-delivery
result collection — instead of each app re-implementing multi-channel logic.

## Dependencies

None. Pure TypeScript over `Map`/`Set`; zero third-party runtime dependencies,
with a `browser` export condition. Real transports are supplied by the
application (or other `@streetjs/*` packages) as `NotificationChannel`
implementations — this package owns orchestration, not I/O.

## Design

### Channel abstraction

A `NotificationChannel` is `{ name, send(rendered) }`. Email/SMS/push/webhook/
realtime are all the same shape; `MemoryChannel` (recorder) and `FunctionChannel`
(wrap an async fn) ship built in. This mirrors the provider/driver pattern used
across StreetJS (`storage` drivers, `ai` providers, `search` providers).

### Orchestration

`Notifier.notify(message)`:
1. Normalizes recipients (single or array) and resolves target channels
   (`message.channels` → `defaultChannels` → all registered).
2. Resolves the subject/body **once**: from a `TemplateStore` when
   `message.template` is set (throwing `NotificationError` up front on an unknown
   id — a config error), else from the literal `subject`/`body`.
3. For each recipient × channel: checks the `PreferenceStore`, renders with
   `renderTemplate` (recipient injected as `{{recipient.*}}`), resolves the
   channel address, invokes `send`, and records a `DeliveryResult`.

A per-delivery `try/catch` means one channel throwing yields a `failed` result
without aborting the rest of the batch — important for multi-recipient sends.

### Preferences

Delivery is opt-out by default. `InMemoryPreferenceStore` supports whole-channel
and `channel:category` opt-outs plus mandatory categories (security/
transactional) that can never be suppressed. Any `PreferenceStore` implementation
can back it with a database. `AllowAllPreferences` is the permissive default.

### Templating

`renderTemplate` is a pure, logic-free `{{ path }}` interpolator (dotted paths,
object JSON-encoding, missing → empty). Deliberately minimal and deterministic;
richer templating (conditionals/loops/i18n) is left to a dedicated engine so this
package stays safe and dependency-free.

## Testing

Runs with no I/O using `MemoryChannel`/`FunctionChannel` and the in-memory
stores: template rendering, preference matrix (channel/category/mandatory),
literal vs. template rendering, explicit channels, multi-recipient fan-out,
opt-out skips, unknown-channel failures, resilient per-delivery error capture,
the `onResult` observer, and id-less sends. Coverage is 100% lines/functions and
≥96% branches.

## Non-goals

- No transport implementations (email/SMS/push clients) — those are channels the
  app plugs in.
- No delivery persistence, retries, or scheduling — compose with `@streetjs/queue`
  for durable/ret/delayed delivery.
- No rich templating engine.
