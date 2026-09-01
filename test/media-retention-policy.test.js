import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateMediaRetentionPolicy } from '../scripts/validate-media-retention.mjs';

const policyUrl = new URL(
  '../docs/phase0/media-retention-policy.json',
  import.meta.url,
);

async function policy() {
  return JSON.parse(await readFile(policyUrl, 'utf8'));
}

test('validates the approved internal zero-cost media policy', async () => {
  const document = await policy();
  assert.doesNotThrow(() => validateMediaRetentionPolicy(document));
  assert.equal(document.transientMedia.maximumAgeDays, 7);
  assert.equal(document.validFileArchive.automaticApiIntegration, false);
  assert.equal(
    document.futureObjectStorage.subscriptionOrProvisioningAuthorized,
    false,
  );
});

test('rejects a later-of retention rule or an R2 activation claim', async () => {
  const unsafeRetention = await policy();
  unsafeRetention.transientMedia.expiryRule = 'latest-of';
  assert.throws(
    () => validateMediaRetentionPolicy(unsafeRetention),
    /whichever comes first/iu,
  );

  const unsafeCost = await policy();
  unsafeCost.futureObjectStorage.subscriptionOrProvisioningAuthorized = true;
  assert.throws(
    () => validateMediaRetentionPolicy(unsafeCost),
    /R2.*deferred|deferred.*R2/iu,
  );
});

test('rejects public media and an implied Dropbox API integration', async () => {
  const publicMedia = await policy();
  publicMedia.storage.publicAccess = true;
  assert.throws(() => validateMediaRetentionPolicy(publicMedia), /private/iu);

  const automaticDropbox = await policy();
  automaticDropbox.validFileArchive.automaticApiIntegration = true;
  assert.throws(
    () => validateMediaRetentionPolicy(automaticDropbox),
    /Dropbox/iu,
  );

  for (const field of [
    'tokenRef',
    'oauthClientId',
    'sdk',
    'webhook',
    'apiEndpoint',
  ]) {
    const hiddenIntegration = await policy();
    hiddenIntegration.validFileArchive[field] = 'must-not-pass';
    assert.throws(
      () => validateMediaRetentionPolicy(hiddenIntegration),
      /closed schema/iu,
    );
  }
});

test('rejects applying seven-day retention to durable commercial evidence', async () => {
  const baseline = await policy();
  for (const protectedClass of baseline.durableDataExcludedFromTransientPolicy) {
    const unsafe = structuredClone(baseline);
    unsafe.durableDataExcludedFromTransientPolicy =
      unsafe.durableDataExcludedFromTransientPolicy.filter(
        /** @param {string} candidate */
        (candidate) => candidate !== protectedClass,
      );
    assert.throws(
      () => validateMediaRetentionPolicy(unsafe),
      /cannot use transient retention/iu,
    );
  }
});
