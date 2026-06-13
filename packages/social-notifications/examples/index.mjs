// Runnable example: the notification inbox.
//
//   npm run example -w packages/social-notifications
//
// Uses the in-memory store (no database required).

import { NotificationService } from '@streetjs/social-notifications';

const inbox = new NotificationService();

// Various events targeting ada.
await inbox.onFollow('ada', 'bob');
await inbox.onComment('ada', 'cat', 'post-1');
await inbox.onReaction('ada', 'dan', 'post-1', '🔥');
console.log('self-notification suppressed ->', await inbox.onFollow('ada', 'ada')); // null

console.log('\nunread count:', await inbox.unreadCount('ada')); // 3
console.log('inbox (newest first):');
for (const n of await inbox.list('ada')) {
  const extra = n.data ? ` ${JSON.stringify(n.data)}` : '';
  console.log(`  ${n.read ? '·' : '•'} ${n.type} from ${n.actorId}${n.subjectId ? ` on ${n.subjectId}` : ''}${extra}`);
}

// Mark the newest read, then mark the rest read.
const [latest] = await inbox.list('ada');
await inbox.markRead(latest.id, 'ada');
console.log('\nunread after reading latest:', await inbox.unreadCount('ada')); // 2
console.log('marked read by markAllRead:', await inbox.markAllRead('ada')); // 2
console.log('unread now:', await inbox.unreadCount('ada')); // 0
