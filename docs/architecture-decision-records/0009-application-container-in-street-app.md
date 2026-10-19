# ADR 0009: Allow StreetApp to use an application-scoped container

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `streetApp`, `streetHttp2App`, and controller construction

## Problem

The container now supports isolated application scopes, but `StreetApp` still
constructed controllers through the legacy global container unconditionally.
Applications could not opt into isolation without bypassing the framework's
controller registration path.

## Existing behavior

`streetApp().registerController()` resolved controllers from the exported global
`container`. HTTP2 used the same global path. Existing applications may register
shared framework services there.

## Decision

Add an optional `container?: Container` to `StreetAppOptions` and expose the
selected container as `app.container`.

- When supplied, HTTP and HTTP2 controller construction uses that application
  container.
- When omitted, the legacy global container remains the selected container.
- StreetApp does not automatically dispose a caller-supplied container; the
  caller owns it and should call `app.container.dispose()` at application
  shutdown. The global compatibility container is never implicitly disposed.

## Alternatives considered

1. **Switch every app to a new container immediately:** rejected because core
   services and existing applications currently register against the global
   container.
2. **Add a second controller registration API:** rejected; it would create two
   framework programming models.
3. **Have StreetApp always dispose the supplied container:** rejected because
   ownership was not established by the app and callers may share a container
   deliberately.

## Compatibility impact

Additive only. Existing calls and global behavior remain unchanged. New apps can
pass `createContainer()` for isolation. `StreetApp.container` is a new public
read-only property.

## Migration path

New applications should create one container per application and pass it to
`streetApp`. A later change may make that the scaffold default after core
services and shutdown ownership are migrated and tested. Existing applications
can continue using the global bridge.

## Evidence

The core build/lint pass, and the application-scoped controller test proves that
two StreetApp instances use distinct dependency instances when given distinct
containers.
