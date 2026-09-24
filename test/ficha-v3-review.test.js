import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { validateFichaV3Gate } from '../scripts/ficha-v3-review.mjs';

const fixtureBytes = Buffer.from('{"number":"02-CRM"}');
const artifactBytes = Buffer.from('%PDF-1.7\n/Type /Page\n/Type /Page\n');
/** @param {Buffer} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {Record<string, any>} [approval] */
function gate(
  approval = { status: 'pending-human-approval', approved: false },
) {
  return {
    schemaVersion: 1,
    templateVersion: 'ficha-canonical-v3',
    fixtureSha256: sha256(fixtureBytes),
    artifact: {
      path: 'output/pdf/ficha-canonica-sintetica-v3.pdf',
      sha256: sha256(artifactBytes),
      pageCount: 2,
    },
    approval,
  };
}
const approved = {
  status: 'approved',
  approved: true,
  reviewedBy: { rose: 'Rose', operation: 'Operacao Silmer' },
  reviewedAt: '2026-10-01T10:00:00-03:00',
};

test('a pending package is valid while orders still print on v2', () => {
  assert.doesNotThrow(() =>
    validateFichaV3Gate({
      gate: gate(),
      fixtureBytes,
      artifactBytes,
      printTemplate: 'ficha-canonical-v2',
    }),
  );
});

test('refuses printing on v3 without the recorded approval (FIM-08)', () => {
  assert.throws(
    () =>
      validateFichaV3Gate({
        gate: gate(),
        fixtureBytes,
        artifactBytes,
        printTemplate: 'ficha-canonical-v3',
      }),
    /sem aprovação registrada/u,
  );
  assert.doesNotThrow(() =>
    validateFichaV3Gate({
      gate: gate(approved),
      fixtureBytes,
      artifactBytes,
      printTemplate: 'ficha-canonical-v3',
    }),
  );
});

test('refuses an approval without Rose, Operação and a date', () => {
  assert.throws(
    () =>
      validateFichaV3Gate({
        gate: gate({ ...approved, reviewedBy: { rose: 'Rose' } }),
        fixtureBytes,
        artifactBytes,
        printTemplate: 'ficha-canonical-v2',
      }),
    /Aprovação da v3 incompleta/u,
  );
});

test('refuses a PDF or fixture that changed after generation (FIM-09)', () => {
  assert.throws(
    () =>
      validateFichaV3Gate({
        gate: gate(),
        fixtureBytes,
        artifactBytes: Buffer.from('%PDF-1.7\n/Type /Page\n'),
        printTemplate: 'ficha-canonical-v2',
      }),
    /PDF v3 não confere/u,
  );
  assert.throws(
    () =>
      validateFichaV3Gate({
        gate: gate(),
        fixtureBytes: Buffer.from('{}'),
        artifactBytes,
        printTemplate: 'ficha-canonical-v2',
      }),
    /Fixture v3 mudou/u,
  );
});
