// admin-pbt.test.ts
// Property-based tests for authorization and audit invariants.
//
// Properties:
//   P1 (audit completeness): the number of audit events equals the number of
//      state-changing operations actually applied (no-ops don't log).
//   P2 (suspension dominates): a suspended user is denied every permission,
//      regardless of roles.
//   P3 (grant monotonicity): granting a permission to a role never removes any
//      previously-allowed access for its users.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { AdminService } from '../index.js';

describe('Property: admin authorization & audit invariants', () => {
  it('P2: suspended users are denied everything', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}:[a-z]{1,6}$/), { maxLength: 6 }),
        fc.stringMatching(/^[a-z]{1,6}:[a-z]{1,6}$/),
        (perms, probe) => {
          let n = 0;
          const a = new AdminService({ now: () => ++n, idGen: () => `id${n}` });
          a.createRole('root', { name: 'role', permissions: perms.length ? perms : ['*'] });
          const u = a.createUser('root', { email: 'u@e.com', roles: ['role'] });
          a.suspendUser('root', u.id);
          assert.equal(a.can(u.id, probe), false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('P3: granting permissions is monotonic (never revokes prior access)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,5}:[a-z]{1,5}$/), { minLength: 1, maxLength: 8 }),
        (grants) => {
          let n = 0;
          const a = new AdminService({ now: () => ++n, idGen: () => `id${n}` });
          a.createRole('root', { name: 'r', permissions: [] });
          const u = a.createUser('root', { email: 'u@e.com', roles: ['r'] });

          const allowedSoFar: string[] = [];
          for (const g of grants) {
            a.grantPermission('root', 'r', g);
            allowedSoFar.push(g);
            // Everything granted so far must still be allowed.
            for (const p of allowedSoFar) assert.equal(a.can(u.id, p), true, `lost access to ${p}`);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('P1: audit count equals applied state changes', () => {
    const opArb = fc.oneof(
      fc.record({ t: fc.constant('createRole' as const), name: fc.stringMatching(/^[a-z]{1,6}$/) }),
      fc.record({ t: fc.constant('suspend' as const) }),
      fc.record({ t: fc.constant('activate' as const) }),
    );
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
        let n = 0;
        const a = new AdminService({ now: () => ++n, idGen: () => `id${n}_${++n}` });
        let applied = 1; // the initial createUser below
        const roles = new Set<string>();
        const u = a.createUser('root', { email: 'u@e.com' });
        let suspended = false;

        for (const op of ops) {
          if (op.t === 'createRole') {
            if (roles.has(op.name)) continue; // would throw; skip duplicates
            a.createRole('root', { name: op.name });
            roles.add(op.name);
            applied++;
          } else if (op.t === 'suspend') {
            const before = a.getUser(u.id)!.status;
            a.suspendUser('root', u.id);
            if (before !== 'suspended') applied++;
            suspended = true;
          } else {
            const before = a.getUser(u.id)!.status;
            a.activateUser('root', u.id);
            if (before !== 'active') applied++;
            suspended = false;
          }
        }
        void suspended;
        assert.equal(a.auditCount(), applied);
      }),
      { numRuns: 200 },
    );
  });
});
