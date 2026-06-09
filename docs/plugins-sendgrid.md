---
layout: default
title: "Official Plugin: SendGrid (email)"
nav_exclude: true
---

# Official Plugin: SendGrid (email)

`SendGridPlugin` is the second official reference plugin for the Street
[plugin system](./plugins.md). It sends email via the SendGrid v3 API with no
third-party SDK — pure `node:https`. Its request-building is deterministic and
verified offline; the network send is a thin wrapper.

## Manifest

```ts
import { sendGridPluginManifest } from 'streetjs';
sendGridPluginManifest();
// { name: 'street-plugin-sendgrid', version: '1.0.0',
//   capabilities: ['email','notifications','sendgrid'],
//   permissions: ['net','secrets','middleware'] }
```

## Configuration

```ts
interface SendGridPluginConfig {
  apiKey: string;        // required
  defaultFrom?: string;  // fallback sender
  stateKey?: string;     // ctx.state key for the injected client (default 'mail')
}
```

## Install through the PluginHost (signed)

```ts
import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest, SendGridPlugin, sendGridPluginManifest } from 'streetjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({ grantedPermissions: ['net','secrets','middleware'], publicKey });
host.register(new SendGridPlugin({ apiKey: process.env.SENDGRID_API_KEY!, defaultFrom: 'noreply@acme.com' }),
              signManifest(sendGridPluginManifest(), privateKey));
await host.enable('street-plugin-sendgrid');
```

## Using it

The plugin injects a `SendGridClient` into `ctx.state[stateKey]` (default `mail`):

```ts
for (const mw of host.middlewaresOf('street-plugin-sendgrid')) app.use(mw);

// in a handler:
const mail = ctx.state['mail']; // SendGridClient
await mail.send({ to: 'user@acme.com', subject: 'Welcome', html: '<h1>Hi</h1>' });
```

## Offline-verifiable request building

```ts
import { SendGridClient } from 'streetjs';
const req = new SendGridClient({ apiKey: 'SG.x', defaultFrom: 'a@b.com' })
  .buildMailSendRequest({ to: 'u@b.com', subject: 'Hi', text: 'hello' });
// req.url === 'https://api.sendgrid.com/v3/mail/send'
// req.headers.authorization === 'Bearer SG.x'
// JSON.parse(req.body) → { personalizations:[{to:[{email}]}], from, subject, content }
```

## Verification

`packages/core/src/tests/plugin-sendgrid.test.ts` (7 tests): config schema,
deterministic request building (bearer auth + v3 JSON body, html + from override,
missing from/to/content rejection), signed-manifest install through `PluginHost`,
permission gating, lifecycle + sandbox injection, and invalid-config enable
failure.

```bash
cd packages/core && npx tsc && node --test dist/src/tests/plugin-sendgrid.test.js
```
