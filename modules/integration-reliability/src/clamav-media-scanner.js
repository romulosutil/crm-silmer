import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const SIGNATURE_FILES = Object.freeze([
  '/var/lib/clamav/daily.cld',
  '/var/lib/clamav/daily.cvd',
  '/var/lib/clamav/main.cld',
  '/var/lib/clamav/main.cvd',
]);

/**
 * Fail-closed adapter for the ClamAV and libmagic binaries installed in the
 * runtime image. Command output is never returned or logged because it may
 * contain the private temporary path.
 */
export class ClamAvMediaScanner {
  /** @param {{execFileImpl?: Function, signatureFiles?: string[]}} [options] */
  constructor({
    execFileImpl = execute,
    signatureFiles = [...SIGNATURE_FILES],
  } = {}) {
    if (typeof execFileImpl !== 'function') {
      throw new TypeError('execFileImpl must be a function');
    }
    this.execFile = execFileImpl;
    this.signatureFiles = [...signatureFiles];
  }

  /** @param {string} path */
  async scan(path) {
    let clean = true;
    try {
      await this.execFile(
        'clamscan',
        ['--no-summary', '--infected', '--', path],
        {
          timeout: 60_000,
          windowsHide: true,
        },
      );
    } catch (error) {
      if (Number(/** @type {any} */ (error)?.code) === 1) clean = false;
      else throw new Error('Malware scanner is unavailable', { cause: error });
    }

    const detectedMimeType = String(
      (
        await this.execFile('file', ['--brief', '--mime-type', '--', path], {
          timeout: 10_000,
          windowsHide: true,
        })
      ).stdout,
    ).trim();
    if (!detectedMimeType || /[\r\n]/u.test(detectedMimeType)) {
      throw new Error('MIME detector returned an invalid type');
    }

    return Object.freeze({
      clean,
      detectedMimeType,
      signatureUpdatedAt: await newestSignatureTimestamp(this.signatureFiles),
    });
  }
}

/** @param {string[]} paths */
async function newestSignatureTimestamp(paths) {
  const timestamps = [];
  for (const path of paths) {
    try {
      timestamps.push((await stat(path)).mtime);
    } catch (error) {
      if (/** @type {any} */ (error)?.code !== 'ENOENT') throw error;
    }
  }
  if (timestamps.length === 0) {
    throw new Error('ClamAV signatures are unavailable');
  }
  return new Date(Math.max(...timestamps.map((value) => value.getTime())));
}
