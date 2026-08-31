import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVED_MODEL,
  APPROVED_PROVIDER,
  buildEndpoint,
  buildRequest,
  containsPii,
  runGeminiPrivacySmoke,
  validateSchemaFixture,
  validateSuggestion,
} from '../scripts/gemini-privacy-smoke.mjs';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'fieldSuggestions', 'stageSuggestion', 'handoffRequired'],
  properties: {
    reply: { type: 'string' },
    fieldSuggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value', 'source'],
        properties: {
          field: { type: 'string' },
          value: { type: 'string' },
          source: { type: 'string' },
        },
      },
    },
    stageSuggestion: { type: ['string', 'null'] },
    handoffRequired: { type: 'boolean' },
  },
};

const structuredSuggestion = {
  reply: 'Qual detalhe genérico deve ser confirmado?',
  fieldSuggestions: [
    { field: 'produto', value: 'item sintético', source: 'teste sintético' },
  ],
  stageSuggestion: null,
  handoffRequired: false,
};

function successfulResponse(suggestion = structuredSuggestion) {
  return /** @type {Response} */ (
    /** @type {unknown} */ ({
      ok: true,
      status: 200,
      headers: {
        /** @param {string} name */
        get: (name) =>
          name.toLowerCase() === 'x-goog-request-id'
            ? 'request_sensitive_identifier'
            : null,
      },
      json: async () => ({
        responseId: 'response_sensitive_identifier',
        modelVersion: 'gemini-2.5-flash-lite-001',
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [{ text: JSON.stringify(suggestion) }],
            },
          },
        ],
      }),
    })
  );
}

const validOptions = {
  apiKey: 'secret-test-key',
  provider: APPROVED_PROVIDER,
  model: APPROVED_MODEL,
  paidServiceConfirmed: true,
};

test('builds a stateless structured generateContent request', () => {
  const body = buildRequest(7);
  assert.equal(
    buildEndpoint(APPROVED_MODEL),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
  );
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseJsonSchema, schema);
  assert.equal(body.generationConfig.candidateCount, 1);
  assert.equal(containsPii(body.contents), false);
  assert.equal(Object.hasOwn(body, 'store'), false);
  assert.equal(Object.hasOwn(body, 'cachedContent'), false);
  assert.equal(Object.hasOwn(body, 'tools'), false);
});

test('rejects schema fixture drift before building the outbound request', () => {
  assert.doesNotThrow(() => validateSchemaFixture(schema));
  assert.throws(
    () =>
      validateSchemaFixture({
        ...schema,
        properties: { ...schema.properties, customerEmail: { type: 'string' } },
      }),
    /drifted from the outbound allowlist/u,
  );
});

test('detects representative personal-data patterns', () => {
  assert.equal(containsPii('pessoa@example.com'), true);
  assert.equal(containsPii('+55 11 99999-9999'), true);
  assert.equal(containsPii('123.456.789-01'), true);
  assert.equal(containsPii('item sintético sem pessoa'), false);
});

test('rejects structured responses outside the approved shape', () => {
  assert.doesNotThrow(() => validateSuggestion(structuredSuggestion));
  assert.throws(
    () => validateSuggestion({ ...structuredSuggestion, customerEmail: 'x' }),
    /unexpected property/u,
  );
});

test('emits sanitized evidence and keeps PII production fail-closed without ZDR', async () => {
  /** @type {{ url: string, options: RequestInit } | undefined} */
  let capturedRequest;
  /** @type {typeof fetch} */
  const fetchImpl = async (url, options) => {
    capturedRequest = { url: url.toString(), options: options ?? {} };
    return successfulResponse();
  };

  const evidence = await runGeminiPrivacySmoke({
    ...validOptions,
    zdrApproved: false,
    fetchImpl,
  });
  assert.ok(capturedRequest);
  const requestBodyText = capturedRequest.options.body;
  assert.equal(typeof requestBodyText, 'string');
  if (typeof requestBodyText !== 'string') {
    throw new Error('Expected a JSON string request body');
  }
  const requestBody = JSON.parse(requestBodyText);
  const serializedEvidence = JSON.stringify(evidence);

  assert.equal(
    capturedRequest.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
  );
  assert.equal(
    requestBody.generationConfig.responseMimeType,
    'application/json',
  );
  assert.equal(evidence.serverManagedConversationState, false);
  assert.equal(evidence.paidServiceConfirmed, true);
  assert.equal(evidence.zdrApproved, false);
  assert.equal(evidence.productionWithPiiReady, false);
  assert.equal(evidence.developerLoggingEnabled, false);
  assert.equal(evidence.requestIdRecorded, true);
  assert.doesNotMatch(serializedEvidence, /secret-test-key/u);
  assert.doesNotMatch(serializedEvidence, /response_sensitive_identifier/u);
  assert.doesNotMatch(serializedEvidence, /request_sensitive_identifier/u);
  assert.doesNotMatch(serializedEvidence, /Qual detalhe/u);
});

test('rejects provider, model, billing, and logging drift before any request', async () => {
  const fetchImpl = async () => {
    throw new Error('fetch must not run');
  };
  await assert.rejects(
    runGeminiPrivacySmoke({
      ...validOptions,
      provider: 'other-provider',
      fetchImpl,
    }),
    /AI_PROVIDER/u,
  );
  await assert.rejects(
    runGeminiPrivacySmoke({
      ...validOptions,
      model: 'gemini-flash-latest',
      fetchImpl,
    }),
    /AI_MODEL_PRIMARY/u,
  );
  await assert.rejects(
    runGeminiPrivacySmoke({
      ...validOptions,
      paidServiceConfirmed: false,
      fetchImpl,
    }),
    /paid service/u,
  );
  await assert.rejects(
    runGeminiPrivacySmoke({
      ...validOptions,
      developerLoggingEnabled: true,
      fetchImpl,
    }),
    /logging must remain disabled/u,
  );
});

test('rejects PII and incomplete provider responses without logging content', async () => {
  const piiFetch = async () =>
    successfulResponse({
      ...structuredSuggestion,
      reply: 'Envie para pessoa@example.com',
    });
  const incompleteFetch = async () =>
    /** @type {Response} */ (
      /** @type {unknown} */ ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }],
        }),
      })
    );

  await assert.rejects(
    runGeminiPrivacySmoke({ ...validOptions, fetchImpl: piiFetch }),
    /contains PII/u,
  );
  await assert.rejects(
    runGeminiPrivacySmoke({ ...validOptions, fetchImpl: incompleteFetch }),
    /did not complete \(MAX_TOKENS\)/u,
  );
});

test('sanitizes provider failures to HTTP status and provider identifiers', async () => {
  const fetchImpl = async () =>
    /** @type {Response} */ (
      /** @type {unknown} */ ({
        ok: false,
        status: 400,
        headers: { get: () => null },
        json: async () => ({
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'Sensitive provider diagnostic must not escape',
          },
        }),
      })
    );

  await assert.rejects(
    runGeminiPrivacySmoke({ ...validOptions, fetchImpl }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\(400, INVALID_ARGUMENT, 400\)/u);
      assert.doesNotMatch(error.message, /Sensitive provider diagnostic/u);
      return true;
    },
  );
});
