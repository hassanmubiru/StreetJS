// src/auth.ts
// Connection authentication (upgrade authFn) and channel authorization types.
//
// This module declares the `ChannelAuthorizer` used to gate Secured_Channels
// (Req 10) and the upgrade-authentication wiring (Req 3, 9): a factory that
// builds the `authFn` installed on the `StreetWebSocketServer` upgrade hook and
// the `WsHandler` that associates the resolved Member with the established
// `StreetSocket`.

import type { IncomingMessage } from 'node:http';
import type { WsHandler, StreetSocket, RealtimeConnection } from 'streetjs';
import type { Member } from './facade.js';

/** Authorization rule for a Secured_Channel (Req 10.1, 10.2). */
export type ChannelAuthorizer = (
  ctx: { channel: string; member: Member | null; action: 'join' | 'broadcast' },
) => boolean | Promise<boolean>;

/**
 * Resolves a Member from an authenticated upgrade request. This is the
 * `RealtimeOptions.authenticate` hook; it is expected to verify the request's
 * credential using the framework's Auth_Provider (`JwtService` /
 * `SessionManager`) and return the resolved {@link Member}, or `null` when the
 * credential is missing or invalid (Req 9.1, 9.2).
 */
export type UpgradeAuthenticator = (req: IncomingMessage) => Promise<Member | null>;

/**
 * Associates a resolved Member with an established connection. This is the
 * facade's `bind` (Req 9.3); binding a `null` member clears any association
 * while still binding the connection's close-cleanup lifecycle.
 */
export type MemberBinder = (conn: RealtimeConnection, member: Member | null) => void;

/**
 * The two pieces the facade installs on the WebSocket server to authenticate
 * realtime upgrades and associate identities:
 *
 *   - {@link RealtimeUpgradeAuth.authFn} — installed on the
 *     `StreetWebSocketServer` upgrade hook. It runs *after* the server's own
 *     origin gate (`isOriginAllowed`, Req 3.5/3.6 — we add no origin
 *     restriction of our own) and *before* the connection is accepted (Req 9.1).
 *     It resolves the Member via the configured {@link UpgradeAuthenticator};
 *     a missing/invalid credential (a `null` result or a thrown error) makes it
 *     return `false`, so the server rejects the upgrade with HTTP 401 and
 *     establishes no connection (Req 9.2). A resolved Member is stashed keyed by
 *     the upgrade request so the connection handler can associate it once the
 *     socket exists.
 *   - {@link RealtimeUpgradeAuth.handler} — the `WsHandler` passed to
 *     `StreetWebSocketServer.attach`. The server wraps the accepted socket as a
 *     `StreetSocket` before invoking this handler (Req 3.2); the handler then
 *     associates the stashed Member with that connection via the facade's
 *     `bind`, which also binds the hub-cleanup lifecycle so a close removes the
 *     connection from every room (Req 3.3, 9.3). If the identity cannot be
 *     associated, the connection is kept open without a Member association
 *     (Req 9.4).
 */
export interface RealtimeUpgradeAuth {
  /** Upgrade-time authentication hook for `WsServerOptions.authFn`. */
  readonly authFn: (req: IncomingMessage) => Promise<boolean>;
  /** Connection handler for `StreetWebSocketServer.attach` that binds identity. */
  readonly handler: WsHandler;
}

/**
 * Build the {@link RealtimeUpgradeAuth} pair for the upgrade authentication flow
 * (Req 3, 9). `authenticate` resolves a Member from the upgrade request (via the
 * Auth_Provider); `bind` associates the resolved Member with the established
 * connection (the facade's `bind`).
 *
 * A short-lived `WeakMap<IncomingMessage, Member>` carries the Member resolved
 * during `authFn` across to the `handler` that runs once the socket exists.
 * Keying on the request object (which the server passes to both the upgrade
 * hook and the connection handler) needs no shared mutable id and lets the
 * entry be garbage-collected if the upgrade is abandoned.
 */
export function createRealtimeUpgradeAuth(
  authenticate: UpgradeAuthenticator,
  bind: MemberBinder,
): RealtimeUpgradeAuth {
  const pending = new WeakMap<IncomingMessage, Member>();

  const authFn = async (req: IncomingMessage): Promise<boolean> => {
    let member: Member | null;
    try {
      member = await authenticate(req);
    } catch {
      // A thrown authenticator is treated as a failed credential: reject the
      // upgrade with 401 and establish no connection (Req 9.2).
      return false;
    }
    if (member === null || member === undefined) {
      // Missing/invalid credential: reject with 401, no connection (Req 9.2).
      return false;
    }
    // Stash the resolved identity for the connection handler (Req 9.3).
    pending.set(req, member);
    return true;
  };

  const handler: WsHandler = (socket: StreetSocket, req: IncomingMessage): void => {
    // The server has already wrapped the accepted socket as a StreetSocket
    // (Req 3.2). Retrieve the identity resolved at upgrade time and associate
    // it with this connection. `authFn` returned true before the server invoked
    // this handler, so an absent entry means authentication succeeded but the
    // identity could not be carried across — keep the connection open without a
    // Member association (Req 9.4).
    const member = pending.get(req) ?? null;
    pending.delete(req);
    try {
      // `bind` records the Member (Req 9.3) and binds the hub-cleanup lifecycle
      // so a close removes this connection from every room (Req 3.3).
      bind(socket, member);
    } catch {
      // If the identity cannot be associated, keep the authenticated connection
      // open without a Member association (Req 9.4). Still bind the lifecycle so
      // the connection is cleaned up on close.
      try {
        bind(socket, null);
      } catch {
        // Best-effort: never fail the accepted connection over binding.
      }
    }
  };

  return { authFn, handler };
}
