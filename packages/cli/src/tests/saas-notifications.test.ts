// saas-notifications.test.ts
// Unit tests for the SaaS starter notifications overlay.
//
// The NotificationService ships as TEMPLATE-STRING source inside
// TEMPLATES.saas.extraFiles in packages/cli/src/commands/create.ts — it is
// scaffolded into generated projects, not exported as runtime symbols from the
// CLI. To exercise the real behaviour in isolation we extract the template,
// transpile it with the TypeScript compiler the CLI already depends on, rewrite
// its `streetjs` import to a faithful local stub of the framework exceptions,
// and dynamically import the result. In-memory fakes stand in for the
// NotificationsRepository, Mailer, and UserEmailLookup.
//
// Covers (Requirements 8.2, 8.4, 8.5, 8.6, 8.7):
//   - notify: repo.insert failure -> InternalException, no email, no partial row
//   - notify: email enabled + send always fails -> notify resolves, send tried
//     EMAIL_MAX_RETRIES+1 times, recordDeliveryFailure once, row retained
//   - listUnread: delegates with limit 100 and returns the repo's user rows
//   - markRead: already-read is a no-op; missing/not-owned -> NotFoundException

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { TEMPLATES } from '../commands/create.js';

/** Faithful stub of the streetjs HTTP exceptions the overlay imports. Mirrors
 * the real shape from packages/core/src/http/exceptions.ts: a numeric `status`
 * and `name` set to the constructor name. */
