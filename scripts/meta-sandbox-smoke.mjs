import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createMetaMessagesClient,
  runMetaSendAttempt,
} from '../modules/integration-reliability/src/index.js';

/** @param {Record<string, string|undefined>} env @param {string} name */
function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

/** @param {string} value */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * @param {{
 *   env?: Record<string, string|undefined>,
 *   fetch?: typeof fetch,
 *   now?: () => Date,
 *   writeEvidence?: (evidence: Record<string, any>) => Promise<void>,
 * }} [options]
 */
export async function runMetaSandboxSmoke(options = {}) {
  const env = options.env ?? process.env;
  const graphApiVersion = required(env, 'META_GRAPH_API_VERSION');
  const recipient = required(env, 'META_TEST_RECIPIENT_E164');
  const client = createMetaMessagesClient({
    accessToken: required(env, 'META_ACCESS_TOKEN'),
    fetch: options.fetch,
    graphApiVersion,
    phoneNumberId: required(env, 'META_WHATSAPP_PHONE_NUMBER_ID'),
  });
  const messages = [
    {
      text: {
        body: 'CRM Silmer sandbox T00.4 — mensagem sintética sem dado de cliente.',
      },
      type: 'text',
    },
    {
      template: {
        language: { code: required(env, 'META_TEMPLATE_LANGUAGE') },
        name: required(env, 'META_TEMPLATE_NAME'),
      },
      type: 'template',
    },
    {
      document: {
        filename: 'crm-silmer-sandbox.pdf',
        link: required(env, 'META_TEST_DOCUMENT_URL'),
      },
      type: 'document',
    },
    {
      image: { link: required(env, 'META_TEST_IMAGE_URL') },
      type: 'image',
    },
  ];

  const acceptedMessages = [];
  for (const message of messages) {
    const result = await client.send({ ...message, to: recipient });
    acceptedMessages.push({
      apiAccepted: true,
      providerMessageIdSha256: sha256(result.providerMessageId),
      type: message.type,
    });
  }

  const beforeDispatch = await runMetaSendAttempt({
    dispatch: async () => {
      throw new Error('before-dispatch fault must not call dispatch');
    },
    fault: 'before-dispatch',
  });
  const afterAcceptance = await runMetaSendAttempt({
    dispatch: async () => ({ providerMessageId: 'discarded-by-fault-probe' }),
    fault: 'after-acceptance',
  });
  const timeout = await runMetaSendAttempt({
    dispatch: async () => {
      throw new TypeError('simulated timeout');
    },
  });
  const evidence = {
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
    failureScenarios: {
      afterAcceptance: afterAcceptance.status,
      beforeDispatch: beforeDispatch.status,
      blindAutomaticRetry:
        beforeDispatch.automaticRetry ||
        afterAcceptance.automaticRetry ||
        timeout.automaticRetry,
    },
    graphApiVersion,
    messages: acceptedMessages,
    scope: 'T00.4 Meta sandbox',
    syntheticOnly: true,
    timeoutOutcome: timeout.status,
  };

  const writeEvidence =
    options.writeEvidence ??
    (async (value) => {
      const outputPath = resolve(
        env.META_SANDBOX_EVIDENCE_PATH ?? 'var/meta-sandbox-evidence.json',
      );
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
    });
  await writeEvidence(evidence);
  return { accepted: acceptedMessages.length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runMetaSandboxSmoke()
    .then(({ accepted }) => {
      console.log(
        `Meta sandbox smoke completed: ${accepted}/4 API requests accepted; evidence saved locally.`,
      );
    })
    .catch((error) => {
      console.error(`Meta sandbox smoke failed: ${error.message}`);
      process.exitCode = 1;
    });
}
