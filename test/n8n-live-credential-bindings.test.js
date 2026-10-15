import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindCrmCredential } from '../ops/n8n/bind-crm-credential.mjs';

const credentialId = 'localCredential123';
/** @returns {any} */
const crmNode = () => ({
  name: 'CRM - Registrar inbound (MVP)',
  type: 'n8n-nodes-base.httpRequest',
  parameters: {
    authentication: 'genericCredentialType',
    genericAuthType: 'httpBasicAuth',
  },
});

test('binds the existing CRM credential before n8n CLI import without changing other nodes', () => {
  const source = {
    nodes: [
      crmNode(),
      {
        name: 'OpenAI - Modelo do MVP',
        credentials: { openAiApi: { id: 'openai123' } },
      },
    ],
  };
  const { workflow, count } = bindCrmCredential(source, credentialId);
  assert.equal(count, 1);
  assert.deepEqual(workflow.nodes[0].credentials, {
    httpBasicAuth: { id: credentialId, name: 'Silmer n8n para CRM Basic DEV' },
  });
  assert.deepEqual(workflow.nodes[1], source.nodes[1]);
  assert.equal(source.nodes[0].credentials, undefined);
  assert.deepEqual(
    bindCrmCredential(workflow, credentialId).workflow,
    workflow,
  );
});

test('fails closed when the CRM credential ID or node authentication is wrong', () => {
  assert.throws(
    () => bindCrmCredential({ nodes: [crmNode()] }, ''),
    /CRM_CREDENTIAL_ID_REQUIRED/u,
  );
  assert.throws(
    () => bindCrmCredential({ nodes: [] }, credentialId),
    /CRM_CREDENTIAL_NODES_MISSING/u,
  );
  const wrongAuth = crmNode();
  wrongAuth.parameters.genericAuthType = 'httpHeaderAuth';
  assert.throws(
    () => bindCrmCredential({ nodes: [wrongAuth] }, credentialId),
    /CRM_CREDENTIAL_NODE_UNEXPECTED/u,
  );
  const wrongCredential = crmNode();
  wrongCredential.credentials = {
    httpBasicAuth: {
      id: 'anotherCredential123',
      name: 'Silmer n8n para CRM Basic DEV',
    },
  };
  assert.throws(
    () => bindCrmCredential({ nodes: [wrongCredential] }, credentialId),
    /CRM_CREDENTIAL_REFERENCE_MISMATCH/u,
  );
});
