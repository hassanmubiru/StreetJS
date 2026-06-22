// saas-invitation-lifecycle.test.ts
// Unit tests for the SaaS starter invitations overlay (InvitationService).
//
// Like the rest of the SaaS overlay, InvitationService ships as TEMPLATE-STRING
// source inside TEMPLATES.saas.extraFiles in packages/cli/src/commands/create.ts
// (path: src/modules/invitations/invitation.service.ts) — it is scaffolded into
// generated projects, not exported as a runtime symbol from the CLI. To exercise
// the real behaviour in isolation we extract the template, transpile it with the
// TypeScript compiler the CLI already depends on, rewrite its `streetjs` import
// to a faithful local stub of the framework exceptions, and dynamically import
// the result. In-memory fakes stand in for the invitation/membership repos.
//
// NOTE: the overlay raises a 410 via a `GoneException extends StreetException`
// (`super(410, message)`), so the streetjs stub MUST export a `StreetException`
// base class whose constructor sets `this.status = <first arg>`.
//
// Covers (Requirements 2.5, 2.6, 2.7, 2.8, 3.4, 3.5):
//   invite():
//     - non-owner/admin actor                 -> 403, no invitation created (2.6, 3.4)
//     - unrecognized / non-invitable role      -> 403, no invitation created (3.5)
//     - valid owner/admin + admin|member role  -> unique token, ~168h expiry (2.5)
//   acceptInvite():
//     - valid unexpired token                  -> exactly one membership + accepted_at (2.7)
//     - expired token                          -> 410, no membership (2.8)
//     - already-accepted token                 -> 410, no membership (2.8)
//     - unknown token                          -> 404 (NotFoundException)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { TEMPLATES } from '../commands/create.js';

/** Faithful stub of the streetjs HTTP exceptions the invitation overlay imports.
 * Mirrors the real shape from packages/core/src/http/exceptions.ts: a numeric
 * `status` and `name` set to the constructor name. CRUCIALLY, `StreetException`
 * is EXPORTED so the overlay's local `GoneException extends StreetException`
 * (super(410, message)) compiles and reports status 410. */
const STREETJS_STUB = `
export class StreetException extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = this.constructor.name;
  }
}
export class BadRequestException extends StreetException { constructor(m = 'Bad Request', d) { super(400, m, d); } }
export class UnauthorizedException extends StreetException { constructor(m = 'Unauthorized') { super(401, m); } }
export class ForbiddenException extends StreetException { constructor(m = 'Forbidden') { super(403, m); } }
export class NotFoundException extends StreetException { constructor(m = 'Not Found') { super(404, m); } }
export class ConflictException extends StreetException { constructor(m = 'Conflict', d) { super(409, m, d); } }
`;

/** Pull a scaffolded overlay file's source out of the saas template registry. */
function templateSource(path: string): string {
  const entry = TEMPLATES.saas.extraFiles?.find((f) => f.path === path);
  assert.ok(entry, `expected saas template to register ${path}`);
  return entry!.content;
}

/** Transpile one overlay template to an ESM module on disk (with its `streetjs`
 * import rewritten to the local stub) and dynamically import it. */
