/**
 * @streetjs/notifications — the StreetJS unified notification layer.
 *
 * A channel-agnostic dispatcher: register pluggable {@link NotificationChannel}s
 * (email/SMS/push/webhook/realtime — wrapping the relevant StreetJS package),
 * then `notify(...)` renders the subject/body (literal or from a
 * {@link TemplateStore}), gates each recipient × channel through a
 * {@link PreferenceStore}, fans out, and returns a {@link DeliveryResult} per
 * attempt. A single channel failure never aborts the batch. Zero runtime
 * dependencies. Public API only.
 *
 * ```ts
 * import { Notifier, MemoryChannel, InMemoryTemplateStore } from '@streetjs/notifications';
 *
 * const email = new MemoryChannel('email');
 * const notifier = new Notifier({
 *   channels: [email],
 *   templates: new InMemoryTemplateStore({ welcome: { subject: 'Hi {{name}}', body: 'Welcome, {{name}}!' } }),
 * });
 * await notifier.notify({ to: { id: 'u1', addresses: { email: 'a@b.co' } }, template: 'welcome', data: { name: 'Ada' } });
 * ```
 */

export { Notifier, NotificationError } from './notifier.js';
export type { NotifierOptions } from './notifier.js';

export { MemoryChannel, FunctionChannel } from './channels.js';

export { renderTemplate, InMemoryTemplateStore } from './template.js';

export { InMemoryPreferenceStore, AllowAllPreferences } from './preferences.js';

export type {
  ChannelName,
  DeliveryStatus,
  DeliveryResult,
  NotificationChannel,
  NotificationMessage,
  NotificationRecipient,
  NotificationTemplate,
  RenderedNotification,
  TemplateStore,
  PreferenceStore,
} from './types.js';
