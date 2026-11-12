// Synthetic review package for v9 (ADR 087). It renders the sample, writes the
// PDF and locks the hashes in the approval record while the PO's review is
// pending; it never touches the v2–v8 packages or the live print switch.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { format } from 'prettier';

import {
  TEMPLATE_V8,
  TEMPLATE_V9,
} from '../modules/orders/src/print/print-snapshot.js';
import {
  ARTIFACT_PATH_V9,
  CRITERIA_V9,
  REQUIREMENTS_V9,
  REVIEW_PATH_V9,
  buildFichaHtmlV9,
  sha256V9,
  validateFichaApprovalGateV9,
} from './ficha-pdf-review-v9.mjs';

const rootUrl = new URL('../', import.meta.url);
const snapshotUrl = new URL('docs/phase0/ficha-pdf-synthetic-v9.json', rootUrl);
const gateUrl = new URL('docs/phase0/ficha-pdf-approval-v9.json', rootUrl);
const artifactUrl = new URL(ARTIFACT_PATH_V9, rootUrl);

const current = await readFile(gateUrl, 'utf8').then(
  (text) => JSON.parse(text),
  (error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  },
);
if (
  current?.provisionalApproval?.status === 'approved' ||
  current?.approval?.status === 'approved'
) {
  throw new Error('Approved v9 PDF cannot be regenerated or overwritten');
}
const snapshotBytes = await readFile(snapshotUrl);
const sample = JSON.parse(snapshotBytes.toString('utf8'));
if (sample.syntheticOnly !== true || sample.templateVersion !== TEMPLATE_V9) {
  throw new Error('Only the synthetic v9 sample may be rendered here');
}
const renderedHtml = buildFichaHtmlV9(sample);
await mkdir(dirname(fileURLToPath(artifactUrl)), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setContent(renderedHtml, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    format: 'A4',
    path: fileURLToPath(artifactUrl),
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
  });
} finally {
  await browser.close();
}
const artifactBytes = await readFile(artifactUrl);
const snapshotSha256 = sha256V9(snapshotBytes);
const renderedHtmlSha256 = sha256V9(renderedHtml);
const artifactSha256 = sha256V9(artifactBytes);
const gate = {
  schemaVersion: 1,
  task: 'FPI-T05',
  adr: '087',
  requirements: REQUIREMENTS_V9,
  syntheticOnly: true,
  snapshotVersion: sample.snapshotVersion,
  templateVersion: TEMPLATE_V9,
  snapshotSha256,
  renderedHtmlSha256,
  artifact: {
    path: ARTIFACT_PATH_V9,
    sha256: artifactSha256,
    pageCount: (
      artifactBytes.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []
    ).length,
  },
  provisionalApproval: {
    status: 'pending-po-review',
    approved: false,
    scope: 'development/cloud-dev',
    reviewedBy: { role: 'PO', name: null },
    reviewedAt: null,
    snapshotSha256,
    renderedHtmlSha256,
    artifactSha256,
    decisionRef: REVIEW_PATH_V9,
  },
  approval: {
    status: 'pending-human-approval',
    approved: false,
    requiredBefore: 'production',
    signature: 'physical',
    reviewedBy: { rose: null, operation: null },
    reviewedAt: null,
    signedPaperKeptAt: null,
    criteria: Object.fromEntries(CRITERIA_V9.map((name) => [name, null])),
    evidenceRef: null,
  },
  versioning: {
    overwriteApprovedVersion: false,
    correctionsRequireNewTemplateVersion: true,
    supersedesTemplateVersion: TEMPLATE_V8,
  },
};
validateFichaApprovalGateV9({
  artifactBytes,
  gate,
  renderedHtml,
  snapshotBytes,
});
await writeFile(
  gateUrl,
  await format(JSON.stringify(gate), { parser: 'json' }),
);
console.log(
  `Ficha v9 review PDF ready: ${ARTIFACT_PATH_V9} (${gate.artifact.pageCount} sheets); approval pending.`,
);