async function loadOverlay(dir: string, templatePath: string, outFile: string): Promise<Record<string, unknown>> {
  const transpiled = ts.transpileModule(templateSource(templatePath), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const rewritten = transpiled.replace(/from ['"]streetjs['"]/g, "from './streetjs.mjs'");
  const abs = join(dir, outFile);
  writeFileSync(abs, rewritten, 'utf8');
  return import(pathToFileURL(abs).href) as Promise<Record<string, unknown>>;
}

/** In-memory InvitationRepository fake. Records inserts and serves findByToken. */
function makeInvitationRepo(seed?: { token: string; invitation: any }) {
  const inserts: any[] = [];
  const accepted: { id: string; when: Date }[] = [];
  let store: Record<string, any> = {};
  if (seed) store[seed.token] = seed.invitation;
  const repo = {
    insert: async (values: any) => {
      const invitation = {
        id: 'inv-' + (inserts.length + 1),
        accepted_at: null,
        ...values,
        // The overlay passes a Date for expires_at; rows store an ISO string.
        expires_at: values.expires_at instanceof Date ? values.expires_at.toISOString() : values.expires_at,
      };
      inserts.push(invitation);
      store[invitation.token] = invitation;
      return invitation;
    },
    findByToken: async (token: string) => store[token] ?? null,
    markAccepted: async (id: string, when: Date) => {
      accepted.push({ id, when });
      for (const t of Object.keys(store)) {
        if (store[t].id === id) store[t] = { ...store[t], accepted_at: when.toISOString() };
      }
    },
  };
  return { repo, inserts, accepted, getStore: () => store };
}

/** In-memory MembershipWriteRepository fake. `actor` backs the inviter gate. */
function makeMembershipRepo(actor: any) {
  const created: any[] = [];
  const repo = {
    findMembership: async (_orgId: string, _userId: string) => actor,
    createMembership: async (values: any) => {
      const m = { id: 'mem-' + (created.length + 1), ...values };
      created.push(m);
      return m;
    },
  };
  return { repo, created };
}

describe('saas overlay — invitation lifecycle', () => {
  let dir: string;
  let InvitationService: any;
  let INVITE_TTL_MS: number;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'saas-invite-'));
    writeFileSync(join(dir, 'streetjs.mjs'), STREETJS_STUB, 'utf8');
    const mod = await loadOverlay(dir, 'src/modules/invitations/invitation.service.ts', 'invitation.service.mjs');
    InvitationService = mod['InvitationService'];
    INVITE_TTL_MS = mod['INVITE_TTL_MS'] as number;
    assert.equal(typeof InvitationService, 'function', 'InvitationService must be exported by the overlay');
    assert.equal(INVITE_TTL_MS, 168 * 60 * 60 * 1000, 'invites live 168h (7 days)');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Requirements 2.6, 3.4 — only an owner or admin may invite; a member (or any
  // non-privileged actor) is rejected with 403 and NO invitation is created.
  describe('invite() inviter gate', () => {
    it('rejects a non-owner/admin actor with 403 and creates no invitation', async () => {
      const inv = makeInvitationRepo();
      const mem = makeMembershipRepo({ id: 'm', org_id: 'org1', user_id: 'u1', role: 'member' });
      const svc = new InvitationService(inv.repo, mem.repo);

      await assert.rejects(
        () => svc.invite('org1', 'u1', 'new@acme.test', 'member'),
        (err: any) => err.name === 'ForbiddenException' && err.status === 403,
      );
      assert.equal(inv.inserts.length, 0, 'no invitation may be created for an unauthorized inviter');
    });

    it('rejects an actor with no membership in the org with 403', async () => {
      const inv = makeInvitationRepo();
      const mem = makeMembershipRepo(null); // findMembership -> null
      const svc = new InvitationService(inv.repo, mem.repo);

      await assert.rejects(
        () => svc.invite('org1', 'stranger', 'new@acme.test', 'member'),
        (err: any) => err.name === 'ForbiddenException' && err.status === 403,
      );
      assert.equal(inv.inserts.length, 0, 'a non-member cannot create an invitation');
    });
  });

  // Requirement 3.5 — an unrecognized / non-invitable role (anything other than
  // "admin" | "member", e.g. "owner" or "superuser") is rejected with 403. The
  // role gate runs BEFORE the inviter gate, so even a valid owner is rejected.
  describe('invite() role validation', () => {
    for (const badRole of ['owner', 'superuser', 'guest', '', 'Admin']) {
      it(`rejects role "${badRole}" with 403 and creates no invitation`, async () => {
        const inv = makeInvitationRepo();
        const mem = makeMembershipRepo({ id: 'm', org_id: 'org1', user_id: 'owner1', role: 'owner' });
        const svc = new InvitationService(inv.repo, mem.repo);

        await assert.rejects(
          () => svc.invite('org1', 'owner1', 'new@acme.test', badRole),
          (err: any) => err.name === 'ForbiddenException' && err.status === 403,
        );
        assert.equal(inv.inserts.length, 0, 'no invitation may be created for an invalid role');
      });
    }
  });

  // Requirement 2.5 — a valid owner/admin inviting an "admin" | "member" creates
  // an invitation with a unique token and an expiry ~168h out.
  describe('invite() success', () => {
    for (const [actorRole, inviteRole] of [
      ['owner', 'member'],
      ['owner', 'admin'],
      ['admin', 'member'],
      ['admin', 'admin'],
    ] as const) {
      it(`${actorRole} can invite a ${inviteRole} with a unique token and 168h expiry`, async () => {
        const inv = makeInvitationRepo();
        const mem = makeMembershipRepo({ id: 'm', org_id: 'org1', user_id: 'a1', role: actorRole });
        const svc = new InvitationService(inv.repo, mem.repo);

        const before = Date.now();
        const invitation = await svc.invite('org1', 'a1', 'teammate@acme.test', inviteRole);
        const after = Date.now();

        assert.equal(inv.inserts.length, 1, 'exactly one invitation is created');
        assert.equal(invitation.org_id, 'org1');
        assert.equal(invitation.email, 'teammate@acme.test');
        assert.equal(invitation.role, inviteRole);
        assert.ok(typeof invitation.token === 'string' && invitation.token.length >= 32, 'token is a long unique string');
        assert.equal(invitation.accepted_at, null, 'a fresh invitation is not yet accepted');

        const expiresAt = new Date(invitation.expires_at).getTime();
        assert.ok(
          expiresAt >= before + INVITE_TTL_MS && expiresAt <= after + INVITE_TTL_MS,
          'expires_at is ~168h from creation',
        );
      });
    }

    it('mints distinct tokens for separate invitations', async () => {
      const inv = makeInvitationRepo();
      const mem = makeMembershipRepo({ id: 'm', org_id: 'org1', user_id: 'a1', role: 'owner' });
      const svc = new InvitationService(inv.repo, mem.repo);

      const first = await svc.invite('org1', 'a1', 'one@acme.test', 'member');
      const second = await svc.invite('org1', 'a1', 'two@acme.test', 'member');
      assert.notEqual(first.token, second.token, 'each invitation carries a unique token');
    });
  });

  // Requirement 2.7 — a valid unexpired token redeems into EXACTLY ONE membership
  // with the invited role, and the invitation's accepted_at is stamped.
  describe('acceptInvite() success', () => {
    it('creates exactly one membership with the invited role and stamps accepted_at', async () => {
      const future = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      const inv = makeInvitationRepo({
        token: 'tok-good',
        invitation: { id: 'inv-9', org_id: 'org1', email: 'x@acme.test', role: 'admin', token: 'tok-good', expires_at: future, accepted_at: null },
      });
      const mem = makeMembershipRepo(null);
      const svc = new InvitationService(inv.repo, mem.repo);

      const membership = await svc.acceptInvite('tok-good', 'u42');

      assert.equal(mem.created.length, 1, 'exactly one membership is created');
      assert.deepEqual(
        { org_id: membership.org_id, user_id: membership.user_id, role: membership.role },
        { org_id: 'org1', user_id: 'u42', role: 'admin' },
        'membership carries the invited org, user, and role',
      );
      assert.equal(inv.accepted.length, 1, 'accepted_at is stamped exactly once');
      assert.equal(inv.accepted[0].id, 'inv-9');
      assert.ok(inv.getStore()['tok-good'].accepted_at, 'the invitation row is marked accepted');
    });
  });

  // Requirement 2.8 — an expired token is a 410 and creates no membership.
  describe('acceptInvite() expired', () => {
    it('rejects an expired token with 410 and creates no membership', async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const inv = makeInvitationRepo({
        token: 'tok-expired',
        invitation: { id: 'inv-e', org_id: 'org1', email: 'x@acme.test', role: 'member', token: 'tok-expired', expires_at: past, accepted_at: null },
      });
      const mem = makeMembershipRepo(null);
      const svc = new InvitationService(inv.repo, mem.repo);

      await assert.rejects(
        () => svc.acceptInvite('tok-expired', 'u42'),
        (err: any) => err.name === 'GoneException' && err.status === 410,
      );
      assert.equal(mem.created.length, 0, 'an expired invite creates no membership');
      assert.equal(inv.accepted.length, 0, 'an expired invite is not stamped accepted');
    });
  });

  // Requirement 2.8 — an already-accepted token is a 410 and creates no membership.
  describe('acceptInvite() already accepted', () => {
    it('rejects an already-accepted token with 410 and creates no membership', async () => {
      const future = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      const inv = makeInvitationRepo({
        token: 'tok-used',
        invitation: { id: 'inv-u', org_id: 'org1', email: 'x@acme.test', role: 'member', token: 'tok-used', expires_at: future, accepted_at: new Date().toISOString() },
      });
      const mem = makeMembershipRepo(null);
      const svc = new InvitationService(inv.repo, mem.repo);

      await assert.rejects(
        () => svc.acceptInvite('tok-used', 'u42'),
        (err: any) => err.name === 'GoneException' && err.status === 410,
      );
      assert.equal(mem.created.length, 0, 'an already-accepted invite creates no second membership');
    });
  });

  // An unknown token is a 404 (NotFoundException).
  describe('acceptInvite() unknown token', () => {
    it('rejects an unknown token with 404 and creates no membership', async () => {
      const inv = makeInvitationRepo();
      const mem = makeMembershipRepo(null);
      const svc = new InvitationService(inv.repo, mem.repo);

      await assert.rejects(
        () => svc.acceptInvite('tok-missing', 'u42'),
        (err: any) => err.name === 'NotFoundException' && err.status === 404,
      );
      assert.equal(mem.created.length, 0, 'an unknown token creates no membership');
    });
  });
});
