# ADR 0004: Plugin registrations return disposers and unload owns cleanup

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** core plugin sandbox and HTTP/HTTP2 plugin loading

## Problem

Plugin event listeners registered through the HTTP sandbox were attached to a shared emitter but were not retained for removal during unload. Reloading a plugin could duplicate handlers and retain plugin closures. The plugin SDK also did not express ownership in its `on()` return type.

## Existing behavior

`SandboxedApp.use()` registered middleware and the HTTP app removed those middleware functions on unload. `SandboxedApp.on()` returned `void`, while the implementation attached handlers without an unload registry. The formal `PluginHost` recorded gated listeners but did not expose a lifecycle ownership contract.

## Decision

Change `SandboxedApp.on()` to return an unsubscribe function. The HTTP app records disposers per plugin and invokes them during unload, then clears the registry. The gated plugin sandbox also returns a disposer that removes its listener record. HTTP2, which does not emit plugin events, returns a safe no-op disposer.

Unloading an already-unloaded plugin remains safe. Existing callers that ignore the return value remain source-compatible.

## Alternatives considered

1. **Require every plugin to manually remove listeners:** rejected; lifecycle ownership would remain inconsistent and easy to forget.
2. **Add a generic resource package immediately:** rejected; the current contract can be improved at the existing plugin SDK owner without speculative package creation.
3. **Remove plugin events:** rejected; events are an existing public extension capability.

## Compatibility impact

The TypeScript return type is additive for callers that ignored the previous `void` result. Existing `onLoad` and `onUnload` methods remain valid. Plugin unload now removes listeners that previously leaked, which is the intended lifecycle correction.

## Migration path

New plugins may retain and call the disposer for early cleanup, but do not need to do so for normal unload. Future plugin registrations for timers, health checks, metrics, sockets, and subscriptions should follow the same disposer/resource-scope rule.

## Evidence

The plugin load/unload regression suite passes after registering and disposing an event listener through the sandbox. Core build, core lint, and the 38-test roadmap completion suite pass.
