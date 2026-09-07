import { ApiError, commandKey, request } from '../lib/api-client.js';
import {
  asArray,
  asObject,
  el,
  formatDuration,
  openDialog,
  text,
  withBusy,
} from '../lib/ui.js';

export const STAGES = [
  ['product', 'Produto'],
  ['specification', 'Especificação'],
  ['print', 'Estampa'],
  ['logistics', 'Logística'],
  ['closing', 'Fechamento'],
];
const aliases = new Map([
  ['PRODUCT', 'product'],
  ['PRODUTO', 'product'],
  ['SPECIFICATION', 'specification'],
  ['ESPECIFICACAO', 'specification'],
  ['PRINT', 'print'],
  ['ESTAMPA', 'print'],
  ['LOGISTICS', 'logistics'],
  ['LOGISTICA', 'logistics'],
  ['CLOSING', 'closing'],
  ['FECHAMENTO', 'closing'],
]);
const apiStages = new Map([
  ['product', 'produto'],
  ['specification', 'especificacao'],
  ['print', 'estampa'],
  ['logistics', 'logistica'],
  ['closing', 'fechamento'],
]);

/** @param {unknown} value */
export function stageKey(value) {
  const raw = String(value ?? '').trim();
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
  return aliases.get(normalized) ?? raw.toLowerCase();
}

/** @param {Record<string, any>} raw */
function normalizeCard(raw) {
  const identification = asObject(raw.identification);
  const responsible = asObject(
    raw.responsible ?? raw.assignedUser ?? raw.assignee,
  );
  const task = asObject(raw.nextTask ?? raw.nextPendingTask ?? raw.task);
  const qualification = asObject(raw.qualification ?? raw.completeness);
  return {
    id: text(raw.id ?? raw.dealId, ''),
    version: Number(raw.version ?? raw.dealVersion ?? 0),
    stage: stageKey(raw.stage ?? raw.currentStage),
    label: text(
      identification.customerLabel ??
        identification.orderName ??
        raw.displayLabel ??
        raw.safeLabel ??
        raw.title,
      (raw.id ?? raw.dealId)
        ? `Negócio ${String(raw.id ?? raw.dealId).slice(0, 8)}`
        : 'Negócio sem identificação',
    ),
    context: text(
      raw.context?.label ??
        raw.contextLabel ??
        raw.summary ??
        (raw.totalQuantity !== undefined
          ? `Quantidade estimada: ${raw.totalQuantity}`
          : ''),
      '',
    ),
    responsible: text(
      responsible.displayLabel ??
        responsible.name ??
        responsible.functionName ??
        raw.responsibleLabel,
      'Não atribuído',
    ),
    pending: text(
      task.title ?? qualification.nextPendingField ?? raw.nextPendingField,
      'Sem próxima pendência',
    ),
    time: formatDuration(
      raw.timeInStageSeconds ?? raw.stageElapsedSeconds,
      raw.stageEnteredAt,
    ),
    blockerCount: Number(qualification.blockerCount ?? raw.blockerCount ?? 0),
  };
}

/** @param {Record<string,any>} payload */
function normalizeBoard(payload) {
  const columns = new Map();
  for (const [key] of STAGES)
    columns.set(key, { items: [], nextCursor: '', total: 0 });
  const source = asArray(payload.columns ?? payload.stages);
  if (source.length) {
    for (const raw of source) {
      const column = asObject(raw);
      const key = stageKey(column.stage ?? column.key ?? column.id);
      if (!columns.has(key)) continue;
      const items = asArray(column.items ?? column.cards).map((item) =>
        normalizeCard(asObject(item)),
      );
      columns.set(key, {
        items,
        nextCursor: text(column.nextCursor, ''),
        total: Number(column.total ?? items.length),
      });
    }
  } else {
    for (const item of asArray(payload.items ?? payload.cards)) {
      const card = normalizeCard(asObject(item));
      const column = columns.get(card.stage);
      if (column) {
        column.items.push(card);
        column.total += 1;
      }
    }
  }
  return { columns, cursor: text(payload.eventCursor ?? payload.cursor, '') };
}

