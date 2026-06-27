// packages/plugin-kafka/src/index.ts
// Official StreetJS plugin: Apache Kafka streaming.
//
// A standalone package (outside streetjs core) that extends the core
// `PluginModule` SDK and wraps the dependency-free `KafkaStreamTransport`
// shipped by streetjs (a from-scratch Kafka protocol client — no vendor SDK).
// It validates connection config and injects a ready transport into each
// request via the sandboxed middleware surface (requires 'middleware').

import {
  PluginModule, PluginError, KafkaStreamTransport,
  type SandboxedApp, type PluginManifest, type KafkaClientOptions,
} from 'streetjs';

export const KAFKA_PLUGIN_NAME = 'street-plugin-kafka';
export const KAFKA_PLUGIN_VERSION = '1.0.0';

/** Configuration schema for the Kafka plugin. */
export interface KafkaPluginConfig {
  /** Bootstrap brokers as "host:port" strings. Either this or host+port is required. */
  brokers?: string[];
  /** Single-broker host (used when `brokers` is omitted). */
  host?: string;
  /** Single-broker port (used when `brokers` is omitted). Default 9092. */
  port?: number;
  /** Client id advertised to the cluster. Default 'street-kafka'. */
  clientId?: string;
  /** Connect timeout in ms. Default 10000. */
  connectTimeoutMs?: number;
  /** State key under which the transport is injected. Default 'kafka'. */
  stateKey?: string;
  /** Connect over TLS (Kafka SSL / SASL_SSL listener). Default false. */
  tls?: boolean;
  /** When TLS is on, verify the broker certificate chain. Default true. */
  tlsRejectUnauthorized?: boolean;
  /** When TLS is on, the SNI server name (defaults to the broker host). */
  tlsServerName?: string;
  /** When TLS is on, a PEM CA bundle to trust. */
  tlsCa?: string;
}

/** The unsigned manifest for the Kafka plugin (sign it via the build step). */
export function kafkaPluginManifest(): PluginManifest {
  return {
    name: KAFKA_PLUGIN_NAME,
    version: KAFKA_PLUGIN_VERSION,
    capabilities: ['messaging', 'streaming', 'kafka'],
    permissions: ['net', 'middleware'],
  };
}

