import assert from 'node:assert/strict';
import test from 'node:test';

import { appendIdentityUserChangedEvent } from '../apps/api/src/identity-runtime.js';

test('identity user event is versioned under a transaction lock without PII', async () => {
  /** @type {Array<{sql:string, values?:unknown[]}>} */
  const statements = [];
  await appendIdentityUserChangedEvent(
    {
      query: async (
        /** @type {string} */ sql,
        /** @type {unknown[]} */ values = [],
      ) => {
        statements.push({ sql, values });
      },
    },
    { correlationId: 'correlation-1', userId: 'user-1' },
  );
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /pg_advisory_xact_lock/u);
  assert.match(
    statements[1].sql,
    /coalesce\(max\(aggregate_version\), 0\) \+ 1/u,
  );
  assert.match(statements[1].sql, /'\{\}'::jsonb/u);
  assert.equal(statements[1].values?.[1], 'user-1');
  assert.equal(statements[1].values?.[2], 'correlation-1');
  assert.doesNotMatch(statements[1].sql, /email|name|password/u);
});
