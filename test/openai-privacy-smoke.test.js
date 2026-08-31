import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRequest,
  containsPii,
  runOpenAiPrivacySmoke,
  validateSuggestion,
} from '../scripts/openai-privacy-smoke.mjs';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'fieldSuggestions', 'stageSuggestion', 'handoffRequired'],
  properties: {
    reply: { type: 'string' },
    fieldSuggestions: { type: 'array', items: { type: 'object' } },
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

test('builds a versioned strict Responses request with store disabled', () => {
  const body = buildRequest(schema, 7);
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.name, 'crm_silmer_suggestion_v7');
  assert.equal(body.text.format.strict, true);
  assert.equal(containsPii(body.input), false);
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

test('emits sanitized live evidence without response content or credentials', async () => {
  /** @type {{ url: string, options: RequestInit } | undefined} */
  let capturedRequest;
  /** @type {typeof fetch} */
  const fetchImpl = async (url, options) => {
    capturedRequest = { url: url.toString(), options: options ?? {} };
    const responseBody = {
      id: 'resp_sensitive_identifier',
      status: 'completed',
      model: 'synthetic-model-2026-08-31',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify(structuredSuggestion),
            },
          ],
        },
      ],
    };
    return /** @type {Response} */ (
      /** @type {unknown} */ ({
        ok: true,
        status: 200,
        headers: {
          /** @param {string} name */
          get: (name) =>
            name.toLowerCase() === 'x-request-id'
              ? 'request_sensitive_identifier'
              : null,
        },
        json: async () => responseBody,
      })
    );
  };

  const evidence = await runOpenAiPrivacySmoke({
    apiKey: 'secret-test-key',
    model: 'synthetic-model',
    organizationId: 'org-test',
    projectId: 'proj-test',
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

  assert.equal(capturedRequest.url, 'https://api.openai.com/v1/responses');
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(evidence.schemaContainsPii, false);
  assert.equal(evidence.outputContainsPii, false);
  assert.equal(evidence.requestIdRecorded, true);
  assert.doesNotMatch(serializedEvidence, /secret-test-key/u);
  assert.doesNotMatch(serializedEvidence, /resp_sensitive_identifier/u);
  assert.doesNotMatch(serializedEvidence, /request_sensitive_identifier/u);
  assert.doesNotMatch(serializedEvidence, /Qual detalhe/u);
});

test('rejects PII and incomplete provider responses without logging content', async () => {
  const piiFetch = async () =>
    /** @type {Response} */ (
      /** @type {unknown} */ ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          status: 'completed',
          model: 'synthetic-model',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    ...structuredSuggestion,
                    reply: 'Envie para pessoa@example.com',
                  }),
                },
              ],
            },
          ],
        }),
      })
    );
  const incompleteFetch = async () =>
    /** @type {Response} */ (
      /** @type {unknown} */ ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ status: 'incomplete', output: [] }),
      })
    );

  await assert.rejects(
    runOpenAiPrivacySmoke({
      apiKey: 'secret-test-key',
      model: 'synthetic-model',
      fetchImpl: piiFetch,
    }),
    /contains PII/u,
  );
  await assert.rejects(
    runOpenAiPrivacySmoke({
      apiKey: 'secret-test-key',
      model: 'synthetic-model',
      fetchImpl: incompleteFetch,
    }),
    /did not complete \(incomplete\)/u,
  );
});

test('sanitizes provider failures to status, type, and code', async () => {
  const fetchImpl = async () =>
    /** @type {Response} */ (
      /** @type {unknown} */ ({
        ok: false,
        status: 400,
        headers: { get: () => null },
        json: async () => ({
          error: {
            type: 'invalid_request_error',
            code: 'invalid_schema',
            message: 'Sensitive provider diagnostic must not escape',
          },
        }),
      })
    );

  await assert.rejects(
    runOpenAiPrivacySmoke({
      apiKey: 'secret-test-key',
      model: 'synthetic-model',
      fetchImpl,
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /\(400, invalid_request_error, invalid_schema\)/u,
      );
      assert.doesNotMatch(error.message, /Sensitive provider diagnostic/u);
      return true;
    },
  );
});
