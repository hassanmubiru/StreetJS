#!/usr/bin/env node
// @streetjs/registry-server — minimal server bootstrap CLI.
//
// Boots a registry HTTP server. Publishers are seeded from the
// STREET_REGISTRY_PUBLISHERS env var as a JSON array of
// `{ id, apiKey, namespaces }`, e.g.:
//   STREET_REGISTRY_PUBLISHERS='[{"id":"acme","apiKey":"secret","namespaces":["acme"]}]'
// PORT/HOST control the bind address. This is a thin operational entry point;
// the service logic lives in `RegistryService`.

import { PublisherDirectory } from './auth.js';
import { RegistryService } from './registry.js';
import { startRegistryServer } from './server.js';

interface SeedPublisher {
  id: string;
  apiKey: string;
  namespaces: string[];
}

function loadPublishers(): PublisherDirectory {
  const dir = new PublisherDirectory();
  const raw = process.env.STREET_REGISTRY_PUBLISHERS;
  if (!raw) return dir;
  let seeds: SeedPublisher[];
  try {
    seeds = JSON.parse(raw) as SeedPublisher[];
  } catch {
    process.stderr.write('STREET_REGISTRY_PUBLISHERS is not valid JSON; starting with no publishers.\n');
    return dir;
  }
  for (const s of seeds) {
    if (s && typeof s.id === 'string' && typeof s.apiKey === 'string' && Array.isArray(s.namespaces)) {
      dir.register(s.id, s.apiKey, s.namespaces);
    }
  }
  return dir;
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '0.0.0.0';
  const service = new RegistryService({ publishers: loadPublishers() });
  const handle = await startRegistryServer(service, port, host);
  const addr = handle.server.address();
  const bound = typeof addr === 'object' && addr ? `${host}:${addr.port}` : `${host}:${port}`;
  process.stdout.write(`@streetjs/registry-server listening on http://${bound}/api/v1\n`);

  const shutdown = (): void => {
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e: unknown) => {
  process.stderr.write(`registry-server failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
