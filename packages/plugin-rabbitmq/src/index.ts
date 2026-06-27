// packages/plugin-rabbitmq/src/index.ts
// Official StreetJS plugin: RabbitMQ messaging (AMQP 0-9-1).
//
// A standalone package (outside streetjs core) that extends the core
// `PluginModule` SDK and wraps the dependency-free RabbitMQ transport shipped
// by streetjs (`RabbitMqConnectionManager` + confirming `RabbitMqPublisher` +
// acknowledging `RabbitMqConsumer` — a from-scratch AMQP client, no vendor SDK).
// It validates connection config and injects a ready client into each request
// via the sandboxed middleware surface (requires 'middleware').

import {
  PluginModule, PluginError,
  RabbitMqConnectionManager, RabbitMqPublisher, RabbitMqConsumer,
  type SandboxedApp, type PluginManifest, type RabbitMqOptions, type DeliveredMessage,
} from 'streetjs';

export const RABBITMQ_PLUGIN_NAME = 'street-plugin-rabbitmq';
export const RABBITMQ_PLUGIN_VERSION = '1.0.0';

/** Configuration schema for the RabbitMQ plugin. */
export interface RabbitMqPluginConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  vhost?: string;
  /** Topic exchange used for routing. Default 'street.events'. */
  exchange?: string;
  /** Consumer prefetch. Default 50. */
  prefetch?: number;
  /** Connect timeout in ms. */
  connectTimeoutMs?: number;
  /** Heartbeat interval in seconds. */
  heartbeatSeconds?: number;
  /** State key under which the client is injected. Default 'rabbitmq'. */
  stateKey?: string;
  /** Connect over TLS (AMQPS, typically port 5671). Default false (plain TCP). */
  tls?: boolean;
  /** When TLS is on, verify the server certificate chain. Default true. */
  tlsRejectUnauthorized?: boolean;
  /** When TLS is on, the SNI server name to present (defaults to `host`). */
  tlsServerName?: string;
  /** When TLS is on, a PEM CA bundle to trust (for private/self-signed CAs). */
  tlsCa?: string;
}

/** The unsigned manifest for the RabbitMQ plugin (sign it via the build step). */
export function rabbitMqPluginManifest(): PluginManifest {
  return {
    name: RABBITMQ_PLUGIN_NAME,
    version: RABBITMQ_PLUGIN_VERSION,
    capabilities: ['messaging', 'queue', 'rabbitmq'],
    permissions: ['net', 'middleware'],
  };
}

/**
 * Validate raw config against the RabbitMQ plugin's schema. Throws
 * {@link PluginError} with a precise message on the first violation.
 */
export function validateRabbitMqConfig(input: unknown): RabbitMqPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('RabbitMQ plugin config must be an object');
  }
  const o = input as Record<string, unknown>;

  const host = o['host'];
  if (typeof host !== 'string' || host.trim() === '') {
    throw new PluginError('RabbitMQ plugin config: "host" is required and must be a non-empty string');
  }
  const port = o['port'];
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PluginError('RabbitMQ plugin config: "port" is required and must be an integer in [1, 65535]');
  }
  for (const k of ['username', 'password', 'vhost', 'exchange', 'stateKey'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      throw new PluginError(`RabbitMQ plugin config: "${k}" must be a string`);
    }
  }
  if ((o['username'] !== undefined) !== (o['password'] !== undefined)) {
    throw new PluginError('RabbitMQ plugin config: "username" and "password" must be provided together');
  }
  for (const k of ['prefetch', 'connectTimeoutMs', 'heartbeatSeconds'] as const) {
    if (o[k] !== undefined && (typeof o[k] !== 'number' || (o[k] as number) <= 0)) {
      throw new PluginError(`RabbitMQ plugin config: "${k}" must be a positive number`);
    }
  }
  if (o['tls'] !== undefined && typeof o['tls'] !== 'boolean') {
    throw new PluginError('RabbitMQ plugin config: "tls" must be a boolean');
  }
  if (o['tlsRejectUnauthorized'] !== undefined && typeof o['tlsRejectUnauthorized'] !== 'boolean') {
    throw new PluginError('RabbitMQ plugin config: "tlsRejectUnauthorized" must be a boolean');
  }
  for (const k of ['tlsServerName', 'tlsCa'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      throw new PluginError(`RabbitMQ plugin config: "${k}" must be a string`);
    }
  }

  return {
    host,
    port,
    ...(o['username'] !== undefined ? { username: o['username'] as string } : {}),
    ...(o['password'] !== undefined ? { password: o['password'] as string } : {}),
    ...(o['vhost'] !== undefined ? { vhost: o['vhost'] as string } : {}),
    ...(o['exchange'] !== undefined ? { exchange: o['exchange'] as string } : {}),
    ...(o['prefetch'] !== undefined ? { prefetch: o['prefetch'] as number } : {}),
    ...(o['connectTimeoutMs'] !== undefined ? { connectTimeoutMs: o['connectTimeoutMs'] as number } : {}),
    ...(o['heartbeatSeconds'] !== undefined ? { heartbeatSeconds: o['heartbeatSeconds'] as number } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
    ...(o['tls'] !== undefined ? { tls: o['tls'] as boolean } : {}),
    ...(o['tlsRejectUnauthorized'] !== undefined ? { tlsRejectUnauthorized: o['tlsRejectUnauthorized'] as boolean } : {}),
    ...(o['tlsServerName'] !== undefined ? { tlsServerName: o['tlsServerName'] as string } : {}),
    ...(o['tlsCa'] !== undefined ? { tlsCa: o['tlsCa'] as string } : {}),
  };
}

