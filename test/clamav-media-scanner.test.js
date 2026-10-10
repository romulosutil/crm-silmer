import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ClamAvMediaScanner } from '../modules/integration-reliability/src/clamav-media-scanner.js';

test('scans with bounded commands and returns only clean technical metadata', async (context) => {
  const fixture = await signatures(context);
  /** @type {Array<{args: string[], command: string, options: Record<string, unknown>}>} */
  const calls = [];
  const scanner = new ClamAvMediaScanner({
    ...fixture,
    async execFileImpl(
      /** @type {string} */ command,
      /** @type {string[]} */ args,
      /** @type {Record<string, unknown>} */ options,
    ) {
      calls.push({ args, command, options });
      return { stdout: command === 'file' ? 'image/png\n' : '' };
    },
  });

  assert.equal((await scanner.scan('/private/synthetic-upload')).clean, true);
  assert.deepEqual(
    calls.map(({ command }) => command),
    ['clamdscan', 'file'],
  );
  assert.deepEqual(calls[0].args.slice(0, -1), [
    '--fdpass',
    '--config-file=/app/clamd.conf',
    '--no-summary',
    '--infected',
    '--',
  ]);
  assert.equal(calls[0].options.timeout, 60_000);
  assert.equal(calls[0].options.maxBuffer, 65_536);
  assert.equal(calls[1].options.timeout, 10_000);
  assert.equal(
    calls.every(({ options }) => options.windowsHide),
    true,
  );
  assert.equal(
    calls.every(({ args }) => args.at(-1) === '/private/synthetic-upload'),
    true,
  );
});

test('treats ClamAV exit code one as infected and other failures as unavailable', async (context) => {
  const fixture = await signatures(context);
  const infected = new ClamAvMediaScanner({
    ...fixture,
    async execFileImpl(/** @type {string} */ command) {
      if (command === 'clamdscan')
        throw Object.assign(new Error('infected'), { code: 1 });
      return { stdout: 'application/pdf\n' };
    },
  });
  assert.equal((await infected.scan('/private/infected')).clean, false);

  const unavailable = new ClamAvMediaScanner({
    ...fixture,
    async execFileImpl() {
      throw Object.assign(new Error('missing binary'), { code: 'ENOENT' });
    },
  });
  await assert.rejects(
    unavailable.scan('/private/unavailable'),
    /scanner is unavailable/iu,
  );
});

