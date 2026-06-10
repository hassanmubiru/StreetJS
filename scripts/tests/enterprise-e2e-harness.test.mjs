// scripts/tests/enterprise-e2e-harness.test.mjs
//
// Unit tests for the Enterprise Console APIs Layer B suite harness (Requirement
// 6.10). These exercise the harness's pure, container-free logic:
//
//   • the JWT minting helper produces tokens the framework's JwtService verifies
//     with the SAME secret the running app uses — this is exactly what the suite
//     presents, so a regression here would mean the suite cannot authenticate.
//   • the container-runtime prerequisite probe returns either `null` (a usable
//     runtime) or a well-formed BlockedReason `{ missingPrerequisite, kind }` —
//     the shape the runner needs to record an honest BLOCKED.
//   • findFreePort yields a bindable loopback port.
//
// The full container round trip (start PostgreSQL → start app → drive the
// console over HTTP) is Layer B and is covered by the enterprise.api
// Verification Artifact produced through CommandRunner; it is intentionally NOT
// run here so the unit suite stays green without a container runtime.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { JwtService } from 'streetjs';
import { token } from '../enterprise/e2e.mjs';
import {
  probeContainerPrerequisites,
  findFreePort,
  POSTGRES_IMAGE,
  CONSOLE_JWT_SECRET,
} from '../enterprise/lib.mjs';

describe('enterprise console Layer B harness — pure logic', () => {
  it('token() mints a Bearer payload the running app verifies with the shared secret', () => {
    const jwt = new JwtService(CONSOLE_JWT_SECRET);
    const minted = token(['admin']);
    const payload = jwt.verify(minted);

    assert.ok(payload, 'token must verify under the shared console secret');
    assert.deepEqual(payload.roles, ['admin'], 'roles must round-trip');
    assert.equal(typeof payload.sub, 'string');
  });

  it('token() signed with the shared secret does NOT verify under a different secret (soundness)', () => {
    const stranger = new JwtService('a-totally-different-secret-9876543210-xyz');
    const minted = token(['admin']);
    assert.equal(stranger.verify(minted), null, 'a token must not verify under a different secret');
  });

  it('probeContainerPrerequisites returns null or a well-formed BlockedReason', () => {
    const result = probeContainerPrerequisites();
    if (result === null) return; // a usable container runtime is present

    assert.equal(typeof result.missingPrerequisite, 'string');
    assert.ok(result.missingPrerequisite.length > 0, 'missing prerequisite id must be non-empty');
    assert.ok(['runtime', 'service'].includes(result.kind), `kind must be runtime|service, got ${result.kind}`);
    assert.ok(
      result.missingPrerequisite === 'docker' ||
        result.missingPrerequisite === 'docker-daemon' ||
        result.missingPrerequisite === `docker-image:${POSTGRES_IMAGE}`,
      `unexpected prerequisite id: ${result.missingPrerequisite}`,
    );
  });

  it('findFreePort returns a usable ephemeral port', async () => {
    const port = await findFreePort();
    assert.equal(typeof port, 'number');
    assert.ok(port > 0 && port < 65536, `port out of range: ${port}`);
  });
});