/** Translate the plugin config into the core `RabbitMqOptions`. */
export function toRabbitMqOptions(cfg: RabbitMqPluginConfig): RabbitMqOptions {
  return {
    host: cfg.host,
    port: cfg.port,
    ...(cfg.username !== undefined ? { username: cfg.username } : {}),
    ...(cfg.password !== undefined ? { password: cfg.password } : {}),
    ...(cfg.vhost !== undefined ? { vhost: cfg.vhost } : {}),
    ...(cfg.exchange !== undefined ? { exchange: cfg.exchange } : {}),
    ...(cfg.prefetch !== undefined ? { prefetch: cfg.prefetch } : {}),
    ...(cfg.connectTimeoutMs !== undefined ? { connectTimeoutMs: cfg.connectTimeoutMs } : {}),
    ...(cfg.heartbeatSeconds !== undefined ? { heartbeatSeconds: cfg.heartbeatSeconds } : {}),
    ...(cfg.tls !== undefined ? { tls: cfg.tls } : {}),
    ...(cfg.tlsRejectUnauthorized !== undefined ? { tlsRejectUnauthorized: cfg.tlsRejectUnauthorized } : {}),
    ...(cfg.tlsServerName !== undefined ? { tlsServerName: cfg.tlsServerName } : {}),
    ...(cfg.tlsCa !== undefined ? { tlsCa: cfg.tlsCa } : {}),
  };
}

/**
 * A thin, generic RabbitMQ client built on the core connection manager,
 * confirming publisher, and acknowledging consumer. Connects lazily.
 */
export class RabbitMqClient {
  private readonly manager: RabbitMqConnectionManager;
  private readonly exchange: string;
  private readonly publisher: RabbitMqPublisher;
  private readonly prefetch: number;

  constructor(cfg: RabbitMqPluginConfig) {
    this.manager = new RabbitMqConnectionManager(toRabbitMqOptions(cfg));
    this.exchange = cfg.exchange ?? 'street.events';
    this.prefetch = cfg.prefetch ?? 50;
    this.publisher = new RabbitMqPublisher(this.manager, this.exchange);
  }

  /** Publish a message to a routing key on the topic exchange (awaits confirm). */
  publish(routingKey: string, body: Buffer | string): Promise<void> {
    return this.publisher.publish(routingKey, body);
  }

  /**
   * Consume a queue bound to the given routing keys. The handler is awaited;
   * success → ack, throw → nack (routed to the DLX when configured).
   */
  consume(
    queue: string,
    routingKeys: string[],
    handler: (msg: DeliveredMessage) => Promise<void>,
    deadLetterExchange?: string,
  ): Promise<void> {
    const consumer = new RabbitMqConsumer(this.manager, this.exchange, {
      queue,
      routingKeys,
      prefetch: this.prefetch,
      ...(deadLetterExchange !== undefined ? { deadLetterExchange } : {}),
    });
    return consumer.consume(handler);
  }

  /** Close the underlying connection. */
  close(): Promise<void> {
    return this.manager.close();
  }
}

/**
 * RabbitMQ plugin. On load it constructs a {@link RabbitMqClient} (which
 * connects lazily on first publish/consume) and injects it into each request's
 * `ctx.state[stateKey]`.
 */
export class RabbitMqPlugin extends PluginModule {
  readonly name = RABBITMQ_PLUGIN_NAME;
  readonly version = RABBITMQ_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: RabbitMqPluginConfig | null = null;
  private client: RabbitMqClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validateRabbitMqConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new RabbitMqClient(cfg);
    const stateKey = cfg.stateKey ?? 'rabbitmq';
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  override async onUnload(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /** The live client (only after onLoad). */
  get messaging(): RabbitMqClient {
    if (!this.client) throw new PluginError('RabbitMQ plugin is not loaded');
    return this.client;
  }

  private _config(): RabbitMqPluginConfig {
    if (!this.config) this.config = validateRabbitMqConfig(this.raw);
    return this.config;
  }
}
