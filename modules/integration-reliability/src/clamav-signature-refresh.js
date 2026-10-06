import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile, rename, rm } from 'node:fs/promises';
import { setInterval, clearInterval } from 'node:timers';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export class ClamAvSignatureRefresh {
  #execute;
  #marker;
  #onFailure;
  #generation = 0;
  /** @type {Promise<void>|undefined} */ #starting;
  /** @param {{execFileImpl?: Function,markerPath?: string,onFailure?: () => void}} [options] */
  constructor({
    execFileImpl = execute,
    markerPath = '/var/lib/clamav/.freshclam-verified',
    onFailure = () => {},
  } = {}) {
    this.#execute = execFileImpl;
    this.#marker = markerPath;
    this.#onFailure = onFailure;
    this.intervalMs = 24 * 3600000;
    /** @type {Promise<void>|undefined} */ this.inFlight = undefined;
    /** @type {NodeJS.Timeout|undefined} */ this.timer = undefined;
  }
  async refresh() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      const temporary = `${this.#marker}.${randomUUID()}.tmp`;
      try {
        await this.#execute(
          'freshclam',
          ['--config-file=/app/freshclam.conf', '--stdout'],
          { timeout: 180000, maxBuffer: 65536, windowsHide: true },
        );
        await writeFile(temporary, new Date().toISOString(), {
          mode: 0o600,
          flag: 'wx',
        });
        await rename(temporary, this.#marker);
      } catch {
        this.#onFailure();
        throw new Error('Signature refresh is unavailable');
      } finally {
        await rm(temporary, { force: true });
      }
    })().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
  async start() {
    if (this.timer) return;
    if (this.#starting) return this.#starting;
    const generation = ++this.#generation;
    this.#starting = (async () => {
      // A failed refresh never forges freshness; valid baseline may still be used.
      await this.refresh().catch(() => {});
      if (generation !== this.#generation) return;
      this.timer = setInterval(
        () => this.refresh().catch(() => {}),
        this.intervalMs,
      );
      this.timer.unref();
    })().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }
  async stop() {
    this.#generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight?.catch(() => {});
    await this.#starting;
  }
}
