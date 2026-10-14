import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import test from 'node:test';

import {
  backfillContactPhoneLookup,
  contactPhoneHash,
} from '../modules/contacts/src/index.js';

const envelopeKey = Buffer.alloc(32, 5);
const lookupKey = Buffer.alloc(32, 6);

/** @param {string} id @param {string} contactId @param {string} externalIdentityId */
function identity(id, contactId, externalIdentityId) {
  const lookupHash = 'a'.repeat(64);
  const iv = Buffer.alloc(12, Number(id.slice(-1)));
  const cipher = createCipheriv('aes-256-gcm', envelopeKey, iv);
  cipher.setAAD(
    Buffer.from(JSON.stringify(['crm.contact_identities', 1, lookupHash])),
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ externalIdentityId }), 'utf8'),
    cipher.final(),
  ]);
  return {
    id,
    current_contact_id: contactId,
    external_identity_lookup_hash: lookupHash,
    identity_envelope: {
      algorithm: 'AES-256-GCM',
      keyVersion: 1,
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    },
  };
}

test('backfill indexes every confirmed historical number, skips synthetic IDs and replays safely', async () => {
  const identities = [
    identity('identity-1', 'contact-a', '5511987654321'),
    identity('identity-2', 'contact-a', '5511976543210'),
    identity('identity-3', 'contact-b', '5511987654321'),
    identity('identity-4', 'contact-c', '999123456789012'),
  ];
  const aliases = new Set();
  /** @param {string} sql @param {any[]} values */
  const query = async (sql, values) => {
    if (sql.includes('FROM crm.contact_identities')) {
      return {
        rows: identities
          .filter((row) => row.id > values[0])
          .slice(0, values[1]),
      };
    }
    if (sql.includes('INSERT INTO crm.contact_phone_lookup')) {
      const key = `${values[1]}:${values[2]}`;
      if (aliases.has(key)) return { rows: [] };
      aliases.add(key);
      return { rows: [{ contact_id: values[0] }] };
    }
    if (sql.includes('SELECT 1 FROM crm.contact_phone_lookup')) {
      return {
        rows: aliases.has(`${values[0]}:${values[1]}`)
          ? [{ '?column?': 1 }]
          : [],
      };
    }
    throw new Error('Unexpected query');
  };
  const database = {
    query,
    transaction: async (/** @type {(client: any) => Promise<any>} */ work) =>
      work({ query }),
  };
  const options = { envelopeKey, lookupKey, batchSize: 2 };
  const firstPage = await backfillContactPhoneLookup(database, {
    ...options,
    maxBatches: 1,
  });
  assert.equal(firstPage.complete, false);
  assert.equal(firstPage.after, 'identity-2');
  const resumed = await backfillContactPhoneLookup(database, {
    ...options,
    after: firstPage.after,
  });
  assert.equal(resumed.scanned, 2);
  assert.equal(resumed.complete, true);
  const preview = await backfillContactPhoneLookup(database, options);
  assert.deepEqual(
    {
      complete: preview.complete,
      missing: preview.missing,
      invalid: preview.invalid,
    },
    { complete: true, missing: 3, invalid: 1 },
  );
  const applied = await backfillContactPhoneLookup(database, {
    ...options,
    apply: true,
  });
  assert.deepEqual(
    { inserted: applied.inserted, invalid: applied.invalid },
    { inserted: 3, invalid: 1 },
  );
  assert.equal(aliases.size, 3);
  const hash = contactPhoneHash('5511987654321', lookupKey);
  assert.ok(aliases.has(`identity-1:${hash}`));
  assert.ok(aliases.has(`identity-3:${hash}`));
  const replay = await backfillContactPhoneLookup(database, {
    ...options,
    apply: true,
  });
  assert.equal(replay.inserted, 0);
  assert.equal(replay.existing, 3);
  const verified = await backfillContactPhoneLookup(database, options);
  assert.equal(verified.missing, 0);
  assert.equal(verified.complete, true);
});
