// comment-pbt.test.ts
// Property-based tests for reactions and mention extraction.
//
// Properties:
//   P1 (reaction set semantics): after any sequence of react/unreact ops, the
//      counts equal a reference multiset model, and react/unreact are idempotent.
//   P2 (mention idempotence): extractMentions is idempotent on its own rendered
//      handles and never returns duplicates.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { CommentService, extractMentions } from '../index.js';

const USERS = ['u0', 'u1', 'u2'] as const;
const REACTIONS = ['like', 'love', 'wow'] as const;

interface RxOp {
  kind: 'react' | 'unreact';
  user: (typeof USERS)[number];
  reaction: (typeof REACTIONS)[number];
}

const rxOpArb: fc.Arbitrary<RxOp> = fc.record({
  kind: fc.constantFrom('react', 'unreact'),
  user: fc.constantFrom(...USERS),
  reaction: fc.constantFrom(...REACTIONS),
});

describe('Property: reactions match a set-based reference model', () => {
  it('P1: counts equal the model and ops are idempotent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(rxOpArb, { maxLength: 40 }), async (ops) => {
        const svc = new CommentService({ now: () => 1 });
        const c = await svc.comment({ subjectId: 'p', authorId: 'ada', text: 'x' });

        const model = new Set<string>(); // "user\u0000reaction"
        for (const op of ops) {
          const key = `${op.user}\u0000${op.reaction}`;
          if (op.kind === 'react') {
            const changed = await svc.react(c.id, op.user, op.reaction);
            assert.equal(changed, !model.has(key), 'react changed-flag must match novelty');
            model.add(key);
          } else {
            const changed = await svc.unreact(c.id, op.user, op.reaction);
            assert.equal(changed, model.has(key), 'unreact changed-flag must match presence');
            model.delete(key);
          }
        }

        const expected: Record<string, number> = {};
        for (const key of model) {
          const reaction = key.split('\u0000')[1]!;
          expected[reaction] = (expected[reaction] ?? 0) + 1;
        }
        assert.deepEqual(await svc.reactions(c.id), expected);
      }),
      { numRuns: 200 },
    );
  });
});

describe('Property: mention extraction', () => {
  it('P2: idempotent and duplicate-free on rendered handles', () => {
    const handleArb = fc.array(
      fc.stringMatching(/^[a-z][a-z0-9_]{0,12}$/),
      { minLength: 0, maxLength: 8 },
    );
    fc.assert(
      fc.property(handleArb, (handles) => {
        const text = handles.map((h) => `@${h}`).join(' ');
        const once = extractMentions(text);
        // No duplicates.
        assert.equal(new Set(once).size, once.length);
        // Idempotent: re-rendering the extracted handles yields the same set.
        const twice = extractMentions(once.map((h) => `@${h}`).join(' '));
        assert.deepEqual(twice, once);
        // Every result is a normalized handle present in the input (lowercased).
        const lowered = new Set(handles.map((h) => h.toLowerCase()));
        for (const h of once) assert.ok(lowered.has(h));
      }),
      { numRuns: 200 },
    );
  });
});
