# ADR 0025: WebSocket resource lifecycle ownership

- **Status:** Accepted
- **Date:** 2026-10-21
- **Scope:** `@streetjs/websocket` server attachments and protocol integrations

## Decision

Each `StreetWebSocketServer` owns the resources created by its attachments: upgrade
listeners, tracked client sockets, the optional heartbeat timer, and every protocol
`WebSocketServer` created by `attachProtocol`. Ownership is isolated by server instance,
including when multiple applications share one HTTP server on different URL paths.

`close()` is idempotent and memoized. It detaches owned upgrade listeners, stops the
heartbeat, terminates all owned clients, and closes all owned protocol servers. Cleanup
continues when an individual client termination throws; the first cleanup error remains
observable through the returned promise. Upgrade paths compare URL pathnames, allowing
query strings without changing route ownership. A synchronous accepted-handler failure
closes the accepted connection.

## Evidence

The WebSocket integration tests use real `http.Server` instances and real `ws` clients to
verify path ownership, cross-application isolation, heartbeat shutdown, client disconnect
cleanup, repeated/concurrent close, post-close upgrades, protocol cleanup, and handler
failure. A focused unit test uses controlled socket doubles to verify cleanup failure
isolation.

## Boundaries

This decision does not add a shutdown timeout, a queue or workflow lifecycle, or a global
lifecycle manager. Applications remain responsible for closing the HTTP server itself.