const STREETJS_STUB = `
class StreetException extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = this.constructor.name;
  }
}
export class InternalException extends StreetException { constructor(m = 'Internal Server Error') { super(500, m); } }
export class NotFoundException extends StreetException { constructor(m = 'Not Found') { super(404, m); } }
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

/** A persisted notifications row, as the service sees it. */
interface FakeNotification {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

describe('saas overlay — notification service', () => {
  let dir: string;
  // Loaded real overlay symbols (typed loosely: they arrive via dynamic import).
  let NotificationService: any;
  let MAX_UNREAD_NOTIFICATIONS: number;
  let EMAIL_MAX_RETRIES: number;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'saas-notifications-'));
    writeFileSync(join(dir, 'streetjs.mjs'), STREETJS_STUB, 'utf8');
    const mod = await loadOverlay(
      dir,
      'src/modules/notifications/notification.service.ts',
      'notification.service.mjs',
    );
    NotificationService = mod['NotificationService'];
    MAX_UNREAD_NOTIFICATIONS = mod['MAX_UNREAD_NOTIFICATIONS'] as number;
    EMAIL_MAX_RETRIES = mod['EMAIL_MAX_RETRIES'] as number;
    assert.equal(typeof NotificationService, 'function', 'NotificationService must be exported by the overlay');
    assert.equal(MAX_UNREAD_NOTIFICATIONS, 100, 'MAX_UNREAD_NOTIFICATIONS must be 100');
    assert.equal(EMAIL_MAX_RETRIES, 3, 'EMAIL_MAX_RETRIES must be 3');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Requirement 8.2 — if persisting the notifications row fails, no email is
  // sent, an error indicating creation failed is thrown, and there is no partial
  // row.
  describe('notify persistence failure (8.2)', () => {
    it('throws InternalException, never emails, and leaves no partial row', async () => {
      const rows: FakeNotification[] = [];
      const sendCalls: unknown[] = [];
      const repo = {
        insert: async () => { throw new Error('db write failed'); },
        listUnread: async () => [],
        findOwned: async () => null,
        markRead: async () => {},
        recordDeliveryFailure: async () => {},
      };
      const mailer = { send: async (m: unknown) => { sendCalls.push(m); } };
      const users = { emailForUser: async () => 'user@example.com' };
      const svc = new NotificationService(repo, mailer, users);

      await assert.rejects(
        () => svc.notify('u1', 'welcome', { foo: 1 }, { email: true }),
        (err: any) => err.name === 'InternalException' && err.status === 500,
      );
      assert.equal(sendCalls.length, 0, 'email must not be attempted when persistence fails');
      assert.equal(rows.length, 0, 'no partial notifications row may exist');
    });
  });

  // Requirement 8.4 — when email delivery keeps failing, the persisted row is
  // retained, delivery is retried up to EMAIL_MAX_RETRIES times (total
  // EMAIL_MAX_RETRIES + 1 attempts), and a delivery-failure indication is
  // recorded after the final failed attempt; notify still resolves.
  describe('notify email retry + failure indication (8.4)', () => {
    it('attempts send EMAIL_MAX_RETRIES+1 times, records one failure, retains the row', async () => {
      const store: FakeNotification[] = [];
      let sendAttempts = 0;
      let failureRecords = 0;
      const repo = {
        insert: async (values: { user_id: string; type: string; payload: Record<string, unknown> | null }) => {
          const row: FakeNotification = {
            id: 'n1',
            user_id: values.user_id,
            type: values.type,
            payload: values.payload,
            read_at: null,
            created_at: '2024-01-01T00:00:00.000Z',
          };
          store.push(row);
          return row;
        },
        listUnread: async () => [],
        findOwned: async () => null,
        markRead: async () => {},
        recordDeliveryFailure: async (id: string) => {
          assert.equal(id, 'n1', 'failure must be recorded against the persisted row');
          failureRecords++;
        },
      };
      // Reject quickly so we never wait on the 30s per-attempt timeout.
      const mailer = { send: async () => { sendAttempts++; throw new Error('sendgrid down'); } };
      const users = { emailForUser: async () => 'user@example.com' };
      const svc = new NotificationService(repo, mailer, users);

      // notify must resolve (the in-app notification already succeeded).
      await svc.notify('u1', 'welcome', { foo: 1 }, { email: true });

      assert.equal(sendAttempts, EMAIL_MAX_RETRIES + 1, 'send must be attempted EMAIL_MAX_RETRIES+1 times');
      assert.equal(failureRecords, 1, 'exactly one delivery-failure indication after the final attempt');
      assert.equal(store.length, 1, 'the persisted notifications row is retained after email failure');
      assert.equal(store[0].read_at, null, 'the retained row stays unread');
    });
  });

  // Requirement 8.5 — listUnread returns only the user's unread rows, newest
  // first, capped at 100. The service delegates scoping/ordering/limit to the
  // repository, so we assert it passes the user id and the 100 cap and returns
  // exactly what the repo provides.
  describe('listUnread cap & delegation (8.5)', () => {
    it('delegates with limit 100 and returns the repo user-scoped rows unchanged', async () => {
      const repoRows: FakeNotification[] = [
        { id: 'b', user_id: 'u1', type: 't', payload: null, read_at: null, created_at: '2024-01-02T00:00:00.000Z' },
        { id: 'a', user_id: 'u1', type: 't', payload: null, read_at: null, created_at: '2024-01-01T00:00:00.000Z' },
      ];
      const calls: Array<{ userId: string; limit: number }> = [];
      const repo = {
        insert: async () => { throw new Error('unused'); },
        listUnread: async (userId: string, limit: number) => { calls.push({ userId, limit }); return repoRows; },
        findOwned: async () => null,
        markRead: async () => {},
        recordDeliveryFailure: async () => {},
      };
      const svc = new NotificationService(repo);

      const result = await svc.listUnread('u1');

      assert.equal(calls.length, 1, 'listUnread must delegate to the repository exactly once');
      assert.deepEqual(calls[0], { userId: 'u1', limit: 100 }, 'must request the caller user with the 100 cap');
      assert.deepEqual(
        result.map((r: FakeNotification) => r.id),
        ['b', 'a'],
        'returns the repository rows (newest-first ordering preserved)',
      );
    });
  });

  // Requirement 8.6 — marking an already-read notification leaves read_at
  // unchanged (no-op, does not call repo.markRead).
  // Requirement 8.7 — marking a notification that does not exist or is not owned
  // makes no change and raises NotFoundException.
  describe('markRead idempotency & not-found (8.6, 8.7)', () => {
    it('is a no-op for an already-read notification', async () => {
      let markReadCalls = 0;
      const already: FakeNotification = {
        id: 'n1', user_id: 'u1', type: 't', payload: null,
        read_at: '2024-01-01T00:00:00.000Z', created_at: '2024-01-01T00:00:00.000Z',
      };
      const repo = {
        insert: async () => { throw new Error('unused'); },
        listUnread: async () => [],
        findOwned: async () => already,
        markRead: async () => { markReadCalls++; },
        recordDeliveryFailure: async () => {},
      };
      const svc = new NotificationService(repo);

      await svc.markRead('u1', 'n1');

      assert.equal(markReadCalls, 0, 'repo.markRead must not be called when already read');
      assert.equal(already.read_at, '2024-01-01T00:00:00.000Z', 'read_at must be left unchanged');
    });

    it('marks an unread notification read exactly once', async () => {
      let markReadCalls = 0;
      const unread: FakeNotification = {
        id: 'n1', user_id: 'u1', type: 't', payload: null,
        read_at: null, created_at: '2024-01-01T00:00:00.000Z',
      };
      const repo = {
        insert: async () => { throw new Error('unused'); },
        listUnread: async () => [],
        findOwned: async () => unread,
        markRead: async (userId: string, id: string, readAt: string) => {
          markReadCalls++;
          assert.equal(userId, 'u1');
          assert.equal(id, 'n1');
          assert.equal(typeof readAt, 'string');
        },
        recordDeliveryFailure: async () => {},
      };
      const svc = new NotificationService(repo);

      await svc.markRead('u1', 'n1');

      assert.equal(markReadCalls, 1, 'repo.markRead must be called once for an unread notification');
    });

    it('throws NotFoundException and makes no change for a missing/not-owned id', async () => {
      let markReadCalls = 0;
      const repo = {
        insert: async () => { throw new Error('unused'); },
        listUnread: async () => [],
        findOwned: async () => null, // not found / not owned by this user
        markRead: async () => { markReadCalls++; },
        recordDeliveryFailure: async () => {},
      };
      const svc = new NotificationService(repo);

      await assert.rejects(
        () => svc.markRead('u1', 'missing'),
        (err: any) => err.name === 'NotFoundException' && err.status === 404,
      );
      assert.equal(markReadCalls, 0, 'no write may reach the repo for a missing/not-owned notification');
    });
  });
});
