import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const APPROVED_PROVIDER = 'google-gemini-developer-api';
export const APPROVED_MODEL = 'gemini-2.5-flash-lite';

const API_ORIGIN = 'https://generativelanguage.googleapis.com';
const API_VERSION = 'v1beta';
const SYNTHETIC_SYSTEM_INSTRUCTION =
  'Return only a schema-valid synthetic CRM suggestion. Do not include names, contact data, addresses, identifiers, or other personal data.';
const SYNTHETIC_CONTENTS = Object.freeze([
  {
    role: 'user',
    parts: [
      {
        text: 'Synthetic test scenario: a generic catalog item needs a neutral follow-up question. No person or company is involved.',
      },
    ],
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

/** @param {string} model */
export function buildEndpoint(model) {
  invariant(
    model === APPROVED_MODEL,
    `AI_MODEL_PRIMARY must be ${APPROVED_MODEL}`,
  );
  return `${API_ORIGIN}/${API_VERSION}/models/${model}:generateContent`;
}

/** @param {Record<string, unknown>} schema @param {number} schemaVersion */
export function buildRequest(schema, schemaVersion) {
  invariant(
    Number.isInteger(schemaVersion),
    'Schema version must be an integer',
  );
  invariant(!containsPii(schema), 'Schema contains a personal-data pattern');
  invariant(
    !containsPii(SYNTHETIC_SYSTEM_INSTRUCTION) &&
      !containsPii(SYNTHETIC_CONTENTS),
    'Synthetic input contains PII',
  );
  return {
    systemInstruction: {
      parts: [{ text: SYNTHETIC_SYSTEM_INSTRUCTION }],
    },
    contents: SYNTHETIC_CONTENTS,
    generationConfig: {
      candidateCount: 1,
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
    },
  };
}

/** @param {Record<string, unknown>} response */
function extractOutputText(response) {
  const candidates = Array.isArray(response.candidates)
    ? response.candidates
    : [];
  const candidate = candidates[0];
  invariant(
    candidate && typeof candidate === 'object',
    'Gemini response did not contain a candidate',
  );
  invariant(
    candidate.finishReason === 'STOP',
    `Gemini response did not complete (${candidate.finishReason ?? 'unknown-status'})`,
  );
  const content = /** @type {Record<string, unknown>} */ (
    candidate.content && typeof candidate.content === 'object'
      ? candidate.content
      : {}
  );
  const parts = /** @type {unknown[]} */ (
    Array.isArray(content.parts) ? content.parts : []
  );
  /** @param {unknown} part @returns {part is { text: string }} */
  const isTextPart = (part) =>
    Boolean(
      part &&
      typeof part === 'object' &&
      'text' in part &&
      typeof part.text === 'string',
    );
  const textPart = parts.find(isTextPart);
  if (!textPart) {
    throw new Error('Gemini response did not contain output text');
  }
  return textPart.text;
}

/**
 * @param {{
 *   apiKey: string,
 *   provider: string,
 *   model: string,
 *   paidServiceConfirmed: boolean,
 *   zdrApproved?: boolean,
 *   developerLoggingEnabled?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function runGeminiPrivacySmoke({
  apiKey,
  provider,
  model,
  paidServiceConfirmed,
  zdrApproved = false,
  developerLoggingEnabled = false,
  fetchImpl = globalThis.fetch,
}) {
  invariant(apiKey, 'GEMINI_API_KEY is required');
  invariant(
    provider === APPROVED_PROVIDER,
    `AI_PROVIDER must be ${APPROVED_PROVIDER}`,
  );
  invariant(paidServiceConfirmed, 'Gemini paid service must be confirmed');
  invariant(
    developerLoggingEnabled === false,
    'Gemini developer logging must remain disabled',
  );
  invariant(typeof zdrApproved === 'boolean', 'ZDR status must be boolean');

  const endpoint = buildEndpoint(model);
  const rootUrl = new URL('../', import.meta.url);
  const manifest = JSON.parse(
    await readFile(
      new URL('schemas/fixtures/external/manifest.json', rootUrl),
      'utf8',
    ),
  );
  const schemaText = await readFile(
    new URL(manifest.gemini.schemaFixture, rootUrl),
    'utf8',
  );
  const schema = JSON.parse(schemaText);
  const body = buildRequest(schema, manifest.schemaVersion);
  const schemaName = `crm_silmer_suggestion_v${manifest.schemaVersion}`;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const error = errorBody?.error ?? {};
    throw new Error(
      `Gemini request failed (${response.status}, ${error.status ?? 'unknown-status'}, ${error.code ?? 'unknown-code'})`,
    );
  }

  const responseBody = await response.json();
  const outputText = extractOutputText(responseBody);
  const suggestion = validateSuggestion(JSON.parse(outputText));
  invariant(!containsPii(suggestion), 'Structured response contains PII');

  return {
    evidenceVersion: 1,
    executedAt: new Date().toISOString(),
    provider: APPROVED_PROVIDER,
    endpointOrigin: API_ORIGIN,
    apiVersion: API_VERSION,
    operation: 'models.generateContent',
    serverManagedConversationState: false,
    modelRequested: model,
    modelReturned:
      typeof responseBody.modelVersion === 'string'
        ? responseBody.modelVersion
        : null,
    paidServiceConfirmed,
    zdrApproved,
    productionWithPiiReady: paidServiceConfirmed && zdrApproved,
    developerLoggingEnabled: false,
    groundingEnabled: false,
    fileApiUsed: false,
    explicitCachingUsed: false,
    schemaName,
    schemaSha256: createHash('sha256').update(schemaText).digest('hex'),
    schemaContainsPii: false,
    requestContainsPii: false,
    outputContainsPii: false,
    responseStatus: responseBody.candidates?.[0]?.finishReason ?? null,
    requestIdRecorded: Boolean(
      response.headers.get('x-request-id') ||
      response.headers.get('x-goog-request-id'),
    ),
  };
}

async function main() {
  const evidence = await runGeminiPrivacySmoke({
    apiKey: process.env.GEMINI_API_KEY ?? '',
    provider: process.env.AI_PROVIDER ?? '',
    model: process.env.AI_MODEL_PRIMARY ?? '',
    paidServiceConfirmed: process.env.GEMINI_PAID_SERVICE_CONFIRMED === 'true',
    zdrApproved: process.env.GEMINI_ZDR_APPROVED === 'true',
    developerLoggingEnabled:
      process.env.GEMINI_DEVELOPER_LOGGING_ENABLED === 'true',
  });
  console.log(JSON.stringify(evidence, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Gemini privacy smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}
