import { readFile } from 'node:fs/promises';
import { pingClamAv } from '@crm-silmer/integration-reliability';

const mainCommand = await readFile('/proc/1/cmdline', 'utf8').catch(() => '');
const apiLiveUrl = process.argv[2] ?? 'http://127.0.0.1:3000/api/health/live';

if (mainCommand.includes('apps/worker/src/worker.js')) {
  process.exit((await pingClamAv()) ? 0 : 1);
}

try {
  const response = await globalThis.fetch(apiLiveUrl);
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
