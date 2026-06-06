// src/graphql/subscriptions.ts
// GraphQL subscriptions over WebSocket using the `graphql-transport-ws`
// (graphql-ws) protocol. Zero external runtime dependencies beyond the `ws`
// package already used by StreetWebSocketServer.
//
// This module contains two pieces:
//   1. `GraphQlWsConnection` — a transport-agnostic state machine that
//      implements the graphql-ws message lifecycle. It is driven by feeding it
//      decoded messages and emits frames through a small `GraphQlWsTransport`
//      abstraction, which makes it fully unit-testable without a real socket.
//   2. `attachGraphqlWs` — wires the state machine to a `StreetWebSocketServer`
//      by negotiating the `graphql-transport-ws` subprotocol on HTTP upgrades.

'use strict';

import type { Server } from 'node:http';
import type { GraphQlEngine } from './engine.js';
import type { StreetWebSocketServer } from '../websocket/server.js';

// ─── Protocol Constants ─────────────────────────────────────────────────────

/** The WebSocket subprotocol identifier for the graphql-ws protocol. */
export const GRAPHQL_WS_SUBPROTOCOL = 'graphql-transport-ws';

/** graphql-ws message types (client → server and server → client). */
export const GraphQlWsMessageType = {
  ConnectionInit: 'connection_init',
  ConnectionAck: 'connection_ack',
  Ping: 'ping',
  Pong: 'pong',
  Subscribe: 'subscribe',
  Next: 'next',
  Error: 'error',
  Complete: 'complete',
} as const;

/** Close codes defined by the graphql-ws protocol. */
export const GraphQlWsCloseCode = {
  BadRequest: 4400,
  Unauthorized: 4401,
  Forbidden: 4403,
  ConnectionInitTimeout: 4408,
  SubscriberAlreadyExists: 4409,
  TooManyInitRequests: 4429,
} as const;

export interface GraphQlWsMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

/** Payload shape of a `subscribe` message. */
interface SubscribePayload {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

// ─── Transport Abstraction ──────────────────────────────────────────────────

/**
 * Minimal transport contract the connection state machine writes to. A real
 * deployment adapts this over a `ws` WebSocket; tests adapt it over an array.
 */
export interface GraphQlWsTransport {
  /** Send a serialized message frame to the peer. */
  send(data: string): void;
  /** Close the connection with a code and reason. */
  close(code: number, reason: string): void;
}

export interface GraphQlWsConnectionOptions {
  /**
   * How long (ms) to wait for a `connection_init` message before closing with
   * 4408. Defaults to 3000ms. The timer is unref'd so it never keeps the
   * process alive.
   */
  connectionInitWaitTimeoutMs?: number;
  /**
   * Optional auth/handshake hook invoked on `connection_init`. Receives the
   * init payload (`connectionParams`). Return false (or throw) to reject the
   * connection with 4403 Forbidden.
   */
  onConnect?: (connectionParams: Record<string, unknown> | undefined) => boolean | Promise<boolean>;
  /** Context value passed to the engine for each subscription. */
  context?: unknown;
}

// ─── Connection State Machine ───────────────────────────────────────────────

/**
 * Transport-agnostic implementation of a single graphql-ws connection. Feed it
 * decoded messages via {@link handleMessage} and notify it of socket closure
 * via {@link handleClose}; it manages acknowledgement, active subscriptions,
 * and protocol-conformant framing/close codes.
 */
export class GraphQlWsConnection {
  private initReceived = false;
  private acknowledged = false;
  private closed = false;
  private initTimer: NodeJS.Timeout | undefined;
  /** Active subscriptions keyed by client-provided operation id. */
  private readonly subscriptions = new Map<string, AsyncGenerator<unknown, void, unknown>>();

  constructor(
    private readonly engine: GraphQlEngine,
    private readonly transport: GraphQlWsTransport,
    private readonly options: GraphQlWsConnectionOptions = {},
  ) {}

  /** Begin the connection: arm the connection_init timeout. */
  start(): void {
    const wait = this.options.connectionInitWaitTimeoutMs ?? 3000;
    if (wait > 0) {
      this.initTimer = setTimeout(() => {
        if (!this.initReceived) {
          this.closeConnection(
            GraphQlWsCloseCode.ConnectionInitTimeout,
            'Connection initialisation timeout',
          );
        }
      }, wait);
      this.initTimer.unref?.();
    }
  }

  /** Handle one incoming message (raw JSON string or an already-decoded object). */
  async handleMessage(raw: string | GraphQlWsMessage): Promise<void> {
    if (this.closed) return;

    let msg: GraphQlWsMessage;
    if (typeof raw === 'string') {
      try {
        msg = JSON.parse(raw) as GraphQlWsMessage;
      } catch {
        this.closeConnection(GraphQlWsCloseCode.BadRequest, 'Invalid message: malformed JSON');
        return;
      }
    } else {
      msg = raw;
    }

    if (!msg || typeof msg.type !== 'string') {
      this.closeConnection(GraphQlWsCloseCode.BadRequest, 'Invalid message: missing type');
      return;
    }

    switch (msg.type) {
      case GraphQlWsMessageType.ConnectionInit:
        await this.onConnectionInit(msg);
        return;
      case GraphQlWsMessageType.Ping:
        this.sendMessage({ type: GraphQlWsMessageType.Pong, payload: msg.payload });
        return;
      case GraphQlWsMessageType.Pong:
        // Peer responded to our ping; nothing to do.
        return;
      case GraphQlWsMessageType.Subscribe:
        await this.onSubscribe(msg);
        return;
      case GraphQlWsMessageType.Complete:
        this.onClientComplete(msg);
        return;
      default:
        this.closeConnection(
          GraphQlWsCloseCode.BadRequest,
          `Invalid message: unknown type "${msg.type}"`,
        );
    }
  }

