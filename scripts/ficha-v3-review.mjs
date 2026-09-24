// scripts/ficha-v3-review.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'prettier';

import { renderFichaHtmlV3 } from '../modules/orders/src/print/ficha-canonical-v3.js';
import { PRINT_TEMPLATE } from '../modules/orders/src/print/index.js';
import {
  TEMPLATE_V3,
  printSnapshot,
} from '../modules/orders/src/print/print-snapshot.js';

const rootUrl = new URL('../', import.meta.url);
const fixtureUrl = new URL('docs/phase0/ficha-pdf-synthetic-v3.json', rootUrl);
const gateUrl = new URL('docs/phase0/ficha-pdf-approval-v3.json', rootUrl);
const ARTIFACT_PATH = 'output/pdf/ficha-canonica-sintetica-v3.pdf';

/** @param {Buffer | string} value */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {Buffer} bytes */
function countPdfPages(bytes) {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []).length;
}

/**
 * FIM-08/FIM-09: the v3 review package matches what was generated, and v3
 * prints orders only once Rose and Operação approved it.
 *
 * @param {{gate: any, fixtureBytes: Buffer, artifactBytes: Buffer, printTemplate: string}} input
 */
export function validateFichaV3Gate({
  gate,
  fixtureBytes,
  artifactBytes,
  printTemplate,
}) {
  if (gate?.schemaVersion !== 1 || gate.templateVersion !== TEMPLATE_V3) {
    throw new Error('Registro da v3 com versão inesperada');
  }
  if (gate.fixtureSha256 !== sha256(fixtureBytes)) {
    throw new Error(
      'Fixture v3 mudou depois da geração do PDF; rode npm run generate:ficha-v3-review',
    );
  }
  if (
    gate.artifact?.path !== ARTIFACT_PATH ||
    gate.artifact.sha256 !== sha256(artifactBytes)
  ) {
    throw new Error('PDF v3 não confere com o registro');
  }
  if (
    artifactBytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
    gate.artifact.pageCount < 2 ||
    gate.artifact.pageCount !== countPdfPages(artifactBytes)
  ) {
    throw new Error('PDF v3 inválido');
  }
  const approval = gate.approval ?? {};
  const approved =
    approval.status === 'approved' &&
    approval.approved === true &&
    Boolean(approval.reviewedBy?.rose) &&
    Boolean(approval.reviewedBy?.operation) &&
    Boolean(approval.reviewedAt);
  if (approval.status !== 'pending-human-approval' && !approved) {
    throw new Error(
      'Aprovação da v3 incompleta: precisa de Rose, Operação e data',
    );
  }
  if (printTemplate === TEMPLATE_V3 && !approved) {
    throw new Error(
      'PRINT_TEMPLATE usa a v3 sem aprovação registrada de Rose e Operação',
    );
  }
}

async function generate() {
  const { chromium } = await import('@playwright/test');
  const current = JSON.parse(
    await readFile(gateUrl, 'utf8').catch(() => 'null'),
  );
  if (current?.approval?.approved === true) {
    throw new Error(
      'A v3 aprovada não pode ser regerada; crie uma nova versão do template',
    );
  }
  const fixtureBytes = await readFile(fixtureUrl);
  const order = JSON.parse(fixtureBytes.toString('utf8'));
  const artifactUrl = new URL(ARTIFACT_PATH, rootUrl);
  await mkdir(dirname(fileURLToPath(artifactUrl)), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      renderFichaHtmlV3(printSnapshot(order, TEMPLATE_V3), { synthetic: true }),
      {
        waitUntil: 'load',
      },
    );
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      displayHeaderFooter: true,
      footerTemplate: `<div style="box-sizing:border-box;color:#657086;display:flex;font-family:Arial,sans-serif;font-size:7px;justify-content:space-between;padding:0 9mm;width:100%"><span>Template ${TEMPLATE_V3} | Snapshot synthetic-order-v2 | Ficha por produto</span><span>Pagina <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
      format: 'A4',
      headerTemplate: '<div></div>',
      landscape: true,
      path: fileURLToPath(artifactUrl),
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
  const artifactBytes = await readFile(artifactUrl);
  const gate = {
    schemaVersion: 1,
    templateVersion: TEMPLATE_V3,
    snapshotVersion: 'synthetic-order-v2',
    requirements: [
      'FIM-01',
      'FIM-02',
      'FIM-03',
      'FIM-04',
      'FIM-05',
      'FIM-06',
      'FIM-07',
      'FIM-08',
      'FIM-09',
    ],
    fixtureSha256: sha256(fixtureBytes),
    artifact: {
      path: ARTIFACT_PATH,
      sha256: sha256(artifactBytes),
      pageCount: countPdfPages(artifactBytes),
    },
    approval: {
      status: 'pending-human-approval',
      approved: false,
      reviewedBy: null,
      reviewedAt: null,
    },
    versioning: {
      supersedesTemplateVersion: 'ficha-canonical-v2',
      overwriteApprovedVersion: false,
    },
  };
  validateFichaV3Gate({
    gate,
    fixtureBytes,
    artifactBytes,
    printTemplate: PRINT_TEMPLATE,
  });
  await writeFile(
    gateUrl,
    await format(JSON.stringify(gate), { parser: 'json' }),
  );
  console.log(`PDF v3 pronto para revisão: ${ARTIFACT_PATH}`);
}

async function validate() {
  const gate = JSON.parse(await readFile(gateUrl, 'utf8'));
  validateFichaV3Gate({
    gate,
    fixtureBytes: await readFile(fixtureUrl),
    artifactBytes: await readFile(new URL(gate.artifact.path, rootUrl)),
    printTemplate: PRINT_TEMPLATE,
  });
  console.log(`Pacote de revisão da v3 válido: ${gate.approval.status}.`);
}

async function main() {
  const command = process.argv[2];
  if (command === '--generate') return generate();
  if (command === '--validate') return validate();
  throw new Error('Use --generate or --validate');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Revisão da ficha v3 falhou: ${error.message}`);
    process.exitCode = 1;
  });
}
