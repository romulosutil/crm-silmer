import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const RESPONSE_ENDPOINT = 'https://api.openai.com/v1/responses';
const SYNTHETIC_INPUT = Object.freeze([
  {
    role: 'developer',
    content:
      'Return only a schema-valid synthetic CRM suggestion. Do not include names, contact data, addresses, identifiers, or other personal data.',
  },
  {
    role: 'user',
    content:
      'Synthetic test scenario: a generic catalog item needs a neutral follow-up question. No person or company is involved.',
  },
]);

const piiPatterns = Object.freeze([
  /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/iu,
  /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/u,
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/u,
  /\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/u,
]);

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {unknown} value */
export function containsPii(value) {
  const serialized =
    typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return piiPatterns.some((pattern) => pattern.test(serialized));
}

/** @param {unknown} value */
export function validateSuggestion(value) {
  invariant(
    value && typeof value === 'object' && !Array.isArray(value),
    'Structured response must be an object',
  );
  const suggestion = /** @type {Record<string, unknown>} */ (value);
  invariant(typeof suggestion.reply === 'string', 'reply must be a string');
  const fieldSuggestions = suggestion.fieldSuggestions;
  if (!Array.isArray(fieldSuggestions)) {
    throw new Error('fieldSuggestions must be an array');
  }
  for (const item of fieldSuggestions) {
    invariant(
      item && typeof item === 'object' && !Array.isArray(item),
      'Each field suggestion must be an object',
    );
    const field = /** @type {Record<string, unknown>} */ (item);
    for (const key of ['field', 'value', 'source']) {
      invariant(typeof field[key] === 'string', `${key} must be a string`);
    }
    invariant(
      Object.keys(field).every((key) =>
        ['field', 'value', 'source'].includes(key),
      ),
      'Field suggestion has an unexpected property',
    );
  }
  invariant(
    suggestion.stageSuggestion === null ||
      typeof suggestion.stageSuggestion === 'string',
    'stageSuggestion must be a string or null',
  );
  invariant(
    typeof suggestion.handoffRequired === 'boolean',
    'handoffRequired must be a boolean',
  );
  invariant(
    Object.keys(suggestion).every((key) =>
      [
        'reply',
        'fieldSuggestions',
        'stageSuggestion',
        'handoffRequired',
      ].includes(key),
    ),
    'Structured response has an unexpected property',
  );
  return suggestion;
}

/** @param {Record<string, unknown>} schema @param {number} schemaVersion */
export function buildRequest(schema, schemaVersion) {
  invariant(
    Number.isInteger(schemaVersion),
    'Schema version must be an integer',
  );
  invariant(!containsPii(schema), 'Schema contains a personal-data pattern');
  invariant(!containsPii(SYNTHETIC_INPUT), 'Synthetic input contains PII');
  return {
    store: false,
    input: SYNTHETIC_INPUT,
    text: {
      format: {
        type: 'json_schema',
        name: `crm_silmer_suggestion_v${schemaVersion}`,
        strict: true,
        schema,
      },
    },
  };
}

/** @param {Record<string, unknown>} response */
function extractOutputText(response) {
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        part.type === 'output_text' &&
        typeof part.text === 'string'
      ) {
        return part.text;
      }
    }
  }
  throw new Error('OpenAI response did not contain output_text');
}

/**
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   organizationId?: string,
 *   projectId?: string,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function runOpenAiPrivacySmoke({
  apiKey,
  model,
  organizationId,
  projectId,
  fetchImpl = globalThis.fetch,
}) {
  invariant(apiKey, 'OPENAI_API_KEY is required');
  invariant(model, 'AI_MODEL_PRIMARY is required');

  const rootUrl = new URL('../', import.meta.url);
  const manifest = JSON.parse(
    await readFile(
      new URL('schemas/fixtures/external/manifest.json', rootUrl),
      'utf8',
    ),
  );
  const schemaText = await readFile(
    new URL(manifest.openai.schemaFixture, rootUrl),
    'utf8',
  );
  const schema = JSON.parse(schemaText);
  const body = {
    ...buildRequest(schema, manifest.schemaVersion),
    model,
  };

  /** @type {Record<string, string>} */
  const headers = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
  if (organizationId) headers['openai-organization'] = organizationId;
  if (projectId) headers['openai-project'] = projectId;

  const response = await fetchImpl(RESPONSE_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const error = errorBody?.error ?? {};
    throw new Error(
      `OpenAI request failed (${response.status}, ${error.type ?? 'unknown-type'}, ${error.code ?? 'unknown-code'})`,
    );
  }

  const responseBody = await response.json();
  invariant(
    responseBody.status === 'completed',
    `OpenAI response did not complete (${responseBody.status ?? 'unknown-status'})`,
  );
  const outputText = extractOutputText(responseBody);
  const suggestion = validateSuggestion(JSON.parse(outputText));
  invariant(!containsPii(suggestion), 'Structured response contains PII');

  return {
    evidenceVersion: 1,
    executedAt: new Date().toISOString(),
    endpoint: RESPONSE_ENDPOINT,
    modelRequested: model,
    modelReturned:
      typeof responseBody.model === 'string' ? responseBody.model : null,
    store: false,
    schemaName: body.text.format.name,
    schemaSha256: createHash('sha256').update(schemaText).digest('hex'),
    schemaContainsPii: false,
    outputContainsPii: false,
    organizationHeaderApplied: Boolean(organizationId),
    projectHeaderApplied: Boolean(projectId),
    responseStatus: responseBody.status ?? null,
    requestIdRecorded: Boolean(response.headers.get('x-request-id')),
  };
}

async function main() {
  const evidence = await runOpenAiPrivacySmoke({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.AI_MODEL_PRIMARY ?? '',
    organizationId: process.env.OPENAI_ORGANIZATION_ID,
    projectId: process.env.OPENAI_PROJECT_ID,
  });
  console.log(JSON.stringify(evidence, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`OpenAI privacy smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}
