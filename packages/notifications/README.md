# @streetjs/notifications

The StreetJS unified notification layer: a **channel-agnostic dispatcher** that
renders templates, honors per-recipient channel/category **preferences**, fans
out to pluggable channels (email/SMS/push/webhook/realtime), and returns a
result per delivery. A single channel failure never aborts the batch. **Zero
runtime dependencies**, ESM.

## Install

```bash
npm install @streetjs/notifications
```

## Usage

```ts
import { Notifier, MemoryChannel, FunctionChannel, InMemoryTemplateStore } from '@streetjs/notifications';

const email = new FunctionChannel('email', async (n) => {
  await myEmailClient.send({ to: n.address, subject: n.subject, html: n.body });
});
const sms = new FunctionChannel('sms', async (n) => myTwilio.send(n.address!, n.body));

const notifier = new Notifier({
  channels: [email, sms],
  templates: new InMemoryTemplateStore({
    welcome: { subject: 'Welcome, {{name}}', body: 'Hi {{name}}, thanks for joining.' },
  }),
});

const results = await notifier.notify({
  to: { id: 'u1', addresses: { email: 'ada@x.dev', sms: '+15550001' } },
  template: 'welcome',
  data: { name: 'Ada' },
});
// [{ channel: 'email', recipientId: 'u1', status: 'sent', id }, { channel: 'sms', ... }]
```

## Channels

Implement `NotificationChannel` (`{ name, send(rendered) }`) to wrap any
transport — `@streetjs/webhooks`, an email client, `plugin-twilio`,
`@streetjs/realtime`, etc. Two built-ins ship:

- **`MemoryChannel`** — records deliveries (tests/dev).
- **`FunctionChannel`** — wraps a plain async send function.

The rendered payload passed to a channel includes the resolved `address` (from
`recipient.addresses[channel]`), the rendered `subject`/`body`, `category`,
`data`, and `metadata`.

## Templates

Set `template` on a message to render from a `TemplateStore`; otherwise the
literal `subject`/`body` are used. Both are interpolated with `renderTemplate`
(`{{ var }}`, dotted paths like `{{ recipient.id }}`, objects JSON-encoded,
missing values → empty). It's deliberately logic-free — richer templating
belongs in a dedicated engine.

## Preferences

`InMemoryPreferenceStore` gates delivery: channels are enabled by default;
recipients can be opted out per channel (`disableChannel`) or per
`channel:category` (`disableCategory`), and categories can be marked
`markMandatory` (e.g. `security`) so they are never suppressed. Supply any
`PreferenceStore` to back it with a database. The default is `AllowAllPreferences`.

## Results

`notify` returns one `DeliveryResult` per recipient × channel:

| status | meaning |
| --- | --- |
| `sent` | the channel accepted it (with an optional provider `id`) |
| `skipped` | preference opt-out |
| `failed` | unknown channel, or the channel threw (see `error`) |

An unknown template throws `NotificationError` up front (a config error); runtime
channel failures are captured per-delivery so the rest of the batch proceeds.

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/notifications
```

## License

MIT — see [LICENSE](./LICENSE).
