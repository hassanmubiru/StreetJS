// Runnable example: publishing posts and reading a home timeline.
//
//   npm run example -w packages/social-feed
//
// Uses the in-memory stores (no database required) and composes the follow
// graph from @streetjs/social-users.

import { FollowService } from '@streetjs/social-users';
import { FeedService } from '@streetjs/social-feed';

const follows = new FollowService();
const feed = new FeedService({ followees: follows, includeSelf: false });

// reader follows ada and bob (but not carol).
await follows.follow('reader', 'ada');
await follows.follow('reader', 'bob');

await feed.publish({ authorId: 'ada', text: 'ada: good morning' });
await feed.publish({ authorId: 'carol', text: 'carol: not followed' });
await feed.publish({ authorId: 'bob', text: 'bob: shipping today' });
await feed.publish({ authorId: 'ada', text: 'ada: coffee first' });

console.log('reader home timeline (newest first):');
for (const p of await feed.homeTimeline('reader')) {
  console.log(`  [seq ${p.seq}] ${p.text}`);
}

console.log('\nada user timeline:');
for (const p of await feed.userTimeline('ada')) {
  console.log(`  [seq ${p.seq}] ${p.text}`);
}

// Cursor pagination: first page of 1, then the next.
const page1 = await feed.homeTimeline('reader', { limit: 1 });
const page2 = await feed.homeTimeline('reader', { limit: 1, before: page1[0].seq });
console.log('\npaged: page1=%o page2=%o', page1.map((p) => p.text), page2.map((p) => p.text));
