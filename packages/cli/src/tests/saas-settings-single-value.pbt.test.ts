// saas-settings-single-value.pbt.test.ts
// Property-based test for the SaaS starter's settings single-value guarantee.
//
//   Property 9 (Settings single-value): for every (scope, key) — where scope is
//   an organization or a user — AT MOST ONE settings row exists (enforced by the
//   UNIQUE(org_id, key) / UNIQUE(user_id, key) constraint), and a `set` followed
//   by a `get` for the same scope and key returns the value just written.
//   **Validates: Requirements 7.1, 7.2**
//
// `SettingsService` ships as overlay template content scaffolded into a generated
// project's `src/modules/settings/settings.service.ts` (it is NOT a top-level
// export of create.ts). The module imports nothing — it is pure TypeScript over a
// `SettingsRepository` contract. To exercise the real scaffolded behavior we read
// the registered template string, transpile it to JS, load it as a module, and
// drive the real `SettingsService` over an in-memory `SettingsRepository` fake
// that enforces single-row-per-(scope, key) upsert semantics. For random
// sequences of writes/reads across both scopes we assert that the last written
// value round-trips and that the backing store never holds more than one row per
// (scope, key).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

/** A persisted settings row (mirrors the overlay's SettingRow). */
interface SettingRow {
  key: string;
  value: unknown;
}

/** Minimal shape of the scaffolded SettingsService used by this test. */
interface SettingsServiceLike {
  getOrg(orgId: string, key: string): Promise<unknown | null>;
  setOrg(orgId: string, actorId: string, key: string, value: unknown): Promise<void>;
  getUser(userId: string, key: string): Promise<unknown | null>;
  setUser(userId: string, key: string, value: unknown): Promise<void>;
}

type SettingsServiceCtor = new (repo: unknown, audit?: unknown) => SettingsServiceLike;

/**
 * Extract `src/modules/settings/settings.service.ts` from the saas overlay,
 * transpile it, and load the exported `SettingsService`. The module imports
 * nothing, so no import rewriting is required.
 */
