import type { Server } from 'node:http';
import type { GraphQlEngine } from './engine.js';
import type { StreetWebSocketServer } from '../websocket/server.js';
/** The WebSocket subprotocol identifier for the graphql-ws protocol. */
export declare const GRAPHQL_WS_SUBPROTOCOL = "graphql-transport-ws";
/** graphql-ws message types (client → server and server → client). */
export declare const GraphQlWsMessageType: {
    readonly ConnectionInit: "connection_init";
    readonly ConnectionAck: "connection_ack";
    readonly Ping: "ping";
    readonly Pong: "pong";
    readonly Subscribe: "subscribe";
    readonly Next: "next";
    readonly Error: "error";
    readonly Complete: "complete";
};
/** Close codes defined by the graphql-ws protocol. */
export declare const GraphQlWsCloseCode: {
    readonly BadRequest: 4400;
    readonly Unauthorized: 4401;
    readonly Forbidden: 4403;
    readonly ConnectionInitTimeout: 4408;
    readonly SubscriberAlreadyExists: 4409;
    readonly TooManyInitRequests: 4429;
};
export interface GraphQlWsMessage {
    type: string;
    id?: string;
    payload?: unknown;
}
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
/**
 * Transport-agnostic implementation of a single graphql-ws connection. Feed it
 * decoded messages via {@link handleMessage} and notify it of socket closure
 * via {@link handleClose}; it manages acknowledgement, active subscriptions,
 * and protocol-conformant framing/close codes.
 */
export declare class GraphQlWsConnection {
    private readonly engine;
    private readonly transport;
    private readonly options;
    private initReceived;
    private acknowledged;
    private closed;
    private initTimer;
    /** Active subscriptions keyed by client-provided operation id. */
    private readonly subscriptions;
    constructor(engine: GraphQlEngine, transport: GraphQlWsTransport, options?: GraphQlWsConnectionOptions);
    /** Begin the connection: arm the connection_init timeout. */
    start(): void;
    /** Handle one incoming message (raw JSON string or an already-decoded object). */
    handleMessage(raw: string | GraphQlWsMessage): Promise<void>;
    /** Notify the state machine that the underlying socket closed. */
    handleClose(): void;
    /** Number of currently active subscriptions (exposed for testing/metrics). */
    get activeSubscriptions(): number;
    private onConnectionInit;
    private onSubscribe;
    /** Drain a subscription's async iterator, framing each event as `next`. */
    private pump;
    private onClientComplete;
    private sendMessage;
    private closeConnection;
}
export interface GraphQlWsServerOptions extends GraphQlWsConnectionOptions {
}
/**
 * Attach a graphql-ws subscription endpoint to an HTTP server using the given
 * {@link StreetWebSocketServer}. The server negotiates the
 * `graphql-transport-ws` subprotocol on upgrade and runs a
 * {@link GraphQlWsConnection} per socket, cleaning up all active subscriptions
 * when the connection closes.
 */
export declare function attachGraphqlWs(wsServer: StreetWebSocketServer, server: Server, engine: GraphQlEngine, options?: GraphQlWsServerOptions): void;
//# sourceMappingURL=subscriptions.d.ts.map