  /** Notify the state machine that the underlying socket closed. */
  handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.initTimer) clearTimeout(this.initTimer);
    this.initTimer = undefined;
    for (const [, gen] of this.subscriptions) {
      void gen.return(undefined);
    }
    this.subscriptions.clear();
  }

  /** Number of currently active subscriptions (exposed for testing/metrics). */
  get activeSubscriptions(): number {
    return this.subscriptions.size;
  }

  // ─── Message handlers ──────────────────────────────────────────────────────

  private async onConnectionInit(msg: GraphQlWsMessage): Promise<void> {
    if (this.initReceived) {
      this.closeConnection(
        GraphQlWsCloseCode.TooManyInitRequests,
        'Too many initialisation requests',
      );
      return;
    }
    this.initReceived = true;
    if (this.initTimer) clearTimeout(this.initTimer);
    this.initTimer = undefined;

    if (this.options.onConnect) {
      let allowed: boolean;
      try {
        allowed = await this.options.onConnect(
          msg.payload as Record<string, unknown> | undefined,
        );
      } catch {
        allowed = false;
      }
      if (!allowed) {
        this.closeConnection(GraphQlWsCloseCode.Forbidden, 'Forbidden');
        return;
      }
    }

    this.acknowledged = true;
    this.sendMessage({ type: GraphQlWsMessageType.ConnectionAck });
  }

  private async onSubscribe(msg: GraphQlWsMessage): Promise<void> {
    if (!this.acknowledged) {
      this.closeConnection(GraphQlWsCloseCode.Unauthorized, 'Unauthorized');
      return;
    }
    const id = msg.id;
    if (typeof id !== 'string' || id.length === 0) {
      this.closeConnection(GraphQlWsCloseCode.BadRequest, 'Invalid subscribe: missing id');
      return;
    }
    if (this.subscriptions.has(id)) {
      this.closeConnection(
        GraphQlWsCloseCode.SubscriberAlreadyExists,
        `Subscriber for "${id}" already exists`,
      );
      return;
    }

    const payload = msg.payload as SubscribePayload | undefined;
    if (!payload || typeof payload.query !== 'string') {
      this.closeConnection(GraphQlWsCloseCode.BadRequest, 'Invalid subscribe: missing query');
      return;
    }

    const iterator = this.engine.executeSubscription(
      payload.query,
      payload.variables,
      this.options.context,
    );
    this.subscriptions.set(id, iterator);
    void this.pump(id, iterator);
  }

  /** Drain a subscription's async iterator, framing each event as `next`. */
  private async pump(id: string, iterator: AsyncGenerator<unknown, void, unknown>): Promise<void> {
    try {
      for await (const result of iterator) {
        // Was the subscription cancelled (client complete / disconnect)?
        if (!this.subscriptions.has(id)) return;
        this.sendMessage({ id, type: GraphQlWsMessageType.Next, payload: result });
      }
      // Stream ended naturally.
      if (this.subscriptions.delete(id)) {
        this.sendMessage({ id, type: GraphQlWsMessageType.Complete });
      }
    } catch (e) {
      this.subscriptions.delete(id);
      this.sendMessage({
        id,
        type: GraphQlWsMessageType.Error,
        payload: [{ message: e instanceof Error ? e.message : String(e) }],
      });
    }
  }

  private onClientComplete(msg: GraphQlWsMessage): void {
    const id = msg.id;
    if (typeof id !== 'string') return;
    const iterator = this.subscriptions.get(id);
    if (iterator) {
      this.subscriptions.delete(id);
      // Stop the producer; the pump loop will observe the deletion/return.
      void iterator.return(undefined);
    }
  }

  // ─── Framing helpers ────────────────────────────────────────────────────────

  private sendMessage(msg: GraphQlWsMessage): void {
    if (this.closed) return;
    this.transport.send(JSON.stringify(msg));
  }

  private closeConnection(code: number, reason: string): void {
    if (this.closed) return;
    // Tear down subscriptions/timers first, then close the transport.
    this.handleClose();
    this.transport.close(code, reason);
  }
}

// ─── StreetWebSocketServer Integration ──────────────────────────────────────

export interface GraphQlWsServerOptions extends GraphQlWsConnectionOptions {}

/**
 * Attach a graphql-ws subscription endpoint to an HTTP server using the given
 * {@link StreetWebSocketServer}. The server negotiates the
 * `graphql-transport-ws` subprotocol on upgrade and runs a
 * {@link GraphQlWsConnection} per socket, cleaning up all active subscriptions
 * when the connection closes.
 */
export function attachGraphqlWs(
  wsServer: StreetWebSocketServer,
  server: Server,
  engine: GraphQlEngine,
  options: GraphQlWsServerOptions = {},
): void {
  wsServer.attachProtocol(server, GRAPHQL_WS_SUBPROTOCOL, (ws) => {
    const transport: GraphQlWsTransport = {
      send: (data) => {
        try {
          ws.send(data);
        } catch {
          /* socket already closing */
        }
      },
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          /* already closed */
        }
      },
    };

    const connection = new GraphQlWsConnection(engine, transport, options);

    ws.on('message', (data: unknown) => {
      const raw = Array.isArray(data)
        ? Buffer.concat(data as Buffer[]).toString('utf8')
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : String(data);
      void connection.handleMessage(raw);
    });
    ws.on('close', () => connection.handleClose());
    ws.on('error', () => connection.handleClose());

    connection.start();
  });
}