async function loadSettingsService(): Promise<{ SettingsService: SettingsServiceCtor; cleanup: () => void }> {
  const svcFile = TEMPLATES.saas.extraFiles?.find(
    (f) => f.path === 'src/modules/settings/settings.service.ts',
  );
  assert.ok(svcFile, 'saas overlay must register src/modules/settings/settings.service.ts');

  const js = ts.transpileModule(svcFile!.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const dir = mkdtempSync(join(tmpdir(), 'street-settings-pbt-'));
  const file = join(dir, 'settings.service.mjs');
  writeFileSync(file, js, 'utf8');
  const mod = await import(pathToFileURL(file).href);
  return {
    SettingsService: mod.SettingsService as SettingsServiceCtor,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * In-memory SettingsRepository fake enforcing single-row-per-(scope, key) upsert.
 * Backing stores are keyed by `${scopeId}\u0000${key}` so that re-writing the
 * same (scope, key) REPLACES the value in place rather than appending a row.
 */
class FakeSettingsRepository {
  public readonly orgStore = new Map<string, SettingRow>();
  public readonly userStore = new Map<string, SettingRow>();

  private static composite(scopeId: string, key: string): string {
    return scopeId + '\u0000' + key;
  }

  async getOrg(orgId: string, key: string): Promise<SettingRow | null> {
    return this.orgStore.get(FakeSettingsRepository.composite(orgId, key)) ?? null;
  }

  async upsertOrg(orgId: string, key: string, value: unknown): Promise<void> {
    // Upsert: one row per (orgId, key). Map.set replaces the existing entry.
    this.orgStore.set(FakeSettingsRepository.composite(orgId, key), { key, value });
  }

  async getUser(userId: string, key: string): Promise<SettingRow | null> {
    return this.userStore.get(FakeSettingsRepository.composite(userId, key)) ?? null;
  }

  async upsertUser(userId: string, key: string, value: unknown): Promise<void> {
    this.userStore.set(FakeSettingsRepository.composite(userId, key), { key, value });
  }
}

const scopeIdArb = fc.stringMatching(/^(org|user)_[a-z0-9]{1,5}$/);
const keyArb = fc.string({ minLength: 1, maxLength: 32 });
// JSON-representable values the service accepts (no undefined/function/symbol).
const jsonValueArb = fc.jsonValue();

/** One write operation in a random sequence. */
const opArb = fc.record({
  scope: fc.constantFrom<'org' | 'user'>('org', 'user'),
  scopeId: scopeIdArb,
  key: keyArb,
  value: jsonValueArb,
});

describe('Property 9: Settings single-value (SettingsService) — Validates: Requirements 7.1, 7.2', () => {
  let SettingsService: SettingsServiceCtor;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadSettingsService();
    SettingsService = loaded.SettingsService;
    cleanup = loaded.cleanup;
    assert.equal(typeof SettingsService, 'function', 'SettingsService must be importable from the overlay');
  });

  after(() => cleanup());

  it('set then get returns the value just written, for both org and user scopes', async () => {
    await fc.assert(
      fc.asyncProperty(opArb, async (op) => {
        const repo = new FakeSettingsRepository();
        const svc = new SettingsService(repo);

        if (op.scope === 'org') {
          await svc.setOrg(op.scopeId, 'actor_x', op.key, op.value);
          const got = await svc.getOrg(op.scopeId, op.key);
          assert.deepEqual(got, op.value, 'getOrg must return the value just written by setOrg');
        } else {
          await svc.setUser(op.scopeId, op.key, op.value);
          const got = await svc.getUser(op.scopeId, op.key);
          assert.deepEqual(got, op.value, 'getUser must return the value just written by setUser');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('re-writing a key replaces in place: at most one row per (scope, key), get returns the LAST value', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 1, maxLength: 40 }),
        async (ops) => {
          const repo = new FakeSettingsRepository();
          const svc = new SettingsService(repo);

          // Mirror the expected single-value semantics: last write per
          // (scope, scopeId, key) wins.
          const expectedOrg = new Map<string, unknown>();
          const expectedUser = new Map<string, unknown>();
          const composite = (id: string, key: string) => id + '\u0000' + key;

          for (const op of ops) {
            if (op.scope === 'org') {
              await svc.setOrg(op.scopeId, 'actor_x', op.key, op.value);
              expectedOrg.set(composite(op.scopeId, op.key), op.value);
            } else {
              await svc.setUser(op.scopeId, op.key, op.value);
              expectedUser.set(composite(op.scopeId, op.key), op.value);
            }
          }

          // Single-row invariant: the backing store holds exactly one row per
          // distinct (scope, key), regardless of how many writes targeted it.
          assert.equal(
            repo.orgStore.size,
            expectedOrg.size,
            'org store must hold at most one row per (org, key)',
          );
          assert.equal(
            repo.userStore.size,
            expectedUser.size,
            'user store must hold at most one row per (user, key)',
          );

          // Every distinct (scope, key) reads back its LAST written value.
          for (const op of ops) {
            if (op.scope === 'org') {
              const got = await svc.getOrg(op.scopeId, op.key);
              assert.deepEqual(
                got,
                expectedOrg.get(composite(op.scopeId, op.key)),
                'getOrg must return the last value written for this (org, key)',
              );
            } else {
              const got = await svc.getUser(op.scopeId, op.key);
              assert.deepEqual(
                got,
                expectedUser.get(composite(op.scopeId, op.key)),
                'getUser must return the last value written for this (user, key)',
              );
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('org and user scopes are independent: same scopeId+key does not collide across scopes', async () => {
    await fc.assert(
      fc.asyncProperty(scopeIdArb, keyArb, jsonValueArb, jsonValueArb, async (id, key, orgVal, userVal) => {
        const repo = new FakeSettingsRepository();
        const svc = new SettingsService(repo);

        await svc.setOrg(id, 'actor_x', key, orgVal);
        await svc.setUser(id, key, userVal);

        assert.deepEqual(await svc.getOrg(id, key), orgVal, 'org value is unaffected by the user write');
        assert.deepEqual(await svc.getUser(id, key), userVal, 'user value is unaffected by the org write');
      }),
      { numRuns: 200 },
    );
  });
});
