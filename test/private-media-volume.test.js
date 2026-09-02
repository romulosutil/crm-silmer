import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MediaQuotaExceededError,
  PrivateMediaVolume,
} from '../modules/integration-reliability/src/private-media-volume.js';

/** @returns {any} */
function repositoryFixture() {
  /** @type {any[]} */
  const events = [];
  return {
    events,
    /** @param {any} event */
    async markAvailable(event) {
      events.push(['available', event]);
    },
    /** @param {any} event */
    async markDeleted(event) {
      events.push(['deleted', event]);
    },
    /** @param {any} event */
    async markQuarantined(event) {
      events.push(['quarantined', event]);
    },
    /** @param {any} event */
    async markRejected(event) {
      events.push(['rejected', event]);
    },
    /** @param {any} event */
    async markUnavailable(event) {
      events.push(['unavailable', event]);
    },
  };
}

/** @param {Record<string, any>} options @param {(fixture: {repository: any, rootDirectory: string, volume: PrivateMediaVolume}) => Promise<void>} work */
async function withVolume(options, work) {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'crm-private-media-'));
  const repository = repositoryFixture();
  const volume = new PrivateMediaVolume({
    maxBytes: 1024,
    maxFileBytes: 512,
    repository,
    rootDirectory,
    scanner: {
      async scan() {
        return {
          clean: true,
          detectedMimeType: 'image/png',
          signatureUpdatedAt: new Date('2026-09-02T11:00:00.000Z'),
        };
      },
    },
    now: () => new Date('2026-09-02T12:00:00.000Z'),
    ...options,
  });
  try {
    await work({ repository, rootDirectory, volume });
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
}

test('writes clean media atomically with an opaque path and content hash', async () => {
  await withVolume({}, async ({ repository, rootDirectory, volume }) => {
    await writeFile(join(rootDirectory, '.partial-interrupted'), 'partial');
    const stored = await volume.store({
      bytes: Buffer.from('safe-image-bytes'),
      declaredMimeType: 'image/png',
      mediaId: 'media-1',
    });

    assert.equal(stored.availabilityStatus, 'available');
    assert.match(stored.contentSha256, /^[0-9a-f]{64}$/u);
    assert.doesNotMatch(stored.storageKey, /media-1/u);
    assert.deepEqual(await readdir(rootDirectory), [stored.storageKey]);
    assert.equal(repository.events[0][0], 'available');
    assert.equal(repository.events[0][1].sizeBytes, 16);
  });
});

test('fails quota closed and removes every partial file', async () => {
  await withVolume(
    { maxBytes: 4, maxFileBytes: 4 },
    async ({ repository, rootDirectory, volume }) => {
      await assert.rejects(
        volume.store({
          bytes: Buffer.from('too-large'),
          declaredMimeType: 'image/png',
          mediaId: 'media-quota',
        }),
        MediaQuotaExceededError,
      );
      assert.deepEqual(await readdir(rootDirectory), []);
      assert.equal(repository.events.at(-1)[0], 'unavailable');
    },
  );
});

test('keeps stale scanner signatures quarantined and rejects unsafe bytes', async () => {
  await withVolume(
    {
      scanner: {
        async scan() {
          return {
            clean: true,
            detectedMimeType: 'image/png',
            signatureUpdatedAt: new Date('2026-08-31T12:00:00.000Z'),
          };
        },
      },
    },
    async ({ repository, volume }) => {
      const stored = await volume.store({
        bytes: Buffer.from('quarantined'),
        declaredMimeType: 'image/png',
        mediaId: 'media-stale',
      });
      assert.equal(stored.availabilityStatus, 'quarantined');
      assert.equal(repository.events.at(-1)[0], 'quarantined');
    },
  );

  await withVolume(
    {
      scanner: {
        async scan() {
          return {
            clean: false,
            detectedMimeType: 'application/x-msdownload',
            signatureUpdatedAt: new Date('2026-09-02T11:00:00.000Z'),
          };
        },
      },
    },
    async ({ repository, rootDirectory, volume }) => {
      const stored = await volume.store({
        bytes: Buffer.from('unsafe'),
        declaredMimeType: 'image/png',
        mediaId: 'media-unsafe',
      });
      assert.equal(stored.availabilityStatus, 'rejected');
      assert.deepEqual(await readdir(rootDirectory), []);
      assert.equal(repository.events.at(-1)[0], 'rejected');
    },
  );
});

test('marks a missing file lost and deletes an existing file idempotently', async () => {
  await withVolume({}, async ({ repository, rootDirectory, volume }) => {
    const stored = await volume.store({
      bytes: Buffer.from('temporary'),
      declaredMimeType: 'image/png',
      mediaId: 'media-delete',
    });
    assert.ok(stored.storageKey);
    await unlink(join(rootDirectory, stored.storageKey));

    assert.equal(
      await volume.resolvePath({
        mediaId: 'media-delete',
        storageKey: stored.storageKey,
      }),
      null,
    );
    assert.equal(repository.events.at(-1)[0], 'unavailable');

    await volume.delete({
      mediaId: 'media-delete',
      reason: 'journey_terminal',
      storageKey: stored.storageKey,
    });
    assert.equal(repository.events.at(-1)[0], 'deleted');
  });
});
