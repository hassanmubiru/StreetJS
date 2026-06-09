// tests/certification/documentation-certification.test.ts
// Certifies that required docs exist and that 100% of the principal public API
// surface is referenced in the documentation (excluding generated _site HTML).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');
const docsDir = join(repoRoot, 'docs');

// Read every source markdown doc (exclude the generated Jekyll _site/ output).
function readAllDocs(): string {
  const parts: string[] = [];
  function walk(dir: string): void {
    for (const e of readdirSync(dir)) {
      if (e === '_site' || e.startsWith('.')) continue;
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (e.endsWith('.md')) parts.push(readFileSync(p, 'utf8'));
    }
  }
  walk(docsDir);
  return parts.join('\n');
}

const REQUIRED_DOCS = [
  'getting-started/index.md', 'user-guide.md', 'api-reference.md', 'cli-reference.md',
  'security.md', 'migration.md', 'troubleshooting.md', 'browser-builds.md',
  'transports/rabbitmq.md', 'transports/kafka.md',
];

// Principal user-facing public APIs that MUST be documented.
const PRINCIPAL_API = [
  'streetApp', 'JwtService', 'RbacService', 'ApiKeyService', 'RefreshTokenService',
  'OAuthManager', 'WebAuthnService', 'AuditLogger', 'FieldEncryptor', 'RetentionJob',
  'ComplianceReporter', 'JobQueue', 'CronScheduler', 'OtelTracer', 'MetricsRegistry',
  'HealthCheckRegistry', 'Logger', 'DistributedCache', 'ReplicationCoordinator',
  'AgentExecutor', 'RabbitMqTransport', 'KafkaClient', 'KafkaProducer', 'KafkaConsumer',
  'WebhookDispatcher', 'SecretRotationManager', 'AzureKeyVaultProvider', 'QueryBuilder',
  'PgPool',
];

describe('DOCUMENTATION — required documents exist and are non-trivial', () => {
  for (const doc of REQUIRED_DOCS) {
    it(`docs/${doc} exists and has substantive content`, () => {
      const txt = readFileSync(join(docsDir, doc), 'utf8');
      assert.ok(txt.length > 400, `docs/${doc} should be substantive`);
    });
  }
});

describe('DOCUMENTATION — principal public API coverage', () => {
  it('documents 100% of the principal public API surface', () => {
    const all = readAllDocs();
    const undocumented = PRINCIPAL_API.filter((sym) => !all.includes(sym));
    const coverage = ((PRINCIPAL_API.length - undocumented.length) / PRINCIPAL_API.length) * 100;
    assert.deepEqual(undocumented, [], `undocumented principal APIs (${coverage.toFixed(1)}% covered): ${undocumented.join(', ')}`);
  });
});