/**
 * @param {HTMLElement} outlet
 * @param {{navigate:(path:string)=>void,announce:(message:string)=>void,showError:(message:string,focus?:boolean)=>void,onCursor:(cursor:string)=>void}} context
 */
export function createKanbanView(outlet, context) {
  let disposed = false;
  let controller = new AbortController();
  let board = normalizeBoard({});
  let reloadTimer =
    /** @type {ReturnType<typeof globalThis.setTimeout>|undefined} */ (
      undefined
    );

  async function load({ announce = false, restoreFocusKey = '' } = {}) {
    const focusKey =
      restoreFocusKey ||
      (document.activeElement instanceof globalThis.HTMLElement
        ? document.activeElement.dataset.focusKey
        : '');
    controller.abort();
    controller = new AbortController();
    try {
      const { data } = await request('/api/v1/kanban', {
        signal: controller.signal,
      });
      if (disposed) return;
      board = normalizeBoard(asObject(data));
      context.onCursor(board.cursor);
      render();
      if (focusKey)
        /** @type {HTMLElement|null} */ (
          outlet.querySelector(
            `[data-focus-key="${globalThis.CSS.escape(focusKey)}"]`,
          )
        )?.focus();
      if (announce) context.announce('Kanban atualizado.');
    } catch (error) {
      if (/** @type {Error} */ (error).name !== 'AbortError') {
        renderEmpty('Não foi possível carregar o Kanban.');
        context.showError('Não foi possível carregar o Kanban.', false);
      }
    }
  }

  function render() {
    const title = el('h1', { text: 'Kanban comercial', tabindex: '-1' });
    const header = el(
      'header',
      { class: 'page-heading' },
      el(
        'div',
        {},
        el('p', { class: 'eyebrow', text: 'Operação comercial' }),
        title,
        el('p', {
          text: 'Acompanhe cada oportunidade e avance somente quando os dados obrigatórios estiverem completos.',
        }),
      ),
      el('button', { class: 'secondary', type: 'button', text: 'Atualizar' }),
    );
    header
      .querySelector('button')
      ?.addEventListener('click', () => void load({ announce: true }));
    const jump = /** @type {HTMLSelectElement} */ (
      el(
        'select',
        { id: 'stage-jump' },
        ...STAGES.map(([key, label]) =>
          el('option', { value: key, text: label }),
        ),
      )
    );
    jump.addEventListener('change', () =>
      outlet
        .querySelector(`#stage-${jump.value}`)
        ?.scrollIntoView({ inline: 'start', block: 'nearest' }),
    );
    const columns = el('div', {
      class: 'kanban-board',
      'aria-label': 'Etapas do funil',
      tabindex: '0',
    });
    for (const [key, label] of STAGES) columns.append(renderColumn(key, label));
    outlet.replaceChildren(
      el(
        'div',
        { class: 'page kanban-page' },
        header,
        el(
          'div',
          { class: 'mobile-stage-picker' },
          el('label', { for: 'stage-jump', text: 'Etapa visível' }),
          jump,
        ),
        columns,
      ),
    );
    title.focus();
  }

  /** @param {string} key @param {string} label */
  function renderColumn(key, label) {
    const column = board.columns.get(key) ?? {
      items: [],
      nextCursor: '',
      total: 0,
    };
    const list = el('ol', {
      class: 'kanban-list',
      'aria-label': `${column.total} negócios em ${label}`,
    });
    for (const card of column.items)
      list.append(el('li', {}, renderCard(card)));
    if (!column.items.length)
      list.append(
        el('li', {
          class: 'empty-column',
          text: 'Nenhum negócio nesta etapa.',
        }),
      );
    if (column.nextCursor) {
      const more = el('button', {
        type: 'button',
        class: 'quiet load-more',
        text: 'Carregar mais',
      });
      more.addEventListener(
        'click',
        () => void loadMore(key, column.nextCursor, more),
      );
      list.append(el('li', {}, more));
    }
    return el(
      'section',
      {
        class: 'kanban-column',
        id: `stage-${key}`,
        'aria-labelledby': `stage-title-${key}`,
      },
      el(
        'header',
        {},
        el('span', {
          class: 'stage-index',
          text: String(STAGES.findIndex(([stage]) => stage === key) + 1),
        }),
        el('h2', { id: `stage-title-${key}`, text: label }),
        el('span', {
          class: 'count',
          text: String(column.total),
          'aria-label': `${column.total} negócios`,
        }),
      ),
      list,
    );
  }

  /** @param {any} card */
  function renderCard(card) {
    const open = el(
      'a',
      {
        class: 'card-link',
        href: `/negocios/${encodeURIComponent(card.id)}`,
        'data-route': '',
        'data-focus-key': `deal-${card.id}`,
      },
      el('span', { class: 'card-title', text: card.label }),
      card.context
        ? el('span', { class: 'card-context', text: card.context })
        : null,
    );
    open.addEventListener('click', (event) => {
      event.preventDefault();
      context.navigate(open.getAttribute('href') ?? '/kanban');
    });
    const move = el('button', {
      type: 'button',
      class: 'move-button',
      text: 'Mover',
      'aria-label': `Mover ${card.label} para outra etapa`,
      'data-focus-key': `move-${card.id}`,
    });
    move.addEventListener('click', () => showMoveDialog(card, move));
    const status =
      card.blockerCount > 0
        ? el('span', {
            class: 'blocker',
            text: `${card.blockerCount} bloqueio${card.blockerCount === 1 ? '' : 's'}`,
          })
        : el('span', { class: 'ready', text: 'Sem bloqueios' });
    return el(
      'article',
      {
        class: 'deal-card',
        'data-deal-id': card.id,
        'data-version': String(card.version),
      },
      open,
      el(
        'dl',
        { class: 'card-facts' },
        el(
          'div',
          {},
          el('dt', { text: 'Responsável' }),
          el('dd', { text: card.responsible }),
        ),
        el(
          'div',
          {},
          el('dt', { text: 'Próximo' }),
          el('dd', { text: card.pending }),
        ),
        el(
          'div',
          {},
          el('dt', { text: 'Tempo' }),
          el('dd', { text: card.time }),
        ),
      ),
      el('footer', {}, status, move),
    );
  }

  /** @param {any} card @param {HTMLElement} trigger */
  function showMoveDialog(card, trigger) {
    const dialog = /** @type {HTMLDialogElement} */ (
      el('dialog', { class: 'command-dialog', 'aria-labelledby': 'move-title' })
    );
    const currentIndex = STAGES.findIndex(([key]) => key === card.stage);
    const options = STAGES.filter(
      ([,], index) => Math.abs(index - currentIndex) === 1,
    ).map(([key, label]) => el('option', { value: key, text: label }));
    const form = /** @type {HTMLFormElement} */ (
      el(
        'form',
        { method: 'dialog' },
        el(
          'div',
          { class: 'dialog-heading' },
          el('p', { class: 'eyebrow', text: 'Alterar etapa' }),
          el('h2', { id: 'move-title', text: card.label }),
        ),
        card.blockerCount > 0
          ? el('p', {
              class: 'blocker-message',
              text: `${card.blockerCount} bloqueio${card.blockerCount === 1 ? '' : 's'} pode impedir o avanço. O servidor validará a mudança.`,
            })
          : null,
        el('label', { for: 'target-stage', text: 'Etapa adjacente' }),
        el(
          'select',
          { id: 'target-stage', name: 'stage', required: true },
          ...options,
        ),
        el('label', { for: 'move-reason', text: 'Motivo' }),
        el('input', {
          id: 'move-reason',
          name: 'reason',
          required: true,
          maxlength: '160',
        }),
        el(
          'div',
          { class: 'button-row' },
          el('button', { type: 'button', class: 'quiet', text: 'Cancelar' }),
          el('button', {
            type: 'submit',
            class: 'primary',
            text: 'Confirmar mudança',
          }),
        ),
      )
    );
    const [cancel, submit] = /** @type {HTMLElement[]} */ ([
      ...form.querySelectorAll('button'),
    ]);
    const key = commandKey();
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void moveCard(card, form, submit, dialog, key);
    });
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    openDialog(dialog, trigger);
  }

  /** @param {any} card @param {HTMLFormElement} form @param {HTMLElement} button @param {HTMLDialogElement} dialog @param {string} key */
  async function moveCard(card, form, button, dialog, key) {
    const data = new globalThis.FormData(form);
    const destination = String(data.get('stage'));
    const reason = String(data.get('reason'));
    try {
      await withBusy(button, () =>
        request(`/api/v1/deals/${encodeURIComponent(card.id)}/transitions`, {
          method: 'POST',
          idempotencyKey: key,
          body: {
            direction:
              STAGES.findIndex(([stage]) => stage === destination) >
              STAGES.findIndex(([stage]) => stage === card.stage)
                ? 'forward'
                : 'backward',
            expectedVersion: card.version,
            reason,
          },
        }),
      );
      dialog.close();
      context.announce(
        `${card.label} movido para ${text(STAGES.find(([stage]) => stage === destination)?.[1], destination)}.`,
      );
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        dialog.close();
        context.showError(
          'O negócio mudou enquanto você trabalhava. O Kanban foi atualizado; revise antes de tentar novamente.',
        );
        await load({ restoreFocusKey: `move-${card.id}` });
      } else
        context.showError(
          'A etapa não pôde ser alterada. Verifique os bloqueios obrigatórios.',
        );
    }
  }

  /** @param {string} stage @param {string} cursor @param {HTMLElement} button */
  async function loadMore(stage, cursor, button) {
    await withBusy(button, async () => {
      const params = new globalThis.URLSearchParams({
        stage: apiStages.get(stage) ?? stage,
        cursor,
        limit: '25',
      });
      const { data } = await request(`/api/v1/kanban/cards?${params}`);
      const raw = asObject(data);
      const column = board.columns.get(stage);
      if (!column) return;
      const fresh = asArray(raw.items ?? raw.cards).map((item) =>
        normalizeCard(asObject(item)),
      );
      const seen = new Set(
        column.items.map((/** @type {any} */ item) => item.id),
      );
      column.items.push(...fresh.filter((item) => !seen.has(item.id)));
      column.nextCursor = text(raw.nextCursor, '');
      column.total = Number(
        raw.total ?? Math.max(column.total, column.items.length),
      );
      render();
    });
  }

  /** @param {string} message */
  function renderEmpty(message) {
    outlet.replaceChildren(
      el(
        'section',
        { class: 'page empty-state' },
        el('h1', { tabindex: '-1', text: 'Kanban comercial' }),
        el('p', { text: message }),
        el('button', {
          type: 'button',
          class: 'primary',
          text: 'Tentar novamente',
        }),
      ),
    );
    outlet
      .querySelector('button')
      ?.addEventListener('click', () => void load());
    outlet.querySelector('h1')?.focus();
  }
  function refreshFromEvent() {
    globalThis.clearTimeout(reloadTimer);
    reloadTimer = globalThis.setTimeout(
      () => void load({ announce: true }),
      180,
    );
  }
  void load();
  return {
    refreshFromEvent,
    reset: () => void load({ announce: true }),
    dispose() {
      disposed = true;
      controller.abort();
      globalThis.clearTimeout(reloadTimer);
    },
  };
}
