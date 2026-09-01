import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootUrl = new URL('../', import.meta.url);
const snapshotUrl = new URL('docs/phase0/ficha-pdf-synthetic.json', rootUrl);
const gateUrl = new URL('docs/phase0/ficha-pdf-approval.json', rootUrl);

export const PRODUCTION_FIELDS = Object.freeze([
  'conferido_arremate_por',
  'conferido_arremate_em',
  'arrematado_por',
  'arrematado_em',
  'observacao_arremate',
  'conferido_embalado_por',
  'conferido_embalado_em',
  'cores_frente',
  'cores_costas',
  'cores_manga_direita',
  'cores_manga_esquerda',
  'total_cores_partes',
  'observacao_cores',
  'quantidade_total_cores',
]);

const commercialOrderFields = Object.freeze([
  'numero',
  'fab',
  'vendedor',
  'data',
  'nome',
  'data_entrega_confirmada',
  'cliente',
  'aplicacao',
]);

const commercialItemFields = Object.freeze([
  'tipo',
  'modelo',
  'malhas',
  'cor_frente',
  'cor_costas',
  'cor_manga_direita',
  'cor_manga_esquerda',
  'vies_gola',
  'vies_mangas',
  'grade',
]);

const approvalCriteria = Object.freeze([
  'legibility',
  'content',
  'order',
  'grade',
  'totals',
  'printing',
]);

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {Buffer | string} value */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} value */
function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** @param {string} value */
function containsPersonalContact(value) {
  return (
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(value) ||
    /(?:\+55\s*)?(?:\(\d{2}\)|\d{2})\s*9?\d{4}[- ]?\d{4}\b/u.test(value)
  );
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** @param {unknown} value */
function display(value) {
  return escapeHtml(String(value));
}

/** @param {any} snapshot */
export function validateFichaSnapshot(snapshot) {
  invariant(snapshot?.schemaVersion === 1, 'Snapshot schema version must be 1');
  invariant(snapshot?.task === 'T00.4', 'Snapshot must trace to T00.4');
  invariant(snapshot?.issue === 7, 'Snapshot must trace to issue 7');
  invariant(
    snapshot?.syntheticOnly === true,
    'Snapshot must be synthetic only',
  );
  invariant(
    snapshot?.snapshotVersion === 'synthetic-order-v1' &&
      snapshot?.templateVersion === 'ficha-canonical-v1',
    'Snapshot and template versions must be explicit',
  );
  invariant(
    Number.isFinite(Date.parse(snapshot.generatedAt)),
    'Snapshot generation time must be ISO 8601',
  );

  const order = snapshot?.pedido;
  for (const field of commercialOrderFields) {
    invariant(
      nonEmptyString(order?.[field]),
      `Commercial field pedido.${field} is required`,
    );
  }
  invariant(order.numero === '01-CRM', 'Synthetic first order must be 01-CRM');
  invariant(order.fab === '01', 'Synthetic FAB must use controlled code 01');
  invariant(
    Array.isArray(order.itens) && order.itens.length > 0,
    'At least one synthetic item is required',
  );

  let gradeTotal = 0;
  for (const [itemIndex, item] of order.itens.entries()) {
    for (const field of commercialItemFields) {
      const value = item?.[field];
      invariant(
        field === 'malhas' || field === 'grade'
          ? Array.isArray(value) && value.length > 0
          : nonEmptyString(value),
        `Commercial field pedido.itens[${itemIndex}].${field} is required`,
      );
    }
    invariant(
      item.malhas.every(nonEmptyString),
      `Item ${itemIndex + 1} malhas must be explicit`,
    );
    const sizes = new Set();
    for (const [gradeIndex, grade] of item.grade.entries()) {
      invariant(
        nonEmptyString(grade?.tamanho),
        `Item ${itemIndex + 1} grade ${gradeIndex + 1} needs a size`,
      );
      invariant(
        Number.isInteger(grade.quantidade) && grade.quantidade > 0,
        `Item ${itemIndex + 1} grade ${gradeIndex + 1} needs a positive integer quantity`,
      );
      invariant(
        !sizes.has(grade.tamanho),
        `Item ${itemIndex + 1} cannot repeat size ${grade.tamanho}`,
      );
      sizes.add(grade.tamanho);
      gradeTotal += grade.quantidade;
    }
  }

  invariant(
    Number.isInteger(order.quantidade_total) &&
      order.quantidade_total === gradeTotal,
    'Order total must equal the sum of every grade quantity',
  );
  invariant(
    Array.isArray(order.observacoes) &&
      order.observacoes.length > 0 &&
      order.observacoes.every(nonEmptyString),
    'Ordered synthetic observations are required',
  );
  invariant(
    JSON.stringify(Object.keys(snapshot.producao ?? {})) ===
      JSON.stringify(PRODUCTION_FIELDS),
    'Every production field must be present in canonical order',
  );
  invariant(
    Object.values(snapshot.producao).every((value) => value === ''),
    'Every production field must start blank',
  );
  invariant(
    !containsPersonalContact(JSON.stringify(snapshot)),
    'Synthetic snapshot must not contain email addresses or phone numbers',
  );

  return { gradeTotal };
}

/**
 * @param {{artifactBytes: Buffer, evidence?: any, gate: any, snapshotBytes: Buffer}} input
 */
export function validateFichaApprovalGate({
  artifactBytes,
  evidence = null,
  gate,
  snapshotBytes,
}) {
  invariant(
    gate?.schemaVersion === 1,
    'Approval gate schema version must be 1',
  );
  invariant(gate?.task === 'T00.4', 'Approval gate must trace to T00.4');
  invariant(gate?.issue === 7, 'Approval gate must trace to issue 7');
  invariant(
    gate?.syntheticOnly === true,
    'Approval gate must be synthetic only',
  );
  invariant(
    JSON.stringify(gate.requirements) ===
      JSON.stringify(['ORD-01', 'ORD-02', 'ORD-03', 'ORD-04', 'ORD-05']),
    'Approval gate must trace ORD-01..05',
  );
  invariant(
    gate.snapshotVersion === 'synthetic-order-v1' &&
      gate.templateVersion === 'ficha-canonical-v1',
    'Approval gate versions must match the review package',
  );
  invariant(
    gate.snapshotSha256 === sha256(snapshotBytes),
    'Snapshot SHA-256 does not match the versioned snapshot',
  );
  invariant(
    artifactBytes.subarray(0, 5).toString('ascii') === '%PDF-' &&
      artifactBytes.length > 10_000,
    'Review artifact must be a non-empty PDF',
  );
  invariant(
    gate.artifact?.path === 'output/pdf/ficha-canonica-sintetica-v1.pdf',
    'Review artifact path must be stable',
  );
  invariant(
    gate.artifact.sha256 === sha256(artifactBytes),
    'Artifact SHA-256 does not match the versioned PDF',
  );
  invariant(
    Number.isInteger(gate.artifact.pageCount) &&
      gate.artifact.pageCount >= 2 &&
      gate.artifact.pageCount === countPdfPages(artifactBytes),
    'Review artifact page count must match a PDF with at least two pages',
  );

  const approval = gate.approval;
  const criteria = Object.values(approval?.criteria ?? {});
  invariant(
    JSON.stringify(Object.keys(approval?.criteria ?? {})) ===
      JSON.stringify(approvalCriteria),
    'Ficha approval must record every canonical review criterion in order',
  );
  const pending =
    approval?.status === 'pending-human-approval' &&
    approval.approved === false &&
    approval.reviewedBy?.rose === null &&
    approval.reviewedBy?.operation === null &&
    approval.reviewedAt === null &&
    approval.evidenceRef === null &&
    criteria.length === 6 &&
    criteria.every((value) => value === null);
  const approved =
    approval?.status === 'approved' &&
    approval.approved === true &&
    nonEmptyString(approval.reviewedBy?.rose) &&
    nonEmptyString(approval.reviewedBy?.operation) &&
    Number.isFinite(Date.parse(approval.reviewedAt)) &&
    criteria.length === 6 &&
    criteria.every((value) => value === true) &&
    /^docs\/phase0\/ficha-pdf-approved-evidence-v\d+\.json$/u.test(
      approval.evidenceRef,
    );
  invariant(
    pending || approved,
    'Ficha human approval must be wholly pending or wholly approved',
  );
  if (approved) validateFichaApprovalEvidence(evidence, gate);
  invariant(
    gate.versioning?.overwriteApprovedVersion === false &&
      gate.versioning?.correctionsRequireNewTemplateVersion === true,
    'Approved Ficha versions must never be overwritten',
  );

  return gate;
}

/** @param {any} evidence @param {any} gate */
export function validateFichaApprovalEvidence(evidence, gate) {
  invariant(
    evidence?.schemaVersion === 1 &&
      evidence.task === 'T00.4' &&
      evidence.issue === 7 &&
      evidence.syntheticOnly === true,
    'Approved evidence must be synthetic and trace to T00.4/issue 7',
  );
  invariant(
    evidence.templateVersion === gate.templateVersion &&
      evidence.snapshotVersion === gate.snapshotVersion &&
      evidence.snapshotSha256 === gate.snapshotSha256 &&
      evidence.artifactSha256 === gate.artifact.sha256,
    'Approved evidence must identify the exact snapshot, template, and artifact',
  );
  invariant(
    evidence.reviewedAt === gate.approval.reviewedAt &&
      JSON.stringify(evidence.reviewedBy) ===
        JSON.stringify(gate.approval.reviewedBy) &&
      JSON.stringify(evidence.criteria) ===
        JSON.stringify(gate.approval.criteria),
    'Approved evidence must match the human review recorded in the gate',
  );
  invariant(
    Array.isArray(evidence.visualEvidence) &&
      evidence.visualEvidence.length > 0 &&
      evidence.visualEvidence.every(
        (/** @type {any} */ item) =>
          item?.containsPii === false &&
          ['git', 'silmer'].includes(item.type) &&
          new RegExp(`^${item.type}:[a-zA-Z0-9._-]+$`, 'u').test(item.ref),
      ),
    'Approved evidence needs at least one PII-free git or Silmer visual reference',
  );
  invariant(
    !containsPersonalContact(JSON.stringify(evidence)),
    'Approved evidence must not contain email addresses or phone numbers',
  );
  return evidence;
}

/** @param {any} snapshot */
export function buildFichaHtml(snapshot) {
  validateFichaSnapshot(snapshot);
  const rows = snapshot.pedido.itens.flatMap(
    (/** @type {any} */ item, /** @type {number} */ itemIndex) =>
      item.grade.map(
        (/** @type {any} */ grade, /** @type {number} */ gradeIndex) => `
        <tr>
          <td>${gradeIndex === 0 ? display(itemIndex + 1) : ''}</td>
          <td>${gradeIndex === 0 ? display(item.tipo) : ''}</td>
          <td>${gradeIndex === 0 ? display(item.modelo) : ''}</td>
          <td>${gradeIndex === 0 ? display(item.malhas.join(' / ')) : ''}</td>
          <td>${gradeIndex === 0 ? display(item.cor_frente) : ''}</td>
          <td>${gradeIndex === 0 ? display(item.cor_costas) : ''}</td>
          <td>${gradeIndex === 0 ? display(item.cor_manga_direita) : ''}</td>
          <td>${gradeIndex === 0 ? display(item.cor_manga_esquerda) : ''}</td>
          <td>${gradeIndex === 0 ? display(item.vies_gola) : ''}</td>
          <td>${gradeIndex === 0 ? display(item.vies_mangas) : ''}</td>
          <td>${display(grade.tamanho)}</td>
          <td class="numero">${display(grade.quantidade)}</td>
        </tr>`,
      ),
  );
  const productionFields = [
    ['Conferido para arrematar por:', 'conferido_arremate_por'],
    ['Data:', 'conferido_arremate_em'],
    ['Arrematado:', 'arrematado_por'],
    ['Data:', 'arrematado_em'],
    ['OBS:', 'observacao_arremate'],
    ['Conferido / Embalado por:', 'conferido_embalado_por'],
    ['Data:', 'conferido_embalado_em'],
    ['Cores Frente:', 'cores_frente'],
    ['Costas:', 'cores_costas'],
    ['Manga Direita:', 'cores_manga_direita'],
    ['Manga Esq:', 'cores_manga_esquerda'],
    ['Total:', 'total_cores_partes'],
    ['OBS:', 'observacao_cores'],
    ['Qtd total de cores do pedido:', 'quantidade_total_cores'],
  ];

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <title>Ficha de Pedido ${display(snapshot.pedido.numero)}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm 9mm 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #172033; font-family: Arial, Helvetica, sans-serif; font-size: 9px; }
      h1, h2, p { margin: 0; }
      header { align-items: center; border-bottom: 3px solid #7226ff; display: flex; justify-content: space-between; margin-bottom: 8px; padding-bottom: 6px; }
      h1 { font-size: 21px; letter-spacing: .06em; }
      h2 { color: #3a246d; font-size: 14px; margin-bottom: 7px; }
      .marca { color: #7226ff; font-size: 14px; font-weight: 800; letter-spacing: .08em; }
      .synthetic { background: #fff2cc; border: 1px solid #b97900; border-radius: 4px; color: #6b4300; font-size: 8px; font-weight: 700; padding: 4px 7px; text-transform: uppercase; }
      .metadata { border: 1px solid #aeb7c7; display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 8px; }
      .field { border-bottom: 1px solid #d5dae3; border-right: 1px solid #d5dae3; min-height: 38px; padding: 5px 7px; }
      .field:nth-child(4n) { border-right: 0; }
      .field:nth-last-child(-n + 4) { border-bottom: 0; }
      .label { color: #596579; display: block; font-size: 7px; font-weight: 700; letter-spacing: .06em; margin-bottom: 3px; text-transform: uppercase; }
      .value { font-size: 10px; font-weight: 700; }
      table { border-collapse: collapse; table-layout: fixed; width: 100%; }
      th, td { border: 1px solid #69758a; padding: 3px 2px; text-align: left; vertical-align: top; }
      th { background: #ede8ff; color: #24164a; font-size: 6.8px; letter-spacing: .02em; text-transform: uppercase; }
      tbody tr:nth-child(even) { background: #f8f9fc; }
      .numero { text-align: right; }
      .total td { background: #27203c; color: white; font-size: 11px; font-weight: 800; padding: 6px; }
      .observacoes { border: 1px solid #69758a; margin-top: 8px; padding: 7px; }
      .observacoes ol { margin: 5px 0 0; padding-left: 18px; }
      .observacoes li { margin: 2px 0; }
      .page-break { break-before: page; }
      .production-note { background: #eef7ff; border-left: 4px solid #1474b8; margin-bottom: 10px; padding: 8px 10px; }
      .production-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .production-field { border: 1px solid #69758a; min-height: 52px; padding: 7px; }
      .production-field.wide { grid-column: span 2; }
      .campo-producao-vazio { border-bottom: 1px solid #172033; display: block; height: 23px; margin-top: 7px; }
      .review-box { border: 2px dashed #b97900; margin-top: 12px; padding: 9px; }
      .review-box strong { color: #6b4300; }
    </style>
  </head>
  <body>
    <header>
      <div><div class="marca">SILMER</div><h1>FICHA DE PEDIDO</h1></div>
      <div class="synthetic">Amostra sintetica - nao produzir</div>
    </header>
    <section class="metadata">
      <div class="field"><span class="label">Pedido No.</span><span class="value">${display(snapshot.pedido.numero)}</span></div>
      <div class="field"><span class="label">FAB</span><span class="value">FAB ${display(snapshot.pedido.fab)}</span></div>
      <div class="field"><span class="label">Vendedor</span><span class="value">${display(snapshot.pedido.vendedor)}</span></div>
      <div class="field"><span class="label">Data do Pedido</span><span class="value">${display(snapshot.pedido.data)}</span></div>
      <div class="field"><span class="label">Nome</span><span class="value">${display(snapshot.pedido.nome)}</span></div>
      <div class="field"><span class="label">Cliente</span><span class="value">${display(snapshot.pedido.cliente)}</span></div>
      <div class="field"><span class="label">Data da Entrega</span><span class="value">${display(snapshot.pedido.data_entrega_confirmada)}</span></div>
      <div class="field"><span class="label">Aplicacao</span><span class="value">${display(snapshot.pedido.aplicacao)}</span></div>
    </section>
    <h2>Itens, especificacoes e grade</h2>
    <table>
      <thead><tr><th style="width:3%">#</th><th style="width:7%">Item</th><th style="width:8%">Modelo</th><th style="width:13%">Malha</th><th style="width:9%">Frente</th><th style="width:9%">Costas</th><th style="width:9%">Manga direita</th><th style="width:9%">Manga esquerda</th><th style="width:10%">Vies gola</th><th style="width:9%">Vies mangas</th><th style="width:7%">Tam</th><th style="width:7%">Qtd.</th></tr></thead>
      <tbody>${rows.join('')}<tr class="total"><td colspan="11">TOTAL DE PECAS</td><td class="numero">${display(snapshot.pedido.quantidade_total)}</td></tr></tbody>
    </table>
    <section class="observacoes"><strong>Observacoes do pedido</strong><ol>${snapshot.pedido.observacoes.map((/** @type {string} */ note) => `<li>${display(note)}</li>`).join('')}</ol></section>

    <section class="page-break">
      <header>
        <div><div class="marca">SILMER</div><h1>CONTROLE DE PRODUCAO</h1></div>
        <div><div class="synthetic">Campos intencionalmente vazios</div><p style="margin-top:5px;text-align:right">Pedido ${display(snapshot.pedido.numero)}</p></div>
      </header>
      <p class="production-note">Estes campos pertencem a producao e arte. Eles devem sair vazios na Ficha aprovada pelo comercial e ser preenchidos somente pela equipe responsavel.</p>
      <div class="production-grid">
        ${productionFields
          .map(
            ([label, field]) =>
              `<div class="production-field${field.includes('observacao') ? ' wide' : ''}"><strong>${display(label)}</strong><span class="campo-producao-vazio">${display(snapshot.producao[field])}</span></div>`,
          )
          .join('')}
      </div>
      <div class="review-box"><strong>Gate humano pendente.</strong> Rose e Operacao devem revisar legibilidade, conteudo, ordem, grade, totais e impressao. Correcoes geram nova versao; este arquivo nao registra aprovacao.</div>
    </section>
  </body>
</html>`;
}

/** @param {Buffer} bytes */
function countPdfPages(bytes) {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page\b/gu) ?? []).length;
}

async function readPackage() {
  const snapshotBytes = await readFile(snapshotUrl);
  const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
  const gate = JSON.parse(await readFile(gateUrl, 'utf8'));
  return { gate, snapshot, snapshotBytes };
}

async function generate() {
  const { chromium } = await import('@playwright/test');
  const { gate, snapshot, snapshotBytes } = await readPackage();
  invariant(
    gate.approval?.status === 'pending-human-approval' &&
      gate.approval.approved === false,
    'Approved PDF versions cannot be regenerated or overwritten',
  );
  const artifactUrl = new URL(gate.artifact.path, rootUrl);
  const artifactPath = fileURLToPath(artifactUrl);
  await mkdir(dirname(artifactPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(buildFichaHtml(snapshot), { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      displayHeaderFooter: true,
      footerTemplate: `<div style="box-sizing:border-box;color:#657086;display:flex;font-family:Arial,sans-serif;font-size:7px;justify-content:space-between;padding:0 9mm;width:100%"><span>Template ${display(snapshot.templateVersion)} | Snapshot ${display(snapshot.snapshotVersion)} | Issue #7 | T00.4</span><span>Pagina <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
      format: 'A4',
      headerTemplate: '<div></div>',
      landscape: true,
      path: artifactPath,
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }

  const artifactBytes = await readFile(artifactUrl);
  gate.snapshotSha256 = sha256(snapshotBytes);
  gate.artifact.sha256 = sha256(artifactBytes);
  gate.artifact.pageCount = countPdfPages(artifactBytes);
  await writeFile(gateUrl, `${JSON.stringify(gate, null, 2)}\n`);
  validateFichaApprovalGate({ artifactBytes, gate, snapshotBytes });
  console.log(
    `Ficha review PDF generated: ${gate.artifact.path} (${gate.artifact.pageCount} pages).`,
  );
}

async function validate() {
  const { gate, snapshot, snapshotBytes } = await readPackage();
  validateFichaSnapshot(snapshot);
  const artifactBytes = await readFile(new URL(gate.artifact.path, rootUrl));
  const evidence = gate.approval.evidenceRef
    ? JSON.parse(
        await readFile(new URL(gate.approval.evidenceRef, rootUrl), 'utf8'),
      )
    : null;
  validateFichaApprovalGate({ artifactBytes, evidence, gate, snapshotBytes });
  console.log(
    `Ficha PDF review gate valid: ${gate.approval.status}; Rose/Operation approval remains explicit.`,
  );
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
    console.error(`Ficha PDF review failed: ${error.message}`);
    process.exitCode = 1;
  });
}
