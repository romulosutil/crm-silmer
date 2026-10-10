import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLocalDevDatabase,
  chatLedgerMoves,
  planChatLedgerReconciliation,
} from '../scripts/reconcile-chat-media-dev-ledger.mjs';

const legacy = () =>
  chatLedgerMoves.map(([version, , name, checksum]) => ({
    version,
    name,
    checksum,
    phase: 'expand',
    applied_at: new Date('2026-10-01T00:00:00Z'),
  }));

test('DEV ledger repair has an ordered collision-free plan without changing rows', () => {
  const rows = legacy();
  const original = structuredClone(rows);
  assert.deepEqual(planChatLedgerReconciliation(rows), [
    { source: '0030', target: '0033' },
    { source: '0029', target: '0032' },
    { source: '0028', target: '0031' },
    { source: '0027', target: '0030' },
  ]);
  assert.deepEqual(rows, original);
});

test('DEV ledger repair accepts only exact approved history and empty destinations', () => {
  for (const field of /** @type {const} */ (['checksum', 'name', 'phase'])) {
    const rows = legacy();
    rows[0][field] = 'changed';
    assert.throws(
      () => planChatLedgerReconciliation(rows),
      /approved checksums/u,
    );
  }
  assert.throws(
    () => planChatLedgerReconciliation(legacy().slice(1)),
    /approved checksums/u,
  );
  assert.throws(
    () =>
      planChatLedgerReconciliation([
        ...legacy(),
        { ...legacy()[0], version: '0031' },
      ]),
    /occupied/u,
  );
  assert.throws(
    () => planChatLedgerReconciliation([...legacy(), legacy()[0]]),
    /Duplicate/u,
  );
  assert.throws(() => planChatLedgerReconciliation([]), /approved checksums/u);
});

test('DEV ledger repair is already complete only when all four checksums match', () => {
  const rows = legacy().map((row, index) => ({
    ...row,
    version: chatLedgerMoves[index][1],
  }));
  assert.deepEqual(planChatLedgerReconciliation(rows), []);
  assert.throws(
    () =>
      planChatLedgerReconciliation([...rows, { ...rows[3], version: '0027' }]),
    /Mixed/u,
  );
  rows[3].checksum = 'changed';
  assert.throws(
    () => planChatLedgerReconciliation(rows),
    /approved checksums/u,
  );
});

test('DEV ledger repair refuses remote, production, arbitrary databases and query transport overrides', () => {
  for (const url of [
    'postgresql://127.0.0.1/crm_silmer_media',
    'postgresql://localhost/crm_silmer_test_merge_fresh',
    'postgresql://[::1]/crm_silmer_test_merge_branch',
  ]) {
    assert.doesNotThrow(() => assertLocalDevDatabase(url));
  }
  for (const url of [
    'postgresql://31.97.170.105/crm_silmer_media',
    'postgresql://localhost/production',
    'postgresql://localhost/crm',
    'https://localhost/crm_silmer_media',
    'postgresql://localhost/crm_silmer_media?host=remote.example',
  ]) {
    assert.throws(() => assertLocalDevDatabase(url));
  }
});
