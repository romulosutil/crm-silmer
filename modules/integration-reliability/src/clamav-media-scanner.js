import { readFile, stat } from 'node:fs/promises';
import { executeMediaCommand } from './media-command.js';

const execute = executeMediaCommand;
const SIGNATURE_FILES = Object.freeze([
  '/var/lib/clamav/daily.cld',
  '/var/lib/clamav/daily.cvd',
  '/var/lib/clamav/main.cld',
  '/var/lib/clamav/main.cvd',
]);

/**
 * Fail-closed adapter for the persistent ClamAV daemon and libmagic installed
 * in the runtime image. The daemon config selects a private Unix socket;
 * descriptor passing avoids exposing a TCP listener or reloading signatures
 * per file. Command output is never returned or logged because it may contain
 * the private temporary path.
 */
export class ClamAvMediaScanner {
  /** @param {{execFileImpl?: Function, signatureFiles?: string[], signatureFreshnessFile?: string}} [options] */
  constructor({
    execFileImpl = execute,
    signatureFiles = [...SIGNATURE_FILES],
    signatureFreshnessFile = '/var/lib/clamav/.freshclam-verified',
  } = {}) {
    if (typeof execFileImpl !== 'function') {
      throw new TypeError('execFileImpl must be a function');
    }
    this.execFile = execFileImpl;
    this.signatureFiles = [...signatureFiles];
    this.signatureFreshnessFile = signatureFreshnessFile;
  }

  /** @param {string} path @param {AbortSignal} [signal] */
  async scan(path, signal) {
    // A scan overlapping a daemon reload must never borrow the new freshness
    // marker after scanning with the previous signature database.
    const signatureUpdatedAt = await confirmedSignatureTimestamp(
      this.signatureFiles,
      this.signatureFreshnessFile,
    );
    let clean = true;
    try {
      await this.execFile(
        'clamdscan',
        [
          '--fdpass',
          '--config-file=/app/clamd.conf',
          '--no-summary',
          '--infected',
          '--',
          path,
        ],
        {
          timeout: 60_000,
          maxBuffer: 65_536,
          ...(signal ? { signal } : {}),
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
          ...(signal ? { signal } : {}),
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
      signatureUpdatedAt,
    });
  }
}

/** @param {string[]} paths @param {string} marker */
async function confirmedSignatureTimestamp(paths, marker) {
  const installed = await newestSignatureTimestamp(paths);
  try {
    const timestamp = new Date((await readFile(marker, 'utf8')).trim());
    if (!Number.isFinite(timestamp.getTime()))
      throw new Error('Invalid signature freshness');
    return timestamp;
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return installed;
    throw error;
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
