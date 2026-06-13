// Runnable example: the social follow graph.
//
//   npm run example -w packages/social-users
//
// Demonstrates directional follows, idempotency, mutual detection, and counts
// using the in-memory store (no database required).

import { FollowService } from '@streetjs/social-users';

const social = new FollowService();

// 1) Directional follow.
console.log('ada follows lin ->', await social.follow('ada', 'lin')); // { changed: true, mutual: false }
console.log('ada -> lin?', await social.isFollowing('ada', 'lin')); // true
console.log('lin -> ada?', await social.isFollowing('lin', 'ada')); // false

// 2) Idempotent.
console.log('ada follows lin again ->', await social.follow('ada', 'lin')); // { changed: false, ... }

// 3) Reciprocal follow becomes mutual.
console.log('lin follows ada ->', await social.follow('lin', 'ada')); // { changed: true, mutual: true }
console.log('mutual?', await social.isMutual('ada', 'lin')); // true

// 4) Fan-out + counts.
await social.follow('bob', 'lin');
await social.follow('cat', 'lin');
console.log('lin followers:', await social.followers('lin')); // ['ada', 'bob', 'cat']
console.log('lin counts:', await social.counts('lin')); // { followers: 3, following: 1 }

// 5) Unfollow.
console.log('ada unfollows lin ->', await social.unfollow('ada', 'lin')); // { changed: true }
console.log('lin counts now:', await social.counts('lin')); // { followers: 2, following: 1 }
