import assert from 'node:assert/strict';
import test from 'node:test';

import { ClamAvMediaScanner } from '../modules/integration-reliability/src/clamav-media-scanner.js';

test('scans with bounded commands and returns only clean technical metadata', async () => {
  /** @type {Array<{args: string[], command: string, options: Record<string, unknown>}>} */
  const calls = [];
  const scanner = new ClamAvMediaScanner({
    async execFileImpl(
      /** @type {string} */ command,
      /** @type {string[]} */ args,
      /** @type {Record<string, unknown>} */ options,
    ) {
      calls.push({ args, command, options });
      return { stdout: command === 'file' ? 'image/png\n' : '' };
    },
    signatureFiles: [],
  });

  await assert.rejects(
    scanner.scan('/private/synthetic-upload'),
    /signature/iu,
  );
  assert.deepEqual(
    calls.map(({ command }) => command),
    ['clamscan', 'file'],
  );
  assert.equal(
    calls.every(({ options }) => options.windowsHide),
    true,
  );
  assert.equal(
    calls.every(({ args }) => args.at(-1) === '/private/synthetic-upload'),
    true,
  );
});

test('treats ClamAV exit code one as infected and other failures as unavailable', async () => {
  const infected = new ClamAvMediaScanner({
    async execFileImpl(/** @type {string} */ command) {
      if (command === 'clamscan')
        throw Object.assign(new Error('infected'), { code: 1 });
      return { stdout: 'application/pdf\n' };
    },
    signatureFiles: [],
  });
  await assert.rejects(infected.scan('/private/infected'), /signature/iu);

  const unavailable = new ClamAvMediaScanner({
    async execFileImpl() {
      throw Object.assign(new Error('missing binary'), { code: 'ENOENT' });
    },
  });
  await assert.rejects(
    unavailable.scan('/private/unavailable'),
    /scanner is unavailable/iu,
  );
});
