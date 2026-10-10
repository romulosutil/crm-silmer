import { spawn } from 'node:child_process';
import { mkdir, lstat, chmod, unlink } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import { setInterval, clearInterval } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

export const CLAMAV_SOCKET_PATH = '/tmp/crm-clamd/clamd.sock';

/** A bounded local readiness probe; TCP is deliberately unsupported.
 * @param {{socketPath?:string, timeoutMs?:number}} [options] @returns {Promise<boolean>} */
export function pingClamAv({
  socketPath = CLAMAV_SOCKET_PATH,
  timeoutMs = 2000,
} = {}) {
  return new Promise((resolve) => {
    const socket = createConnection({ path: socketPath });
    let response = '';
    const timer = setTimeout(() => finish(false), timeoutMs);
    /** @param {boolean} healthy */
    const finish = (healthy) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(healthy);
    };
    socket.on('error', () => finish(false));
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (data) => {
      response += data.toString();
      if (response.length > 16) return finish(false);
      if (response.includes('\0')) finish(response === 'PONG\0');
    });
    socket.on('end', () => finish(false));
  });
}

/** One foreground engine, supervised inside the existing worker.
 * Updates stop the previous engine before loading its replacement.
 */
export class ClamAvDaemon {
  /** @param {{spawnImpl?:Function,pingImpl?:Function,socketPath?:string,startupTimeoutMs?:number,stopTimeoutMs?:number,retryIntervalMs?:number,onFailure?:()=>void}} [options] */
  constructor({
    spawnImpl = spawn,
    pingImpl = pingClamAv,
    socketPath = CLAMAV_SOCKET_PATH,
    startupTimeoutMs = 60000,
    stopTimeoutMs = 10000,
    retryIntervalMs = 5000,
    onFailure = () => {},
  } = {}) {
    this.spawnImpl = spawnImpl;
    this.pingImpl = pingImpl;
    this.socketPath = socketPath;
    this.startupTimeoutMs = startupTimeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
    this.retryIntervalMs = retryIntervalMs;
    this.onFailure = onFailure;
    /** @type {any} */ this.child = undefined;
    /** @type {Promise<void>|undefined} */ this.exited = undefined;
    /** @type {NodeJS.Timeout|undefined} */ this.timer = undefined;
    this.stopping = false;
    this.operation = Promise.resolve();
  }

  /** Serialize startup, signature reload and shutdown. @param {()=>Promise<void>} work */
  serialize(work) {
    const result = this.operation.then(work);
    this.operation = result.catch(() => {});
    return result;
  }

  async start() {
    this.stopping = false;
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (!this.child && !this.stopping)
          void this.serialize(() => this.launch()).catch(() =>
            this.onFailure(),
          );
      }, this.retryIntervalMs);
      this.timer.unref();
    }
    // A failed engine blocks media, while text delivery and recovery remain live.
    await this.serialize(() => this.launch()).catch(() => this.onFailure());
  }

  async restart() {
    await this.serialize(async () => {
      if (this.stopping) throw new Error('Malware scanner is unavailable');
      await this.terminate();
      await this.launch();
    });
  }

  async launch() {
    if (this.stopping || this.child) return;
    const directory = dirname(this.socketPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      (process.getuid && metadata.uid !== process.getuid())
    ) {
      throw new Error('Malware scanner is unavailable');
    }
    await chmod(directory, 0o700);
    const oldSocket = await lstat(this.socketPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (oldSocket) {
      if (!oldSocket.isSocket())
        throw new Error('Malware scanner is unavailable');
      await unlink(this.socketPath);
    }
    const child = this.spawnImpl(
      'clamd',
      ['--config-file=/app/clamd.conf', '--foreground=true'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    this.child = child;
    this.exited = new Promise((resolve) => {
      const exited = () => {
        if (this.child === child) this.child = undefined;
        resolve();
      };
      child.once('exit', exited);
      child.once('error', exited);
    });
    const deadline = Date.now() + this.startupTimeoutMs;
    try {
      while (this.child === child && !this.stopping && Date.now() < deadline) {
        if (
          await this.pingImpl({ socketPath: this.socketPath, timeoutMs: 1000 })
        )
          return;
        await delay(100);
      }
      throw new Error('Malware scanner is unavailable');
    } catch {
      await this.terminate();
      throw new Error('Malware scanner is unavailable');
    }
  }

  async terminate() {
    const child = this.child;
    if (!child) return;
    child.kill('SIGTERM');
    let timeout;
    const ended = await Promise.race([
      this.exited?.then(() => true),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), this.stopTimeoutMs);
      }),
    ]);
    clearTimeout(timeout);
    if (!ended && this.child === child) {
      child.kill('SIGKILL');
      await this.exited;
    }
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.serialize(() => this.terminate());
  }
}
