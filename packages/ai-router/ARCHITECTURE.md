# Architecture — @streetjs/ai-router

## Purpose

`@streetjs/ai-router` closes the AI "provider routing + model registry" gap. It
lets an application depend on a single `AiProvider` that transparently spreads
load across multiple real providers — choosing by model, preference, or cost,
and surviving a provider outage via fallback — without the application encoding
that logic itself.

## Dependencies

```
@streetjs/ai   (AiProvider contract + request/response types)
```

One first-party dependency, no third-party runtime deps. Because `AiRouter`
implements `AiProvider`, it is a drop-in anywhere the AI package expects a
provider (`RagPipeline`, `ChatSession`, or direct calls).

## Design

### ModelRegistry

A `Map<modelId, ModelInfo>` recording each model's provider, capabilities
(`chat`/`embed`/`transcribe`), optional per-1k-token cost, and context window.
It answers the questions routing needs: `providerFor(modelId)`,
`list(capability)`, and `cheapest(capability)` (ranked by summed input+output
cost, with priced models preferred over unpriced and ties broken by id for
determinism).

### AiRouter

Implements `AiProvider`. Each method delegates to a single `route()` helper that:

1. Builds a **candidate order** via `candidateOrder(capability, model)`:
   the pinned model's provider first (if the registry knows it), then the
   strategy base (`ordered` = declaration order; `cheapest` = the cheapest
   model's provider first), de-duplicated and filtered to registered providers.
2. Tries each provider in order, collecting errors; returns the first success.
3. If `fallback` is off, stops after the first attempt.
4. If all fail, throws `AiRoutingError` carrying every `cause`.

`transcribe` guards each provider with a `typeof provider.transcribe ===
'function'` check, so providers lacking speech-to-text are skipped rather than
crashing the route.

## Testing

Runs offline using `@streetjs/ai`'s `FakeAiProvider` plus local
failing/tagged fake providers: registry lookup/cost ranking/validation,
model-pinned routing, ordered vs. cheapest strategy, single-hop and exhausted
fallback (with `AiRoutingError` causes), `fallback: false`, embed/transcribe
routing (including capability-skipping), and de-duplication/skip of unregistered
providers. Coverage is 100% lines/functions and ≥92% branches.

## Non-goals

- No provider implementations — it composes `@streetjs/ai` providers.
- No token accounting/budgets beyond cost-based ordering (cost is advisory).
- No streaming router (matches the AI package's non-streaming provider contract).
