# ADR 0014: Give plugins a generic owned-resource cleanup hook

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** core plugin SDK, HTTP/HTTP2 plugin sandboxes, and `PluginHost`

## Problem

Plugin event listeners had an unload path, but timers, health checks, metrics
handles, sockets, and external subscriptions had no common ownership contract.
Plugins could leak those resources across reloads.

## Decision

Add `SandboxedApp.addCleanup(cleanup)` returning an idempotent disposer. Plugin
hosts and HTTP/HTTP2 application sandboxes own registered cleanup callbacks and
run them during unload in reverse registration order. Existing `on()` listener
registration uses the same cleanup mechanism.

The hook is intentionally generic: timer handles, health/metric registration
disposers, sockets, and subscriptions can use their existing cleanup functions
without new framework-specific wrappers.

## Compatibility impact

Additive. Existing plugins do not need to change. Event listener cleanup remains
automatic. Cleanup callbacks are synchronous by contract; asynchronous resources
should expose a synchronous cancellation/close trigger and complete shutdown via
their existing lifecycle owner.

## Evidence

HTTP application and formal `PluginHost` tests verify arbitrary cleanup runs once
on unload/disable and repeated unload is safe.
