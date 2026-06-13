// End-to-end smoke test for the Dating reference app.
//   node examples/reference-apps/dating/smoke-test.mjs

import assert from 'node:assert/strict';
import { isEncryptedField } from 'streetjs';
import { createDating } from './server.mjs';

const app = createDating();
const { profiles } = app;
let failures = 0;
const check = async (n, fn) => { try { await fn(); console.log('  ok  ' + n); } catch (e) { failures++; console.log('  FAIL ' + n + ': ' + e.message); } };

await check('profile bio is encrypted at rest', async () => {
  const ada = await profiles.create({ userId: 'ada', displayName: 'Ada', bio: 'loves hiking' });
  assert.ok(isEncryptedField(ada.bio));
  assert.ok(!JSON.stringify(ada.bio).includes('loves hiking'));
  assert.equal(await profiles.readBio('ada'), 'loves hiking');
});

await profiles.create({ userId: 'lin', displayName: 'Lin', bio: 'enjoys jazz' });

await check('one-sided like does not match', async () => {
  const r = await profiles.like('ada', 'lin');
  assert.equal(r.matched, false);
  assert.equal(await profiles.isMatch('ada', 'lin'), false);
});

await check('reciprocal like creates a match (order-independent)', async () => {
  const r = await profiles.like('lin', 'ada');
  assert.equal(r.matched, true);
  assert.equal(await profiles.isMatch('ada', 'lin'), true);
  assert.equal(await profiles.isMatch('lin', 'ada'), true);
});

await app.close();
console.log(failures === 0 ? '\n✅ dating reference app: all checks passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
