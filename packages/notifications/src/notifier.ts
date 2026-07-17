// src/notifier.ts
// The Notifier: renders, gates by preference, fans out to channels, collects results.

import { AllowAllPreferences } from './preferences.js';
import { renderTemplate } from './template.js';
import type {
  ChannelName,
  DeliveryResult,
  NotificationChannel,
  NotificationMessage,
  NotificationRecipient,
  PreferenceStore,
  RenderedNotification,
  TemplateStore,
} from './types.js';

/** Raised for configuration errors (unknown template, no channels registered). */
export class NotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationError';
  }
}

export interface NotifierOptions {
  /** Channels available for delivery, keyed by their `name`. */
  channels: NotificationChannel[];
  /** Template source for `message.template`. */
  templates?: TemplateStore;
  /** Preference gate. Defaults to {@link AllowAllPreferences}. */
  preferences?: PreferenceStore;
  /** Channels used when a message doesn't specify any. Defaults to all channels. */
  defaultChannels?: ChannelName[];
  /** Observer invoked for every delivery result (sent/skipped/failed). */
  onResult?: (result: DeliveryResult) => void;
}

/**
 * Channel-agnostic notification dispatcher. For each recipient × resolved
 * channel it checks preferences, renders the subject/body (from a template or
 * the literal fields), invokes the channel, and records a {@link DeliveryResult}.
 * A single channel failure never aborts the batch — it is captured as a `failed`
 * result so the rest still deliver.
 */
export class Notifier {
  private readonly channels: Map<ChannelName, NotificationChannel>;
  private readonly templates: TemplateStore | undefined;
  private readonly preferences: PreferenceStore;
  private readonly defaultChannels: ChannelName[];
  private readonly onResult: ((result: DeliveryResult) => void) | undefined;

  constructor(options: NotifierOptions) {
    if (!options?.channels?.length) {
      throw new NotificationError('Notifier requires at least one channel');
    }
    this.channels = new Map(options.channels.map((c) => [c.name, c]));
    this.templates = options.templates;
    this.preferences = options.preferences ?? new AllowAllPreferences();
    this.defaultChannels = options.defaultChannels ?? [...this.channels.keys()];
    this.onResult = options.onResult;
  }

  /** Registered channel names, in registration order. */
  channelNames(): ChannelName[] {
    return [...this.channels.keys()];
  }

  /** Dispatch a notification; resolves to one result per recipient × channel. */
  async notify(message: NotificationMessage): Promise<DeliveryResult[]> {
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    const targetChannels = message.channels ?? this.defaultChannels;

    // Resolve subject/body once (fail fast on an unknown template).
    let subjectTemplate = message.subject;
    let bodyTemplate = message.body ?? '';
    if (message.template !== undefined) {
      const tpl = this.templates?.get(message.template);
      if (!tpl) throw new NotificationError(`Unknown template: ${message.template}`);
      subjectTemplate = tpl.subject;
      bodyTemplate = tpl.body;
    }

    const data = message.data ?? {};
    const metadata = message.metadata ?? {};
    const results: DeliveryResult[] = [];

    for (const recipient of recipients) {
      for (const channelName of targetChannels) {
        results.push(await this.deliverOne(
          recipient, channelName, subjectTemplate, bodyTemplate, data, metadata, message.category,
        ));
      }
    }
    return results;
  }

  private async deliverOne(
    recipient: NotificationRecipient,
    channelName: ChannelName,
    subjectTemplate: string | undefined,
    bodyTemplate: string,
    data: Record<string, unknown>,
    metadata: Record<string, unknown>,
    category: string | undefined,
  ): Promise<DeliveryResult> {
    const record = (result: DeliveryResult): DeliveryResult => {
      this.onResult?.(result);
      return result;
    };

    const channel = this.channels.get(channelName);
    if (!channel) {
      return record({ channel: channelName, recipientId: recipient.id, status: 'failed', error: 'unknown channel' });
    }

    const enabled = await this.preferences.isEnabled(recipient.id, channelName, category);
    if (!enabled) {
      return record({ channel: channelName, recipientId: recipient.id, status: 'skipped', error: 'preference opt-out' });
    }

    const rendered: RenderedNotification = {
      channel: channelName,
      recipient,
      body: renderTemplate(bodyTemplate, { ...data, recipient }),
      data,
      metadata,
    };
    const address = recipient.addresses?.[channelName];
    if (address !== undefined) rendered.address = address;
    if (subjectTemplate !== undefined) rendered.subject = renderTemplate(subjectTemplate, { ...data, recipient });
    if (category !== undefined) rendered.category = category;

    try {
      const res = await channel.send(rendered);
      const result: DeliveryResult = { channel: channelName, recipientId: recipient.id, status: 'sent' };
      if (res && res.id !== undefined) result.id = res.id;
      return record(result);
    } catch (err) {
      return record({
        channel: channelName,
        recipientId: recipient.id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