/** A "host:port" broker string is valid when both parts are present and the port is in range. */
export function isValidBroker(broker: string): boolean {
  if (typeof broker !== 'string') return false;
  const idx = broker.lastIndexOf(':');
  if (idx <= 0 || idx === broker.length - 1) return false;
  const host = broker.slice(0, idx);
  const port = Number(broker.slice(idx + 1));
  return host.trim() !== '' && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Validate raw config against the Kafka plugin's schema. Throws
 * {@link PluginError} with a precise message on the first violation.
 */
export function validateKafkaConfig(input: unknown): KafkaPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('Kafka plugin config must be an object');
  }
  const o = input as Record<string, unknown>;

  const hasBrokers = o['brokers'] !== undefined;
  const hasHost = o['host'] !== undefined;
  if (!hasBrokers && !hasHost) {
    throw new PluginError('Kafka plugin config: provide "brokers" (string[]) or "host"');
  }
  if (hasBrokers) {
    const brokers = o['brokers'];
    if (!Array.isArray(brokers) || brokers.length === 0) {
      throw new PluginError('Kafka plugin config: "brokers" must be a non-empty array of "host:port" strings');
    }
    for (const b of brokers) {
      if (typeof b !== 'string' || !isValidBroker(b)) {
        throw new PluginError(`Kafka plugin config: invalid broker "${String(b)}" (expected "host:port")`);
      }
    }
  }
  if (hasHost && (typeof o['host'] !== 'string' || (o['host'] as string).trim() === '')) {
    throw new PluginError('Kafka plugin config: "host" must be a non-empty string');
  }
  if (o['port'] !== undefined) {
    const port = o['port'];
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new PluginError('Kafka plugin config: "port" must be an integer in [1, 65535]');
    }
  }
  if (o['clientId'] !== undefined && typeof o['clientId'] !== 'string') {
    throw new PluginError('Kafka plugin config: "clientId" must be a string');
  }
  if (o['connectTimeoutMs'] !== undefined && (typeof o['connectTimeoutMs'] !== 'number' || o['connectTimeoutMs'] <= 0)) {
    throw new PluginError('Kafka plugin config: "connectTimeoutMs" must be a positive number');
  }
  if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string') {
    throw new PluginError('Kafka plugin config: "stateKey" must be a string');
  }
  if (o['tls'] !== undefined && typeof o['tls'] !== 'boolean') {
    throw new PluginError('Kafka plugin config: "tls" must be a boolean');
  }
  if (o['tlsRejectUnauthorized'] !== undefined && typeof o['tlsRejectUnauthorized'] !== 'boolean') {
    throw new PluginError('Kafka plugin config: "tlsRejectUnauthorized" must be a boolean');
  }
  for (const k of ['tlsServerName', 'tlsCa'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      throw new PluginError(`Kafka plugin config: "${k}" must be a string`);
    }
  }

  return {
    ...(o['brokers'] !== undefined ? { brokers: o['brokers'] as string[] } : {}),
    ...(o['host'] !== undefined ? { host: o['host'] as string } : {}),
    ...(o['port'] !== undefined ? { port: o['port'] as number } : {}),
    ...(o['clientId'] !== undefined ? { clientId: o['clientId'] as string } : {}),
    ...(o['connectTimeoutMs'] !== undefined ? { connectTimeoutMs: o['connectTimeoutMs'] as number } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
    ...(o['tls'] !== undefined ? { tls: o['tls'] as boolean } : {}),
    ...(o['tlsRejectUnauthorized'] !== undefined ? { tlsRejectUnauthorized: o['tlsRejectUnauthorized'] as boolean } : {}),
    ...(o['tlsServerName'] !== undefined ? { tlsServerName: o['tlsServerName'] as string } : {}),
    ...(o['tlsCa'] !== undefined ? { tlsCa: o['tlsCa'] as string } : {}),
  };
}

/** Translate the plugin config into the core `KafkaClientOptions`. */
export function toClientOptions(cfg: KafkaPluginConfig): KafkaClientOptions {
  return {
    ...(cfg.brokers !== undefined ? { brokers: cfg.brokers } : {}),
    ...(cfg.host !== undefined ? { host: cfg.host } : {}),
    ...(cfg.port !== undefined ? { port: cfg.port } : {}),
    ...(cfg.clientId !== undefined ? { clientId: cfg.clientId } : {}),
    ...(cfg.connectTimeoutMs !== undefined ? { connectTimeoutMs: cfg.connectTimeoutMs } : {}),
    ...(cfg.tls !== undefined ? { tls: cfg.tls } : {}),
    ...(cfg.tlsRejectUnauthorized !== undefined ? { tlsRejectUnauthorized: cfg.tlsRejectUnauthorized } : {}),
    ...(cfg.tlsServerName !== undefined ? { tlsServerName: cfg.tlsServerName } : {}),
    ...(cfg.tlsCa !== undefined ? { tlsCa: cfg.tlsCa } : {}),
  };
}

/**
 * Kafka plugin. On load it constructs a {@link KafkaStreamTransport} (which
 * connects lazily on first publish/subscribe) and injects it into each
 * request's `ctx.state[stateKey]`.
 */
export class KafkaPlugin extends PluginModule {
  readonly name = KAFKA_PLUGIN_NAME;
  readonly version = KAFKA_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: KafkaPluginConfig | null = null;
  private transport: KafkaStreamTransport | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validateKafkaConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.transport = new KafkaStreamTransport(toClientOptions(cfg));
    const stateKey = cfg.stateKey ?? 'kafka';
    const transport = this.transport;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = transport;
      await next();
    });
  }

  override async onUnload(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  /** The live transport (only after onLoad). */
  get streaming(): KafkaStreamTransport {
    if (!this.transport) throw new PluginError('Kafka plugin is not loaded');
    return this.transport;
  }

  private _config(): KafkaPluginConfig {
    if (!this.config) this.config = validateKafkaConfig(this.raw);
    return this.config;
  }
}
