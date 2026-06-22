// saas-settings-validation.test.ts
// Edge-case unit tests for the SaaS starter Settings overlay (SettingsService).
//
// The settings logic ships as TEMPLATE-STRING source inside
// TEMPLATES.saas.extraFiles in packages/cli/src/commands/create.ts at path
// src/modules/settings/settings.service.ts — it is scaffolded into generated
// projects, not exported as runtime symbols from the CLI. To exercise the real
// behaviour in isolation we extract the template, transpile it with the
// TypeScript compiler the CLI already depends on, and dynamically import the
// result. SettingsService is a pure module (no `streetjs` import), so we drive
// it with an in-memory SettingsRepository fake.
//
// Covers (Requirements 7.3, 7.4, 7.5):
//   - 7.5: key > 255 chars rejected (InvalidSettingError), existing value kept
//   - 7.5: non-JSON value (undefined/function/symbol/BigInt/circular) rejected,
//          existing value kept
//   - 7.4: missing read returns null (no-value) and creates no row
//   - 7.3: re-writing an existing key replaces value in place (no new row),
//          leaving other scopes/keys untouched

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { TEMPLATES } from '../commands/create.js';

/** Pull a scaffolded overlay file's source out of the saas template registry. */
function templateSource(path: string): string {
  const entry = TEMPLATES.saas.extraFiles?.find((f) => f.path === path);
  assert.ok(entry, `expected saas template to register ${path}`);
  return entry!.content;
}

/** Transpile one overlay template to an ESM module on disk and dynamically
 * import it. SettingsService has no external imports to rewrite. */
