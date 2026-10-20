#!/usr/bin/env node

/**
 * Authoritative StreetJS verification entry point.
 *
 * The stages are intentionally explicit so a skipped external service is not
 * confused with a passing offline check. The command continues through all
 * stages and exits non-zero if any required stage fails.
 */

import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const results = [];

function runStage(name, args, options = {}) {
  console.log(`\n=== ${name} ===`);
  console.log(`$ ${npm} ${args.join(" ")}`);
  const result = spawnSync(npm, args, {
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });
  const code = result.error ? 1 : result.status ?? 1;
  const status = code === 0 ? "PASS" : "FAIL";
  results.push({ name, status, code });
  console.log(`=== ${name}: ${status} ===`);
  return code === 0;
}

runStage("BUILD", ["run", "build"]);
runStage("LINT", ["run", "lint"]);
runStage("TYPECHECK", ["run", "lint", "--workspaces", "--if-present"]);
runStage("OFFLINE TESTS (CORE)", ["test"]);
runStage("OFFLINE TESTS (CLI)", ["run", "test:cli"]);
runStage("FRAMEWORK CONFORMANCE", ["run", "test:conformance"]);
runStage("INTEGRATION TESTS", ["run", "test:integration"]);

if (process.env.STREETJS_RUN_EXTERNAL === "1") {
  runStage("EXTERNAL SERVICE TESTS", ["test", "--workspaces", "--if-present"]);
} else {
  console.log("\n=== EXTERNAL SERVICE TESTS ===");
  console.log("SKIPPED: set STREETJS_RUN_EXTERNAL=1 to run workspace external-service suites.");
  results.push({ name: "EXTERNAL SERVICE TESTS", status: "SKIPPED", code: 0 });
}

console.log("\n=== VERIFICATION SUMMARY ===");
for (const result of results) {
  console.log(`${result.status.padEnd(7)} ${result.name}`);
}

const failed = results.filter((result) => result.status === "FAIL");
process.exitCode = failed.length > 0 ? 1 : 0;
