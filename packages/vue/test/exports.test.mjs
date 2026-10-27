// Export-shape test. Composable type-correctness against Vue is enforced by tsc.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as vue from '../dist/index.js';

describe('@streetjs/vue exports', () => {
  it('exports provide/inject + composables', () => {
    for (const name of ['provideStreetClient', 'useApi', 'useQuery', 'useSession', 'useAuth', 'useSearch', 'useRealtime', 'useRealtimeState', 'useChannel', 'useAI']) {
      assert.equal(typeof vue[name], 'function', `${name} must be exported`);
    }
  });
});
