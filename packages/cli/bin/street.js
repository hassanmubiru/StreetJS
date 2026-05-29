#!/usr/bin/env node

// @streetjs/cli — bin entry point
// Load reflect-metadata for framework decorators, then delegate to the CLI dispatcher.

import 'reflect-metadata';

import { runCli } from '../dist/index.js';

runCli(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[street] Fatal error: ${message}`);
  process.exit(1);
});
