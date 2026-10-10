import assert from 'node:assert/strict';

/**
 * Pull the same immutable official image across public registry mirrors.
 * @param {string} image
 * @param {(image: string) => void} pull
 * @returns {string}
 */
export function pullPinnedImage(image, pull) {
  assert.match(image, /^(?:nginx|node):[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}$/u);
  const candidates = [
    `public.ecr.aws/docker/library/${image}`,
    `mirror.gcr.io/library/${image}`,
    `docker.io/library/${image}`,
  ];
  const failures = [];
  for (const candidate of candidates) {
    try {
      pull(candidate);
      return candidate;
    } catch (error) {
      failures.push(error);
    }
  }
  throw new AggregateError(failures, `Cannot pull pinned image ${image}`);
}
