import { CreateCommand } from '../packages/cli/dist/commands/create.js';
import { writeFileSync } from 'node:fs';

const c = new CreateCommand();
const base = new URL('./app/', import.meta.url);
const w = (rel, content) => writeFileSync(new URL(rel, base), content);

w('lib/marzpay.ts', c.renderNextMarzPayLib());
w('billing/page.tsx', c.renderNextBillingPage());
w('billing/success/page.tsx', c.renderNextBillingSuccessPage());
w('billing/cancel/page.tsx', c.renderNextBillingCancelPage());
w('api/webhooks/marzpay/route.ts', c.renderNextMarzPayWebhookRoute());
console.log('rendered files');
