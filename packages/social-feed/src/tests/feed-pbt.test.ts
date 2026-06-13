// feed-pbt.test.ts
// Property-based tests for timeline generation against a reference model.
//
// Properties:
//   P1 (ordering): every timeline is strictly descending by seq.
//   P2 (home membership): the home timeline of u contains exactly the posts
//      authored by the set {followed by u} (+u if includeSelf), most-recent
//      first, truncated to limit.
//   P3 (cursor): paginating with `before` walks the full timeline without gaps
//      or duplicates and yields the same set as an unpaginated read.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { FollowService } from '@streetjs/social-users';
import { FeedService, type Post } from '../index.js';

const USERS = ['u0', 'u1', 'u2', 'u3'] as const;
const userArb = fc.constantFrom(...USERS);

type Action =
  | { t: 'follow'; from: (typeof USERS)[number]; to: (typeof USERS)[number] }
  | { t: 'post'; author: (typeof USERS)[number] };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ t: fc.constant('follow' as const), from: userArb, to: userArb }),
  fc.record({ t: fc.constant('post' as const), author: userArb }),
);

function isDescendingBySeq(posts: Post[]): boolean {
  for (let i = 1; i < posts.length; i++) {
    if (posts[i - 1]!.seq <= posts[i]!.seq) return false;
  }
  return true;
}

describe('Property: feed timelines match a reference model', () => {
  it('P1+P2: home timeline = posts by followed authors (+self), newest first', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { maxLength: 50 }), userArb, async (actions, reader) => {
        const follows = new FollowService({ now: () => 1 });
        const feed = new FeedService({ followees: follows, includeSelf: true, now: () => 1 });

        // Reference model: ordered list of {author, seq} as posts are created.
        const model: { author: string; seq: number }[] = [];
        for (const a of actions) {
          if (a.t === 'follow') {
            if (a.from !== a.to) await follows.follow(a.from, a.to);
          } else {
            const p = await feed.publish({ authorId: a.author, text: 'x' });
            model.push({ author: a.author, seq: p.seq });
          }
        }

        const followed = new Set(await follows.following(reader));
        followed.add(reader); // includeSelf

        const expected = model
          .filter((m) => followed.has(m.author))
          .sort((x, y) => y.seq - x.seq)
          .slice(0, 100)
          .map((m) => m.seq);

        const home = await feed.homeTimeline(reader, { limit: 100 });
        assert.ok(isDescendingBySeq(home), 'home timeline must be strictly descending by seq');
        assert.deepEqual(home.map((p) => p.seq), expected);
      }),
      { numRuns: 150 },
    );
  });

  it('P3: cursor pagination reproduces the full timeline with no gaps/dupes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 25 }), fc.integer({ min: 1, max: 4 }), async (n, pageSize) => {
        const follows = new FollowService({ now: () => 1 });
        const feed = new FeedService({ followees: follows, now: () => 1 });
        for (let i = 0; i < n; i++) await feed.publish({ authorId: 'ada', text: `p${i}` });

        const full = await feed.userTimeline('ada', { limit: 1000 });

        // Walk pages using the before cursor.
        const walked: number[] = [];
        let before: number | undefined;
        for (;;) {
          const page = await feed.userTimeline('ada', { limit: pageSize, before });
          if (page.length === 0) break;
          for (const p of page) walked.push(p.seq);
          before = page[page.length - 1]!.seq;
        }

        assert.deepEqual(walked, full.map((p) => p.seq));
        assert.equal(new Set(walked).size, walked.length, 'no duplicates across pages');
      }),
      { numRuns: 100 },
    );
  });
});