async function loadOverlay(dir: string, templatePath: string, outFile: string): Promise<Record<string, unknown>> {
  const transpiled = ts.transpileModule(templateSource(templatePath), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const abs = join(dir, outFile);
  writeFileSync(abs, transpiled, 'utf8');
  return import(pathToFileURL(abs).href) as Promise<Record<string, unknown>>;
}

/**
 * In-memory SettingsRepository fake. Stores at most one row per (scope, key)
 * in a Map, mirroring the UNIQUE(org_id, key) / UNIQUE(user_id, key) schema
 * constraint. Tracks how many distinct rows it created and how many upserts ran
 * so tests can prove "no row created" and "replaced in place" behaviours.
 */
function makeRepo() {
  const rows = new Map<string, { key: string; value: unknown }>();
  const stats = { rowsCreated: 0, upserts: 0 };

  const orgKey = (orgId: string, key: string) => `org\u0000${orgId}\u0000${key}`;
  const userKey = (userId: string, key: string) => `user\u0000${userId}\u0000${key}`;

  function upsert(mapKey: string, key: string, value: unknown): void {
    stats.upserts++;
    if (!rows.has(mapKey)) stats.rowsCreated++;
    rows.set(mapKey, { key, value });
  }

  const repo = {
    async getOrg(orgId: string, key: string) {
      return rows.get(orgKey(orgId, key)) ?? null;
    },
    async upsertOrg(orgId: string, key: string, value: unknown) {
      upsert(orgKey(orgId, key), key, value);
    },
    async getUser(userId: string, key: string) {
      return rows.get(userKey(userId, key)) ?? null;
    },
    async upsertUser(userId: string, key: string, value: unknown) {
      upsert(userKey(userId, key), key, value);
    },
  };

  return { repo, rows, stats };
}

describe('saas overlay — settings validation & missing reads', () => {
  let dir: string;
  let SettingsService: any;
  let InvalidSettingError: any;
  let MAX_SETTINGS_KEY_LENGTH: number;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'saas-settings-'));
    const mod = await loadOverlay(dir, 'src/modules/settings/settings.service.ts', 'settings.service.mjs');
    SettingsService = mod['SettingsService'];
    InvalidSettingError = mod['InvalidSettingError'];
    MAX_SETTINGS_KEY_LENGTH = mod['MAX_SETTINGS_KEY_LENGTH'] as number;
    assert.equal(typeof SettingsService, 'function', 'SettingsService must be exported by the overlay');
    assert.equal(typeof InvalidSettingError, 'function', 'InvalidSettingError must be exported by the overlay');
    assert.equal(MAX_SETTINGS_KEY_LENGTH, 255, 'MAX_SETTINGS_KEY_LENGTH must be 255');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Requirement 7.5 — a key longer than 255 characters is rejected and any
  // existing stored value is left unchanged (no write reaches the repo).
  describe('key-length rejection preserves existing value (7.5)', () => {
    it('setOrg with an over-length key throws and leaves the existing value intact', async () => {
      const { repo, stats } = makeRepo();
      const svc = new SettingsService(repo);

      // Seed an existing value for the same key prefix scope.
      await svc.setOrg('org1', 'actor1', 'theme', 'dark');
      const upsertsAfterSeed = stats.upserts;

      const longKey = 'k'.repeat(MAX_SETTINGS_KEY_LENGTH + 1);
      await assert.rejects(
        () => svc.setOrg('org1', 'actor1', longKey, 'light'),
        (err: any) => err instanceof InvalidSettingError && err.name === 'InvalidSettingError',
      );

      assert.equal(stats.upserts, upsertsAfterSeed, 'no write may reach the repo for an invalid key');
      assert.equal(await svc.getOrg('org1', 'theme'), 'dark', 'existing value must be unchanged');
      assert.equal(await svc.getOrg('org1', longKey), null, 'the rejected key must not have been stored');
    });

    it('setUser with an over-length key throws and leaves the existing value intact', async () => {
      const { repo, stats } = makeRepo();
      const svc = new SettingsService(repo);

      await svc.setUser('user1', 'locale', 'en');
      const upsertsAfterSeed = stats.upserts;

      const longKey = 'x'.repeat(MAX_SETTINGS_KEY_LENGTH + 1);
      await assert.rejects(
        () => svc.setUser('user1', longKey, 'fr'),
        (err: any) => err instanceof InvalidSettingError,
      );

      assert.equal(stats.upserts, upsertsAfterSeed, 'no write may reach the repo for an invalid key');
      assert.equal(await svc.getUser('user1', 'locale'), 'en', 'existing value must be unchanged');
    });

    it('rejects an empty key without writing', async () => {
      const { repo, stats } = makeRepo();
      const svc = new SettingsService(repo);
      await assert.rejects(() => svc.setOrg('org1', 'actor1', '', 'v'), (e: any) => e instanceof InvalidSettingError);
      assert.equal(stats.upserts, 0, 'an empty key must not write');
    });
  });

  // Requirement 7.5 — a value that JSON cannot encode is rejected and the
  // existing stored value is left unchanged.
  describe('invalid-JSON rejection preserves existing value (7.5)', () => {
    const circular: any = {};
    circular.self = circular;

    const nonJsonValues: Array<[string, unknown]> = [
      ['undefined', undefined],
      ['function', () => 42],
      ['symbol', Symbol('s')],
      ['bigint', 10n],
      ['circular', circular],
    ];

    for (const [label, badValue] of nonJsonValues) {
      it(`setOrg rejects a ${label} value and preserves the prior value`, async () => {
        const { repo, stats } = makeRepo();
        const svc = new SettingsService(repo);

        await svc.setOrg('org1', 'actor1', 'config', { ok: true });
        const upsertsAfterSeed = stats.upserts;

        await assert.rejects(
          () => svc.setOrg('org1', 'actor1', 'config', badValue),
          (err: any) => err instanceof InvalidSettingError,
        );

        assert.equal(stats.upserts, upsertsAfterSeed, 'no write may reach the repo for a non-JSON value');
        assert.deepEqual(await svc.getOrg('org1', 'config'), { ok: true }, 'existing value must be unchanged');
      });

      it(`setUser rejects a ${label} value and preserves the prior value`, async () => {
        const { repo, stats } = makeRepo();
        const svc = new SettingsService(repo);

        await svc.setUser('user1', 'prefs', [1, 2, 3]);
        const upsertsAfterSeed = stats.upserts;

        await assert.rejects(
          () => svc.setUser('user1', 'prefs', badValue),
          (err: any) => err instanceof InvalidSettingError,
        );

        assert.equal(stats.upserts, upsertsAfterSeed, 'no write may reach the repo for a non-JSON value');
        assert.deepEqual(await svc.getUser('user1', 'prefs'), [1, 2, 3], 'existing value must be unchanged');
      });
    }
  });

  // Requirement 7.4 — reading a (scope, key) with no stored row returns a
  // no-value indication (null) and does NOT create a row.
  describe('missing read returns no-value and creates no row (7.4)', () => {
    it('getOrg returns null for an unknown key and writes nothing', async () => {
      const { repo, rows, stats } = makeRepo();
      const svc = new SettingsService(repo);

      const result = await svc.getOrg('org1', 'never-set');

      assert.equal(result, null, 'missing org read must return null');
      assert.equal(rows.size, 0, 'no row may be created by a read');
      assert.equal(stats.upserts, 0, 'no upsert may run on a read');
      assert.equal(stats.rowsCreated, 0, 'no row may be created by a read');
    });

    it('getUser returns null for an unknown key and writes nothing', async () => {
      const { repo, rows, stats } = makeRepo();
      const svc = new SettingsService(repo);

      const result = await svc.getUser('user1', 'never-set');

      assert.equal(result, null, 'missing user read must return null');
      assert.equal(rows.size, 0, 'no row may be created by a read');
      assert.equal(stats.upserts, 0, 'no upsert may run on a read');
    });
  });

  // Requirement 7.3 — writing an existing key again replaces the value in the
  // existing row rather than creating a new row, leaving other scopes/keys
  // untouched.
  describe('upsert replaces in place (7.3)', () => {
    it('re-writing the same org key replaces the value without adding a row', async () => {
      const { repo, rows, stats } = makeRepo();
      const svc = new SettingsService(repo);

      await svc.setOrg('org1', 'actor1', 'theme', 'dark');
      // An unrelated scope/key that must remain untouched.
      await svc.setOrg('org2', 'actor1', 'theme', 'system');
      await svc.setUser('user1', 'theme', 'light');

      const rowsAfterSeed = rows.size;
      const createdAfterSeed = stats.rowsCreated;

      await svc.setOrg('org1', 'actor1', 'theme', 'solarized');

      assert.equal(rows.size, rowsAfterSeed, 'replacing an existing key must not add a row');
      assert.equal(stats.rowsCreated, createdAfterSeed, 'replacing an existing key creates no new row');
      assert.equal(await svc.getOrg('org1', 'theme'), 'solarized', 'value must be replaced in place');
      assert.equal(await svc.getOrg('org2', 'theme'), 'system', 'other org scope must be untouched');
      assert.equal(await svc.getUser('user1', 'theme'), 'light', 'user scope must be untouched');
    });

    it('re-writing the same user key replaces the value without adding a row', async () => {
      const { repo, rows, stats } = makeRepo();
      const svc = new SettingsService(repo);

      await svc.setUser('user1', 'locale', 'en');
      await svc.setUser('user1', 'timezone', 'UTC'); // sibling key must stay intact

      const rowsAfterSeed = rows.size;
      const createdAfterSeed = stats.rowsCreated;

      await svc.setUser('user1', 'locale', 'fr');

      assert.equal(rows.size, rowsAfterSeed, 'replacing an existing key must not add a row');
      assert.equal(stats.rowsCreated, createdAfterSeed, 'replacing an existing key creates no new row');
      assert.equal(await svc.getUser('user1', 'locale'), 'fr', 'value must be replaced in place');
      assert.equal(await svc.getUser('user1', 'timezone'), 'UTC', 'sibling key must be untouched');
    });

    it('first-time writes create exactly one row per (scope, key)', async () => {
      const { repo, rows, stats } = makeRepo();
      const svc = new SettingsService(repo);

      await svc.setOrg('org1', 'actor1', 'a', 1);
      await svc.setOrg('org1', 'actor1', 'b', 2);
      await svc.setUser('user1', 'a', 3);

      assert.equal(rows.size, 3, 'three distinct (scope, key) pairs yield three rows');
      assert.equal(stats.rowsCreated, 3, 'each first write creates one row');
    });
  });
});
