// src/types.ts
// Contracts for the unified notifications layer.

/** A channel identifier, e.g. 'email', 'sms', 'push', 'webhook', 'realtime'. */
export type ChannelName = string;

/** Delivery status for a single (recipient × channel) attempt. */
export type DeliveryStatus = 'sent' | 'skipped' | 'failed';

/** Who to notify. `addresses` maps a channel to the concrete destination. */
export interface NotificationRecipient {
  /** Stable recipient id (used for preference lookups). */
  id: string;
  /** Per-channel destination, e.g. { email: 'a@b.co', sms: '+15551234' }. */
  addresses?: Record<ChannelName, string>;
  /** Optional locale hint for templating. */
  locale?: string;
}

/** A notification to dispatch. */
export interface NotificationMessage {
  to: NotificationRecipient | NotificationRecipient[];
  /** Target channels. When omitted, the notifier's default channels are used. */
  channels?: ChannelName[];
  /** Literal subject (used when no template is given). */
  subject?: string;
  /** Literal body (used when no template is given). */
  body?: string;
  /** Template id resolved against the {@link TemplateStore}. */
  template?: string;
  /** Variables for template interpolation. */
  data?: Record<string, unknown>;
  /** Category for preference opt-out (e.g. 'marketing', 'security'). */
  category?: string;
  /** Arbitrary metadata passed through to channels. */
  metadata?: Record<string, unknown>;
}

/** A fully-resolved notification handed to a channel's `send`. */
export interface RenderedNotification {
  channel: ChannelName;
  recipient: NotificationRecipient;
  /** Resolved destination for this channel (from `recipient.addresses`). */
  address?: string;
  subject?: string;
  body: string;
  category?: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/** Result of one (recipient × channel) delivery attempt. */
export interface DeliveryResult {
  channel: ChannelName;
  recipientId: string;
  status: DeliveryStatus;
  /** Channel-provided id (message id), when returned. */
  id?: string;
  /** Reason for a skip or failure. */
  error?: string;
}

/** A pluggable delivery channel (email, SMS, push, webhook, realtime, …). */
export interface NotificationChannel {
  readonly name: ChannelName;
  /** Deliver a rendered notification; may return a provider message id. */
  send(rendered: RenderedNotification): Promise<{ id?: string } | void>;
}

/** A stored template: an optional subject and a body, both interpolated. */
export interface NotificationTemplate {
  subject?: string;
  body: string;
}

/** Resolves template ids to templates. */
export interface TemplateStore {
  get(id: string): NotificationTemplate | undefined;
}

/** Gates delivery by recipient/channel/category preference. */
export interface PreferenceStore {
  isEnabled(recipientId: string, channel: ChannelName, category?: string): Promise<boolean>;
}
