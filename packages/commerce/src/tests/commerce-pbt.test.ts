// commerce-pbt.test.ts
// Property-based test for the headline guarantee: NO OVERSELL.
//
// Across a random interleaving of restocks and checkouts (some of which may
// fail payment), inventory invariants must always hold:
//   I1: available = onHand - reserved >= 0 at all times.
//   I2: reserved returns to 0 once no checkout is mid-flight.
//   I3: units actually sold (committed) never exceed units restocked.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { CommerceService, FakeGateway, InsufficientStockError, PaymentError } from '../index.js';

type Op =
  | { t: 'restock'; qty: number }
  | { t: 'buy'; qty: number; fail: boolean };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant('restock' as const), qty: fc.integer({ min: 1, max: 10 }) }),
  fc.record({ t: fc.constant('buy' as const), qty: fc.integer({ min: 1, max: 6 }), fail: fc.boolean() }),
);

describe('Property: inventory never oversells', () => {
  it('available stays >= 0, reserved settles to 0, sold <= restocked', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 50 }), async (ops) => {
        let cnt = 0;
        const okGateway = new FakeGateway({ idGen: () => `p${++cnt}` });
        const failGateway = new FakeGateway({ declineAtOrAbove: 1 });
        const c = new CommerceService({ now: () => 1, idGen: () => `o${++cnt}` });
        c.createProduct({ name: 'P', priceCents: 100, id: 'prod' });

        let restocked = 0;
        let sold = 0;

        for (let i = 0; i < ops.length; i++) {
          const op = ops[i]!;
          if (op.t === 'restock') {
            c.restock('prod', op.qty);
            restocked += op.qty;
          } else {
            const cartId = `cart${i}`;
            c.addToCart(cartId, 'prod', op.qty);
            const before = c.availability('prod');
            try {
              await c.checkout(cartId, { gateway: op.fail ? failGateway : okGateway });
              sold += op.qty; // committed
            } catch (err) {
              assert.ok(err instanceof InsufficientStockError || err instanceof PaymentError);
            }
            // I1: availability never negative, before and after.
            assert.ok(before.available >= 0);
            const after = c.availability('prod');
            assert.ok(after.available >= 0, `available negative: ${JSON.stringify(after)}`);
            // I2: nothing is mid-flight between checkouts → reserved settles to 0.
            assert.equal(after.reserved, 0, `reserved not settled: ${JSON.stringify(after)}`);
          }
        }

        const final = c.availability('prod');
        // I3: units sold never exceed units restocked; on-hand reconciles.
        assert.ok(sold <= restocked, `sold ${sold} > restocked ${restocked}`);
        assert.equal(final.onHand, restocked - sold);
        assert.equal(final.reserved, 0);
      }),
      { numRuns: 200 },
    );
  });
});
