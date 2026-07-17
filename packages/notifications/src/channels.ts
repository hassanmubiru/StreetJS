// src/channels.ts
// Built-in channels: an in-memory recorder and a function-backed adapter.
// Real transports (email/SMS/push/webhook/realtime) implement NotificationChannel
// and wrap the relevant StreetJS package (webhooks, sendgrid, twilio, realtime…).

import type { ChannelName, NotificationChannel, RenderedNotification } from './types.js';

/**
 * Records every delivery in memory. Useful as a test double and for local dev.
 */
export class MemoryChannel implements NotificationChannel {
  readonly name: ChannelName;
  readonly sent: RenderedNotification[] = [];
  private seq = 0;

  constructor(name: ChannelName = 'memory') {
    this.name = name;
  }

  async send(rendered: RenderedNotification): Promise<{ id: string }> {
    this.sent.push(rendered);
    return { id: `${this.name}-${this.seq++}` };
  }
}

/**
 * Wraps a plain async function as a channel. The simplest way to plug an
 * existing sender (e.g. a `@streetjs/webhooks` dispatcher or an email client)
 * into the notifier without writing a class.
 */
export class FunctionChannel implements NotificationChannel {
  readonly name: ChannelName;
  private readonly fn: (rendered: RenderedNotification) => Promise<{ id?: string } | void> | { id?: string } | void;

  constructor(
    name: ChannelName,
    fn: (rendered: RenderedNotification) => Promise<{ id?: string } | void> | { id?: string } | void,
  ) {
    this.name = name;
    this.fn = fn;
  }

  async send(rendered: RenderedNotification): Promise<{ id?: string } | void> {
    return this.fn(rendered);
  }
}
