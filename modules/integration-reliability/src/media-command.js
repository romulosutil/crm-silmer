import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
/** Abort/error callbacks may precede child close. Never release a writer guard
 * before inherited descriptors and stdio have actually closed.
 * @param {string} file @param {string[]} args @param {import('node:child_process').ExecFileOptions} options */
export async function executeMediaCommand(file, args, options) {
  // Native execFile AbortSignal sends TERM independently of killSignal and
  // clears its timeout on the error callback. Own cancellation must hard-kill.
  const { signal, ...commandOptions } = options;
  const pending = execute(file, args, {
    ...commandOptions,
    killSignal: 'SIGKILL',
  });
  const closed = new Promise((resolve) =>
    pending.child.once('close', () => resolve(undefined)),
  );
  let aborted = false;
  const abort = () => {
    aborted = true;
    pending.child.kill('SIGKILL');
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const result = await pending;
    if (aborted)
      throw Object.assign(new Error('Media command aborted'), {
        name: 'AbortError',
        code: 'ABORT_ERR',
      });
    return result;
  } catch (error) {
    if (aborted)
      throw Object.assign(new Error('Media command aborted'), {
        name: 'AbortError',
        code: 'ABORT_ERR',
      });
    throw error;
  } finally {
    await closed;
    signal?.removeEventListener('abort', abort);
  }
}
