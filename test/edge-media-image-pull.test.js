import assert from 'node:assert/strict';
import test from 'node:test';

import { pullPinnedImage } from '../scripts/edge-media-image-pull.mjs';

const image = `nginx:1.31.4-alpine-slim@sha256:${'a'.repeat(64)}`;

test('T31 image pull keeps the approved digest when a mirror is rate limited', () => {
  /** @type {string[]} */
  const attempted = [];
  const selected = pullPinnedImage(image, (candidate) => {
    attempted.push(candidate);
    if (candidate.startsWith('public.ecr.aws/')) {
      throw new Error('toomanyrequests: Rate exceeded');
    }
  });
  assert.equal(selected, `mirror.gcr.io/library/${image}`);
  assert.deepEqual(attempted, [
    `public.ecr.aws/docker/library/${image}`,
    `mirror.gcr.io/library/${image}`,
  ]);
});

test('T31 image pull uses the official registry if both mirrors are unavailable', () => {
  /** @type {string[]} */
  const attempted = [];
  const selected = pullPinnedImage(image, (candidate) => {
    attempted.push(candidate);
    if (!candidate.startsWith('docker.io/'))
      throw new Error('mirror unavailable');
  });
  assert.equal(selected, `docker.io/library/${image}`);
  assert.deepEqual(attempted, [
    `public.ecr.aws/docker/library/${image}`,
    `mirror.gcr.io/library/${image}`,
    `docker.io/library/${image}`,
  ]);
});

test('T31 image pull fails the gate when every source fails or the digest is missing', () => {
  assert.throws(
    () =>
      pullPinnedImage(image, () => {
        throw new Error('rate limited');
      }),
    (error) => error instanceof AggregateError && error.errors.length === 3,
  );
  assert.throws(
    () => pullPinnedImage('nginx:latest', () => {}),
    assert.AssertionError,
  );
});