/** @param {import('node:test').TestContext} context */
async function signatures(context) {
  const directory = await mkdtemp(join(tmpdir(), 'crm-clamd-scanner-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const signature = join(directory, 'daily.cvd');
  const marker = join(directory, '.freshclam-verified');
  const timestamp = new Date('2026-10-10T15:23:19.155Z');
  await writeFile(signature, 'synthetic signature fixture');
  await writeFile(marker, timestamp.toISOString());
  return {
    signatureFiles: [signature],
    signatureFreshnessFile: marker,
    signature,
    marker,
    timestamp,
  };
}

test('returns frozen safe metadata after daemon success with verified signature freshness', async (context) => {
  const fixture = await signatures(context);
  const scanner = new ClamAvMediaScanner({
    ...fixture,
    async execFileImpl(/** @type {string} */ command) {
      return {
        stdout:
          command === 'file'
            ? 'image/png\n'
            : '/private/synthetic-upload: OK\n',
        stderr: '/private/synthetic-upload',
      };
    },
  });
  const result = await scanner.scan('/private/synthetic-upload');
  assert.deepEqual(result, {
    clean: true,
    detectedMimeType: 'image/png',
    signatureUpdatedAt: fixture.timestamp,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(result).includes('/private/'), false);
});

test('daemon infection remains unclean metadata instead of a successful clean scan', async (context) => {
  const fixture = await signatures(context);
  const scanner = new ClamAvMediaScanner({
    ...fixture,
    async execFileImpl(/** @type {string} */ command) {
      if (command === 'clamdscan')
        throw Object.assign(new Error('synthetic infection'), { code: 1 });
      return { stdout: 'application/octet-stream\n' };
    },
  });
  const result = await scanner.scan('/private/infected');
  assert.equal(result.clean, false);
  assert.equal(result.detectedMimeType, 'application/octet-stream');
  assert.deepEqual(result.signatureUpdatedAt, fixture.timestamp);
});

test('daemon transport errors, timeouts and aborts fail closed without a clamscan fallback', async (context) => {
  const fixture = await signatures(context);
  for (const code of [2, 'ENOENT', 'ECONNREFUSED', 'ETIMEDOUT', 'ABORT_ERR']) {
    /** @type {string[]} */
    const commands = [];
    const scanner = new ClamAvMediaScanner({
      ...fixture,
      async execFileImpl(/** @type {string} */ command) {
        commands.push(command);
        throw Object.assign(new Error('synthetic scanner error'), { code });
      },
    });
    await assert.rejects(
      scanner.scan('/private/unavailable'),
      /scanner is unavailable/iu,
    );
    assert.deepEqual(commands, ['clamdscan']);
  }
});

test('captures freshness before scanning when the daemon database is refreshed during a scan', async (context) => {
  const fixture = await signatures(context);
  const updatedAt = new Date(fixture.timestamp.getTime() + 60_000);
  const scanner = new ClamAvMediaScanner({
    ...fixture,
    async execFileImpl(/** @type {string} */ command) {
      if (command === 'clamdscan')
        await writeFile(fixture.marker, updatedAt.toISOString());
      return { stdout: command === 'file' ? 'image/png\n' : '' };
    },
  });
  assert.deepEqual(
    (await scanner.scan('/private/synthetic-upload')).signatureUpdatedAt,
    fixture.timestamp,
  );
  assert.deepEqual(
    (await scanner.scan('/private/synthetic-upload')).signatureUpdatedAt,
    updatedAt,
  );
});

test('missing installed signatures fail closed before the daemon or MIME detector runs', async () => {
  let called = false;
  const scanner = new ClamAvMediaScanner({
    signatureFiles: [],
    async execFileImpl() {
      called = true;
      return { stdout: 'image/png\n' };
    },
  });
  await assert.rejects(
    scanner.scan('/private/synthetic-upload'),
    /signature/iu,
  );
  assert.equal(called, false);
});

test('passes the abort signal to both daemon client and MIME detection', async (context) => {
  const fixture = await signatures(context);
  const controller = new AbortController();
  /** @type {unknown[]} */
  const signals = [];
  const scanner = new ClamAvMediaScanner({
    ...fixture,
    async execFileImpl(
      /** @type {string} */ command,
      /** @type {string[]} */ _args,
      /** @type {Record<string, unknown>} */ options,
    ) {
      signals.push(options.signal);
      return { stdout: command === 'file' ? 'audio/ogg\n' : '' };
    },
  });
  await scanner.scan('/private/synthetic-audio', controller.signal);
  assert.deepEqual(signals, [controller.signal, controller.signal]);
});

test('missing marker uses installed signature date but corrupt marker cannot claim freshness', async (context) => {
  const fixture = await signatures(context);
  const scanner = new ClamAvMediaScanner({
    ...fixture,
    async execFileImpl(/** @type {string} */ command) {
      return { stdout: command === 'file' ? 'video/mp4\n' : '' };
    },
  });
  await rm(fixture.marker);
  const result = await scanner.scan('/private/synthetic-video');
  assert.deepEqual(
    result.signatureUpdatedAt,
    (await stat(fixture.signature)).mtime,
  );
  await writeFile(fixture.marker, 'invalid freshness');
  await assert.rejects(
    scanner.scan('/private/synthetic-video'),
    /Invalid signature freshness/u,
  );
});

test('rejects empty or multiline MIME detector responses after a clean daemon scan', async (context) => {
  const fixture = await signatures(context);
  for (const response of ['', 'image/png\naudio/ogg', 'image/png\raudio/ogg']) {
    const scanner = new ClamAvMediaScanner({
      ...fixture,
      async execFileImpl(/** @type {string} */ command) {
        return { stdout: command === 'file' ? response : '' };
      },
    });
    await assert.rejects(
      scanner.scan('/private/synthetic-upload'),
      /MIME detector returned an invalid type/u,
    );
  }
});
