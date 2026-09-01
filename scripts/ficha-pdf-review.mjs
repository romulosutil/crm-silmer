import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'prettier';

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
export function containsPersonalContact(value) {
  return (
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(value) ||
    /(?<![\p{L}\p{N}_-])(?:\+55\s*)?(?:\(\d{2}\)|\d{2})\s*9?\d{4}[- ]?\d{4}(?![\p{L}\p{N}_-])/u.test(
      value,
    )
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
      snapshot?.templateVersion === 'ficha-canonical-v2',
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
 * @param {{artifactBytes: Buffer, evidence?: any, gate: any, legacyArtifactBytes: Buffer, reviewPageHtml: string, snapshotBytes: Buffer}} input
 */
export function validateFichaApprovalGate({
  artifactBytes,
  evidence = null,
  gate,
  legacyArtifactBytes,
  reviewPageHtml,
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
      gate.templateVersion === 'ficha-canonical-v2',
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
    gate.artifact?.path === 'output/pdf/ficha-canonica-sintetica-v2.pdf' &&
      gate.artifact.downloadLabel === 'Baixar nova ficha',
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
  invariant(
    legacyArtifactBytes.subarray(0, 5).toString('ascii') === '%PDF-' &&
      legacyArtifactBytes.length > 10_000,
    'Legacy artifact must be a non-empty PDF',
  );
  invariant(
    gate.legacyArtifact?.templateVersion === 'ficha-legacy-v1' &&
      gate.legacyArtifact.path ===
        'output/pdf/ficha-canonica-sintetica-v1.pdf' &&
      gate.legacyArtifact.downloadLabel === 'Download ficha legada',
    'Legacy artifact metadata must identify the stable fallback',
  );
  invariant(
    gate.legacyArtifact.sha256 === sha256(legacyArtifactBytes),
    'Legacy artifact SHA-256 does not match the versioned PDF',
  );
  invariant(
    Number.isInteger(gate.legacyArtifact.pageCount) &&
      gate.legacyArtifact.pageCount >= 2 &&
      gate.legacyArtifact.pageCount === countPdfPages(legacyArtifactBytes),
    'Legacy artifact page count must match a PDF with at least two pages',
  );
  invariant(
    gate.artifact.path !== gate.legacyArtifact.path &&
      gate.artifact.sha256 !== gate.legacyArtifact.sha256,
    'Canonical and legacy artifacts must be distinct',
  );
  invariant(
    gate.reviewPage?.path === 'output/pdf/revisao-ficha.html' &&
      gate.reviewPage.primaryLabel === 'Baixar nova ficha' &&
      gate.reviewPage.legacyLabel === 'Download ficha legada' &&
      reviewPageHtml === buildReviewPageHtml(gate),
    'Review page must expose the canonical and legacy downloads',
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
      gate.versioning?.correctionsRequireNewTemplateVersion === true &&
      gate.versioning?.supersedesTemplateVersion === 'ficha-canonical-v1',
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
  const itemCards = snapshot.pedido.itens
    .map((/** @type {any} */ item, /** @type {number} */ itemIndex) => {
      const itemTotal = item.grade.reduce(
        (/** @type {number} */ total, /** @type {any} */ grade) =>
          total + grade.quantidade,
        0,
      );
      const specs = [
        ['Malha', item.malhas.join(' / ')],
        ['Frente', item.cor_frente],
        ['Costas', item.cor_costas],
        ['Manga direita', item.cor_manga_direita],
        ['Manga esquerda', item.cor_manga_esquerda],
        ['Vies gola / mangas', `${item.vies_gola} / ${item.vies_mangas}`],
      ];
      return `<article class="item-card">
        <div class="item-heading">
          <div><span class="eyebrow">Item ${display(itemIndex + 1)}</span><h3>${display(item.tipo)} <span>${display(item.modelo)}</span></h3></div>
          <div class="item-total"><strong>${display(itemTotal)}</strong><span>pecas</span></div>
        </div>
        <div class="item-body">
          <dl class="spec-grid">${specs
            .map(
              ([label, value]) =>
                `<div><dt>${display(label)}</dt><dd>${display(value)}</dd></div>`,
            )
            .join('')}</dl>
          <div class="grade-block"><span class="grade-title">Grade</span><div class="grade-list">${item.grade
            .map(
              (/** @type {any} */ grade) =>
                `<div class="grade-cell"><span>${display(grade.tamanho)}</span><strong>${display(grade.quantidade)}</strong></div>`,
            )
            .join('')}</div></div>
        </div>
      </article>`;
    })
    .join('');
  const productionSections = [
    {
      title: 'Arremate',
      description: 'Registro de conferencia e execucao.',
      fields: [
        ['Conferido para arrematar por:', 'conferido_arremate_por'],
        ['Data:', 'conferido_arremate_em'],
        ['Arrematado:', 'arrematado_por'],
        ['Data:', 'arrematado_em'],
        ['OBS:', 'observacao_arremate'],
      ],
    },
    {
      title: 'Conferencia e embalagem',
      description: 'Fechamento fisico do pedido.',
      fields: [
        ['Conferido / Embalado por:', 'conferido_embalado_por'],
        ['Data:', 'conferido_embalado_em'],
      ],
    },
    {
      title: 'Cores e arte',
      description: 'Contagem final por parte da peca.',
      fields: [
        ['Cores Frente:', 'cores_frente'],
        ['Costas:', 'cores_costas'],
        ['Manga Direita:', 'cores_manga_direita'],
        ['Manga Esq:', 'cores_manga_esquerda'],
        ['Total:', 'total_cores_partes'],
        ['OBS:', 'observacao_cores'],
        ['Qtd total de cores do pedido:', 'quantidade_total_cores'],
      ],
    },
  ];

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <title>Ficha de Pedido ${display(snapshot.pedido.numero)}</title>
    <style>
      @page { size: A4 landscape; margin: 9mm 9mm 12mm; }
      * { box-sizing: border-box; }
      :root { --canvas: #f7f6fb; --surface: #ffffff; --raised: #f0eef8; --active: #e8e3fa; --text: #1b1530; --muted: #625b75; --border: #d8d4e4; --subtle: #e8e5ef; --accent: #ff5b01; --deep: #0c042d; --link: #5b3fd1; }
      body { background: var(--canvas); color: var(--text); font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 9.5px; margin: 0; }
      h1, h2, h3, p, dl, dd { margin: 0; }
      .sheet-header { align-items: center; display: flex; justify-content: space-between; margin-bottom: 7px; }
      .brand { color: var(--link); font-size: 9px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
      h1 { color: var(--deep); font-size: 21px; letter-spacing: -.03em; line-height: 1; margin-top: 2px; }
      .header-id { align-items: center; display: flex; gap: 8px; }
      .synthetic { background: #fff0e7; border: 1px solid #ffb88f; border-radius: 999px; color: #8b3100; font-size: 7px; font-weight: 800; padding: 4px 8px; text-transform: uppercase; }
      .order-id { background: var(--deep); border-radius: 6px; color: white; min-width: 90px; padding: 6px 9px; text-align: right; }
      .order-id span { display: block; font-size: 6px; letter-spacing: .08em; opacity: .75; text-transform: uppercase; }
      .order-id strong { font-size: 13px; }
      .section-label { color: var(--muted); font-size: 8px; font-weight: 800; letter-spacing: .1em; margin-bottom: 5px; text-transform: uppercase; }
      .summary { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; display: grid; grid-template-columns: 1.35fr 1fr .65fr 1fr; overflow: hidden; }
      .summary > div { border-right: 1px solid var(--subtle); min-height: 48px; padding: 8px 9px; }
      .summary > div:last-child { border-right: 0; }
      .label { color: var(--muted); display: block; font-size: 8px; font-weight: 700; letter-spacing: .07em; margin-bottom: 3px; text-transform: uppercase; }
      .summary strong { color: var(--deep); font-size: 12px; }
      .summary .quantity { color: var(--accent); font-size: 20px; line-height: .9; }
      .supporting { display: grid; gap: 6px; grid-template-columns: 1.5fr 1fr .8fr .5fr; margin: 7px 0 9px; }
      .supporting > div { background: var(--raised); border-radius: 5px; min-height: 36px; padding: 7px 8px; }
      .supporting strong { font-size: 9.5px; }
      .items { display: grid; gap: 8px; }
      .item-card { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--link); border-radius: 7px; break-inside: avoid; overflow: hidden; }
      .item-heading { align-items: center; background: linear-gradient(90deg, var(--raised), var(--surface)); display: flex; justify-content: space-between; padding: 8px 9px; }
      .eyebrow { color: var(--link); font-size: 7.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
      h3 { font-size: 13px; line-height: 1.1; }
      h3 span { color: var(--muted); font-size: 9px; font-weight: 600; margin-left: 5px; }
      .item-total { align-items: baseline; display: flex; gap: 3px; }
      .item-total strong { color: var(--accent); font-size: 19px; }
      .item-total span { color: var(--muted); font-size: 8px; }
      .item-body { display: grid; gap: 9px; grid-template-columns: 1fr 240px; padding: 9px; }
      .spec-grid { display: grid; gap: 7px; grid-template-columns: repeat(3, 1fr); }
      .spec-grid div { border-bottom: 1px solid var(--subtle); min-height: 38px; padding-bottom: 5px; }
      dt { color: var(--muted); font-size: 7.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
      dd { font-size: 9px; font-weight: 700; margin-top: 3px; }
      .grade-block { border-left: 1px solid var(--subtle); padding-left: 9px; }
      .grade-title { color: var(--muted); display: block; font-size: 8px; font-weight: 800; letter-spacing: .08em; margin-bottom: 6px; text-transform: uppercase; }
      .grade-list { display: grid; gap: 4px; grid-template-columns: repeat(4, 1fr); }
      .grade-cell { background: var(--active); border-radius: 5px; padding: 8px 2px; text-align: center; }
      .grade-cell span { color: var(--muted); display: block; font-size: 7.5px; font-weight: 700; }
      .grade-cell strong { color: var(--deep); font-size: 15px; }
      .page-footer-content { align-items: stretch; display: grid; gap: 8px; grid-template-columns: 1fr 160px; margin-top: 8px; }
      .observations { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; min-height: 76px; padding: 8px 9px; }
      .observations ol { margin: 3px 0 0; padding-left: 16px; }
      .observations li { line-height: 1.35; }
      .grand-total { align-items: center; background: var(--deep); border-radius: 6px; color: white; display: flex; justify-content: space-between; padding: 7px 10px; }
      .grand-total span { font-size: 7px; font-weight: 700; text-transform: uppercase; }
      .grand-total strong { color: #ffb185; font-size: 22px; }
      .page-break { break-before: page; }
      .production-intro { background: #fff0e7; border-left: 4px solid var(--accent); border-radius: 0 6px 6px 0; color: #5b280a; margin-bottom: 8px; padding: 7px 9px; }
      .production-grid { display: grid; gap: 7px; grid-template-columns: 1fr .72fr 1.25fr; }
      .production-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; min-height: 400px; padding: 8px; }
      .panel-number { align-items: center; background: var(--deep); border-radius: 50%; color: white; display: inline-flex; font-size: 8px; font-weight: 800; height: 20px; justify-content: center; margin-right: 5px; width: 20px; }
      .production-panel h2 { color: var(--deep); display: inline; font-size: 12px; }
      .panel-description { color: var(--muted); font-size: 7px; margin: 3px 0 8px 27px; }
      .production-field { border-top: 1px solid var(--subtle); min-height: 54px; padding: 7px 2px 4px; }
      .production-field.observation { min-height: 77px; }
      .production-field strong { font-size: 7.5px; }
      .campo-producao-vazio { border-bottom: 1px solid var(--text); display: block; height: 28px; margin-top: 5px; }
      .production-field.observation .campo-producao-vazio { height: 49px; }
      .review-box { align-items: center; background: var(--deep); border-radius: 7px; color: white; display: flex; justify-content: space-between; margin-top: 8px; padding: 8px 10px; }
      .review-box strong { color: #ffb185; }
      .review-box span { font-size: 7px; max-width: 590px; }
    </style>
  </head>
  <body>
    <header class="sheet-header">
      <div><div class="brand">Silmer</div><h1>FICHA DE PEDIDO</h1></div>
      <div class="header-id"><span class="synthetic">Amostra sintetica - nao produzir</span><div class="order-id"><span>Pedido</span><strong>${display(snapshot.pedido.numero)}</strong></div></div>
    </header>
    <div class="section-label">Resumo do pedido</div>
    <section class="summary">
      <div><span class="label">Cliente</span><strong>${display(snapshot.pedido.cliente)}</strong></div>
      <div><span class="label">Entrega confirmada</span><strong>${display(snapshot.pedido.data_entrega_confirmada)}</strong></div>
      <div><span class="label">Total de pecas</span><strong class="quantity">${display(snapshot.pedido.quantidade_total)}</strong></div>
      <div><span class="label">Aplicacao</span><strong>${display(snapshot.pedido.aplicacao)}</strong></div>
    </section>
    <section class="supporting">
      <div><span class="label">Evento / Nome</span><strong>${display(snapshot.pedido.nome)}</strong></div>
      <div><span class="label">Vendedor</span><strong>${display(snapshot.pedido.vendedor)}</strong></div>
      <div><span class="label">Data do pedido</span><strong>${display(snapshot.pedido.data)}</strong></div>
      <div><span class="label">FAB</span><strong>FAB ${display(snapshot.pedido.fab)}</strong></div>
    </section>
    <div class="section-label">Itens e especificacoes</div>
    <section class="items">${itemCards}</section>
    <section class="page-footer-content">
      <div class="observations"><span class="label">Observacoes do pedido</span><ol>${snapshot.pedido.observacoes.map((/** @type {string} */ note) => `<li>${display(note)}</li>`).join('')}</ol></div>
      <div class="grand-total"><span>Total<br>de pecas</span><strong>${display(snapshot.pedido.quantidade_total)}</strong></div>
    </section>

    <section class="page-break">
      <header class="sheet-header">
        <div><div class="brand">Silmer</div><h1>CONTROLE DE PRODUCAO</h1></div>
        <div class="header-id"><span class="synthetic">Campos vazios para preenchimento</span><div class="order-id"><span>Pedido</span><strong>${display(snapshot.pedido.numero)}</strong></div></div>
      </header>
      <p class="production-intro">Preenchimento exclusivo da equipe de producao e arte. Os 14 campos abaixo devem chegar vazios a esta etapa.</p>
      <div class="production-grid">${productionSections
        .map(
          (section, sectionIndex) =>
            `<section class="production-panel"><div><span class="panel-number">${display(sectionIndex + 1)}</span><h2>${display(section.title)}</h2></div><p class="panel-description">${display(section.description)}</p>${section.fields
              .map(
                ([label, field]) =>
                  `<div class="production-field${field.includes('observacao') ? ' observation' : ''}"><strong>${display(label)}</strong><span class="campo-producao-vazio">${display(snapshot.producao[field])}</span></div>`,
              )
              .join('')}</section>`,
        )
        .join('')}</div>
      <div class="review-box"><strong>Gate humano pendente</strong><span>Rose e Operacao devem revisar legibilidade, conteudo, ordem, grade, totais e impressao. Este arquivo nao registra aprovacao.</span></div>
    </section>
  </body>
</html>`;
}

/** @param {any} snapshot */
export function buildLegacyFichaHtml(snapshot) {
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

/** @param {any} gate */
export function buildReviewPageHtml(gate) {
  const canonicalFile = gate.artifact.path.split('/').at(-1);
  const legacyFile = gate.legacyArtifact.path.split('/').at(-1);
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Revisao da Ficha - Silmer</title>
    <style>
      :root { color-scheme: light; --canvas: #f7f6fb; --surface: #fff; --raised: #f0eef8; --text: #1b1530; --muted: #625b75; --border: #d8d4e4; --accent: #ff5b01; --deep: #0c042d; --link: #5b3fd1; }
      * { box-sizing: border-box; }
      body { align-items: center; background: var(--canvas); color: var(--text); display: flex; font-family: Poppins, Arial, sans-serif; justify-content: center; margin: 0; min-height: 100vh; padding: 32px 20px; }
      main { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: 0 18px 50px rgba(12, 4, 45, .08); max-width: 720px; padding: 36px; width: 100%; }
      .eyebrow { color: var(--link); font-size: .75rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      h1 { color: var(--deep); font-size: clamp(1.8rem, 5vw, 2.75rem); letter-spacing: -.04em; line-height: 1.05; margin: 8px 0 14px; }
      p { color: var(--muted); line-height: 1.6; margin: 0; }
      .notice { background: #fff0e7; border-left: 4px solid var(--accent); border-radius: 0 8px 8px 0; color: #5b280a; margin: 24px 0; padding: 14px 16px; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; }
      .button { border: 2px solid transparent; border-radius: 10px; display: inline-flex; font-weight: 800; justify-content: center; min-height: 48px; padding: 13px 18px; text-decoration: none; }
      .button:focus-visible { outline: 3px solid #ffb88f; outline-offset: 3px; }
      .button-primary { background: var(--accent); color: #241006; }
      .button-primary:hover { background: #e94f00; color: white; }
      .button-secondary { background: var(--raised); border-color: var(--border); color: var(--deep); }
      .button-secondary:hover { border-color: var(--link); color: var(--link); }
      .legacy-note { font-size: .85rem; margin-top: 18px; }
      @media (max-width: 540px) { main { padding: 26px 20px; } .button { width: 100%; } }
    </style>
  </head>
  <body>
    <main>
      <span class="eyebrow">Issue #7 · T00.4</span>
      <h1>Escolha a Ficha para revisao</h1>
      <p>A nova Ficha organiza o pedido por blocos operacionais e preserva todos os campos comerciais e de producao.</p>
      <p class="notice"><strong>Gate humano pendente.</strong> Os arquivos usam somente dados sinteticos e nao representam aprovacao de Rose ou Operacao.</p>
      <div class="actions">
        <a class="button button-primary" href="./${display(canonicalFile)}" download>${display(gate.artifact.downloadLabel)}</a>
        <a class="button button-secondary" href="./${display(legacyFile)}" download>${display(gate.legacyArtifact.downloadLabel)}</a>
      </div>
      <p class="legacy-note">A ficha legada preserva temporariamente a visualizacao tabular anterior como opcao de contingencia.</p>
    </main>
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
  const legacyArtifactUrl = new URL(gate.legacyArtifact.path, rootUrl);
  const reviewPageUrl = new URL(gate.reviewPage.path, rootUrl);
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
  const legacyArtifactBytes = await readFile(legacyArtifactUrl);
  gate.snapshotSha256 = sha256(snapshotBytes);
  gate.artifact.sha256 = sha256(artifactBytes);
  gate.artifact.pageCount = countPdfPages(artifactBytes);
  gate.legacyArtifact.sha256 = sha256(legacyArtifactBytes);
  gate.legacyArtifact.pageCount = countPdfPages(legacyArtifactBytes);
  const reviewPageHtml = buildReviewPageHtml(gate);
  await writeFile(reviewPageUrl, reviewPageHtml);
  await writeFile(
    gateUrl,
    await format(JSON.stringify(gate), { parser: 'json' }),
  );
  validateFichaApprovalGate({
    artifactBytes,
    gate,
    legacyArtifactBytes,
    reviewPageHtml,
    snapshotBytes,
  });
  console.log(
    `Ficha review PDFs ready: ${gate.artifact.path} (new) and ${gate.legacyArtifact.path} (legacy).`,
  );
}

async function validate() {
  const { gate, snapshot, snapshotBytes } = await readPackage();
  validateFichaSnapshot(snapshot);
  const artifactBytes = await readFile(new URL(gate.artifact.path, rootUrl));
  const legacyArtifactBytes = await readFile(
    new URL(gate.legacyArtifact.path, rootUrl),
  );
  const reviewPageHtml = await readFile(
    new URL(gate.reviewPage.path, rootUrl),
    'utf8',
  );
  const evidence = gate.approval.evidenceRef
    ? JSON.parse(
        await readFile(new URL(gate.approval.evidenceRef, rootUrl), 'utf8'),
      )
    : null;
  validateFichaApprovalGate({
    artifactBytes,
    evidence,
    gate,
    legacyArtifactBytes,
    reviewPageHtml,
    snapshotBytes,
  });
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
