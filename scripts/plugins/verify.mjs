#!/usr/bin/env node
// scripts/plugins/verify.mjs
//
// Official Plugin Ecosystem Layer-B verification driver (Requirement 5.9).
//
// Drives the zero-dependency `CommandRunner` from @streetjs/core to execute each
// official plugin's REAL backing-service integration (integration.mjs) and emit
// exactly one machine-readable Verification Artifact per plugin:
//
//     verification-artifacts/plugins/plugin.<id>.artifact.json
//
// Each artifact records the pass result (status), the plugin id (capabilityId
// `plugin.<id>`), and an ISO-8601 timestamp — exactly the evidence Requirement
// 5.9 mandates.
//
// For every plugin the driver passes the plugin's prerequisite probe to the
// runner: when the real backing service is unreachable or the test credential
// is absent, the runner classifies the run as an honest BLOCKED with the
// SPECIFIC missing prerequisite id (a credential env-var name for vendor
// accounts, a service id for container backends) — never a mock, never a false
// VERIFIED (Req 1.5 / 5.9). When the backing service IS available, integration.mjs
// performs the real round trip; its exit code drives the VERIFIED (all evidence
// present + exit 0) vs PARTIAL classification.
//
// Evidence hints: every official plugin ships source AND published documentation
// (a `README.md` plus an `example/`), so `documentation` is marked present; the
// runner derives the remaining components from the executed command.
//
// Usage:
//   node scripts/plugins/verify.mjs               # verify all official plugins
//   node scripts/plugins/verify.mjs --plugin s3   # verify a single plugin
//   node scripts/plugins/verify.mjs --out <dir>   # artifact root (default verification-artifacts)
//
// Exit code: non-zero if ANY plugin's verification command exited non-zero (a
// genuine integration failure). An honest BLOCKED (skipped harness, exit 0)
// does not fail the step.
//
// _Design: Components → Official Plugin Ecosystem; Testing Strategy → Layer B +
//  Honest BLOCKED. Requirements: 5.9, 1.5_

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CommandRunner } from 'streetjs';
import { REPO_ROOT, PLUGINS, PLUGIN_IDS, resolvePlugin } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INTEGRATION_SCRIPT = resolve(HERE, 'integration.mjs');

/** Drive the CommandRunner for one plugin and return the run result. */
export async function verifyPlugin(pluginId, { outRoot = 'verification-artifacts' } = {}) {
  const plugin = resolvePlugin(pluginId);
  const outDir = resolve(outRoot, 'plugins');
  const runner = new CommandRunner();

  return runner.run({
    capabilityId: plugin.capabilityId,
    command: `node ${JSON.stringify(INTEGRATION_SCRIPT)} ${pluginId}`,
    cwd: REPO_ROOT,
    // The single prerequisite: the plugin's real backing service / test account.
    // A missing one short-circuits the classification to BLOCKED with its id.
    prerequisites: [async () => plugin.probe()],
    // Each official plugin ships a README + example app as published docs.
    evidenceHints: { documentation: true },
    outDir,
  });
}

/** Verify several plugins, returning their run results in order. */
export async function verifyPlugins(ids, opts = {}) {
  const results = [];
  for (const id of ids) {
    const result = await verifyPlugin(id, opts);
    const { artifact, path } = result;
    console.log(`[plugin-verify] ${artifact.capabilityId}: ${artifact.status} (exit ${artifact.exitCode})`);
    if (artifact.blockedReason) {
      console.log(`[plugin-verify]   blocked: ${artifact.blockedReason.kind}/${artifact.blockedReason.missingPrerequisite}`);
    }
    console.log(`[plugin-verify]   artifact: ${path}`);
    results.push(result);
  }
  return results;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { outRoot: 'verification-artifacts', ids: PLUGIN_IDS };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--plugin') {
      const id = args[++i];
      if (!PLUGINS[id]) throw new Error(`unknown plugin id '${id}' (known: ${PLUGIN_IDS.join(', ')})`);
      opts.ids = [id];
    } else if (arg === '--out') {
      opts.outRoot = args[++i];
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(`[plugin-verify] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const results = await verifyPlugins(opts.ids, { outRoot: opts.outRoot });

  // Fail the step if any plugin's verification command exited non-zero (a real
  // integration failure). Honest BLOCKED skips exit 0 and do not fail CI.
  const worst = results.reduce((acc, r) => (r.artifact.exitCode !== 0 ? r.artifact.exitCode : acc), 0);
  process.exitCode = worst;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[plugin-verify] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
