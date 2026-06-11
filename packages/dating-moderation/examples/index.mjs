// Runnable example: dating-app blocking and reporting on top of the core
// ModerationToolkit.
//
//   npm run build   # compile src -> dist
//   node examples/index.mjs
//
// Everything here is in-memory and offline — no server, network, or credentials
// are required.

import { DatingModeration } from '../dist/index.js';

const mod = new DatingModeration();

// 1) Reporting: alice reports bob; the report lands in the moderation queue.
const report = await mod.reportUser('alice', 'bob', 'inappropriate messages');
console.log('Filed report:', report.id, '->', report.target);

let queue = await mod.reviewQueue();
console.log('Pending reports:', queue.length);

// A moderator resolves it; the report leaves the pending queue.
await mod.resolveReport('moderator-1', report.id, 'user warned');
queue = await mod.reviewQueue();
console.log('Pending reports after resolution:', queue.length);

// 2) Blocking: alice blocks bob, so bob can no longer message alice.
await mod.blockUser('alice', 'bob');
console.log('bob -> alice allowed?', await mod.canMessage('bob', 'alice')); // false
console.log('alice -> bob allowed?', await mod.canMessage('alice', 'bob')); // true
console.log('blocked between alice & bob?', await mod.isBlockedBetween('alice', 'bob')); // true

// 3) Audit: every action is recorded in the append-only audit log.
const log = await mod.auditLog();
console.log(
  'Audit log:',
  log.map((e) => `${e.actor} ${e.action} ${e.target}`),
);
