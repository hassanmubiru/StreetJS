// Export-shape test. Verifies the public hook surface compiles and is exported.
// (Full hook render behavior is covered by consuming apps' test infra; the type
// correctness against React is enforced by `tsc` in CI.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as react from '../dist/index.js';

describe('@streetjs/react exports', () => {
  it('exports the provider + client hook', () => {
    assert.equal(typeof react.StreetProvider, 'function');
    assert.equal(typeof react.useStreetClient, 'function');
  });

  it('exports all data/realtime/ai hooks', () => {
    for (const name of ['useQuery', 'useMutation', 'useSession', 'useAuth', 'useSearch', 'useRealtime', 'useRealtimeState', 'useChannel', 'useAIChat']) {
      assert.equal(typeof react[name], 'function', `${name} must be exported`);
    }
  });
});
