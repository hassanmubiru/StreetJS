// Runnable example: threaded comments, mentions, and reactions.
//
//   npm run example -w packages/social-comments
//
// Uses the in-memory store (no database required).

import { CommentService } from '@streetjs/social-comments';

const comments = new CommentService();

const root = await comments.comment({
  subjectId: 'post-42',
  authorId: 'ada',
  text: 'Shipping the new feed today, cc @bob @carol',
});
console.log('root mentions:', root.mentions); // ['bob', 'carol']

const reply = await comments.comment({
  subjectId: 'post-42',
  authorId: 'bob',
  text: 'nice work @ada',
  parentId: root.id,
});

console.log('\nthread:');
for (const c of await comments.thread('post-42')) {
  console.log(`  ${c.parentId ? '  ↳ ' : ''}${c.authorId}: ${c.text}`);
}

console.log('\nreplies to root:', (await comments.replies(root.id)).map((c) => c.text));
console.log('comments mentioning @ada:', (await comments.mentionsOf('ada')).map((c) => c.id === reply.id ? 'reply' : 'root'));

await comments.react(root.id, 'bob', '🚀');
await comments.react(root.id, 'carol', '🚀');
await comments.react(root.id, 'carol', '❤️');
console.log('\nroot reactions:', await comments.reactions(root.id)); // { '🚀': 2, '❤️': 1 }
await comments.unreact(root.id, 'bob', '🚀');
console.log('after bob un-reacts:', await comments.reactions(root.id)); // { '🚀': 1, '❤️': 1 }
