import { ApiError, commandKey, request } from '../lib/api-client.js';
import { STAGES, stageKey } from './kanban-view.js';
import {
  asArray,
  asObject,
  el,
  formatDate,
  openDialog,
  text,
  withBusy,
} from '../lib/ui.js';

const SECTION_FIELDS = [
  [
    'Produto',
    'product',
    [
      ['Intenção comercial', 'commercialIntent'],
      ['Itens', 'itemCount'],
      ['Produtos', 'products'],
      ['Quantidade total', 'totalQuantity'],
    ],
  ],
  [
    'Especificação',
    'specification',
    [
      ['Modelos', 'models'],
      ['Tecidos', 'fabrics'],
      ['Linhas de grade', 'gradeLines'],
      ['Versões de catálogo', 'catalogVersions'],
    ],
  ],
  [
    'Estampa',
    'print',
    [
      ['Técnica', 'techniqueCode'],
      ['Locais', 'locationsCount'],
      ['Cores', 'colorsCount'],
      ['Status da arte', 'status'],
    ],
  ],
  [
    'Logística',
    'logistics',
    [
      ['Modalidade', 'mode'],
      ['Data desejada', 'desiredDate'],
      ['Endereço informado', 'addressPresent'],
      ['Retirada informada', 'pickupLocationPresent'],
    ],
  ],
];

const VALUE_LABELS = new Map([
  ['OPEN', 'Em andamento'],
  ['WON', 'Ganho'],
  ['LOST', 'Perdido'],
  ['delivery', 'Entrega'],
  ['pickup', 'Retirada'],
  ['pending', 'Pendente'],
  ['confirmed', 'Confirmado'],
  ['silk', 'Silk screen'],
]);

/** @param {unknown} value */
function displayValue(value) {
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  const source = text(value);
  return VALUE_LABELS.get(source) ?? source;
}

/** @param {Record<string,any>} raw */
function normalize(raw) {
  const deal = asObject(raw.deal ?? raw.item ?? raw);
  const identification = asObject(deal.identification);
  const qualification = asObject(
    raw.qualification ?? deal.qualification ?? deal.completeness,
  );
  const assessments = asArray(qualification.assessments);
  const blockers = assessments.filter((assessment) => {
    const status = String(asObject(assessment).status ?? '').toLowerCase();
    return status === 'pending' || status === 'missing' || status === 'blocked';
  });
  const completed = assessments.filter((assessment) => {
    const status = String(asObject(assessment).status ?? '').toLowerCase();
    return ['confirmed', 'complete', 'not_applicable', 'n/a'].includes(status);
  }).length;
  const items = asArray(qualification.items).map(asObject);
  const order = asObject(qualification.order);
  const artwork = asObject(qualification.artwork);
  const logistics = asObject(qualification.logistics);
  const responsible = asObject(
    deal.responsible ?? deal.assignedUser ?? deal.assignee,
  );
  return {
    raw: {
      product: {
        commercialIntent: order.commercialIntent,
        itemCount: items.length,
        products: uniqueValues(items, 'productCode'),
        totalQuantity: qualification.totalQuantity,
      },
      specification: {
        models: uniqueValues(items, 'modelCode'),
        fabrics: items.flatMap((item) => asArray(item.fabrics)).length,
        gradeLines: items.flatMap((item) => asArray(item.grade)).length,
        catalogVersions: uniqueValues(items, 'catalogVersionNumber'),
      },
      print: artwork,
      logistics,
    },
    id: text(deal.id ?? deal.dealId, ''),
    version: Number(deal.version ?? deal.dealVersion ?? 0),
    stage: stageKey(deal.stage ?? deal.currentStage),
    status: text(deal.status, 'Em andamento'),
    label: text(
      identification.customerLabel ??
        identification.orderName ??
        deal.displayLabel ??
        deal.safeLabel ??
        deal.title,
      deal.id
        ? `Negócio ${String(deal.id).slice(0, 8)}`
        : 'Negócio sem identificação',
    ),
    responsible: text(
      responsible.displayLabel ?? responsible.name ?? deal.responsibleLabel,
      'Não atribuído',
    ),
    completeness: Number(
      qualification.percent ??
        qualification.completenessPercent ??
        deal.completenessPercent ??
        (assessments.length
          ? Math.round((completed / assessments.length) * 100)
          : 0),
    ),
    blockers: asArray(qualification.blockers ?? deal.blockers ?? blockers),
    tasks: asArray(raw.tasks ?? deal.tasks ?? deal.pendingTasks).length
      ? asArray(raw.tasks ?? deal.tasks ?? deal.pendingTasks)
      : raw.nextTask
        ? [raw.nextTask]
        : [],
    handoffs: asArray(raw.handoffs ?? deal.handoffs ?? deal.activeHandoffs),
    gates: asArray(raw.gates ?? deal.gates),
    history: asArray(
      raw.history ?? deal.history ?? deal.events ?? deal.auditTrail,
    ),
    allowedActions: asArray(deal.allowedActions ?? raw.allowedActions).map(
      String,
    ),
    eventCursor: text(raw.eventCursor ?? deal.eventCursor, ''),
  };
}

/** @param {Record<string,any>[]} values @param {string} key */
function uniqueValues(values, key) {
  const unique = [
    ...new Set(
      values
        .map((value) => value[key])
        .filter((value) => value !== null && value !== undefined),
    ),
  ];
  return unique.length ? unique.join(', ') : undefined;
}

/**
 * @param {HTMLElement} outlet @param {string} dealId
 * @param {{navigate:(path:string)=>void,announce:(message:string)=>void,showError:(message:string,focus?:boolean)=>void,onCursor:(cursor:string)=>void}} context
 */
export function createDealDetailView(outlet, dealId, context) {
  let disposed = false;
  let entryFocusPending = true;
  let controller = new AbortController();
  let current = normalize({ id: dealId });
  let etag = '';
  async function load({ announce = false, restoreFocusKey = '' } = {}) {
    const focusKey =
      restoreFocusKey ||
      (document.activeElement instanceof globalThis.HTMLElement &&
      outlet.contains(document.activeElement)
        ? document.activeElement.dataset.focusKey
        : '');
    controller.abort();
    controller = new AbortController();
    try {
      const response = await request(
        `/api/v1/deals/${encodeURIComponent(dealId)}`,
        { signal: controller.signal },
      );
      if (disposed) return;
      current = normalize(asObject(response.data));
      etag = response.etag ?? etag;
      context.onCursor(current.eventCursor);
      render();
      restoreFocus(focusKey);
      if (announce) context.announce('Detalhes do negócio atualizados.');
    } catch (error) {
      if (/** @type {Error} */ (error).name === 'AbortError') return;
      renderFailure(
        error instanceof ApiError && error.status === 404
          ? 'Negócio não encontrado.'
          : 'Não foi possível carregar este negócio.',
      );
      restoreFocus(focusKey);
    }
  }

  /** @param {string|undefined} focusKey */
  function restoreFocus(focusKey) {
    if (!focusKey) return;
    const target = /** @type {HTMLElement|null} */ (
      outlet.querySelector(
        `[data-focus-key="${globalThis.CSS.escape(focusKey)}"]`,
      )
    );
    (target ?? outlet.querySelector('h1'))?.focus();
  }

  function render() {
    const h1 = el('h1', { tabindex: '-1', text: current.label });
    const back = el('a', {
      href: '/kanban',
      'data-route': '',
      'data-focus-key': 'detail-back',
      class: 'back-link',
      text: '← Voltar ao Kanban',
    });
    back.addEventListener('click', (event) => {
      event.preventDefault();
      context.navigate('/kanban');
    });
    const stageLabel =
      STAGES.find(([key]) => key === current.stage)?.[1] ?? current.stage;
    const heading = el(
      'header',
      { class: 'detail-heading' },
      el(
        'div',
        {},
        back,
        el('p', { class: 'eyebrow', text: `Etapa: ${stageLabel}` }),
        h1,
        el('p', {
          text: `Status: ${displayValue(current.status)}. Responsável: ${current.responsible}.`,
        }),
      ),
      el(
        'div',
        { class: 'detail-score' },
        el('strong', {
          text: `${Math.max(0, Math.min(100, current.completeness))}%`,
        }),
        el('span', { text: 'completo' }),
      ),
    );
    const summary = el(
      'section',
      { class: 'surface detail-summary', 'aria-labelledby': 'summary-title' },
      el('h2', { id: 'summary-title', text: 'Resumo e pendências' }),
      renderBlockers(),
    );
    const fields = el('div', { class: 'detail-fields' });
    for (const [title, key, definitions] of SECTION_FIELDS)
      fields.append(
        renderFieldSection(
          String(title),
          String(key),
          /** @type {string[][]} */ (definitions),
        ),
      );
    const operations = el(
      'div',
      { class: 'detail-operations' },
      renderListSection(
        'Tarefas',
        'tasks-title',
        current.tasks,
        renderTask,
        'Nenhuma tarefa registrada.',
      ),
      renderListSection(
        'Transferências e retomadas',
        'handoffs-title',
        current.handoffs,
        renderHandoff,
        'Nenhuma transferência ativa.',
      ),
    );
    const actions = renderActions();
    const history = renderListSection(
      'Gates e histórico',
      'history-title',
      [
        ...current.gates.map((gate) => ({ ...asObject(gate), kind: 'gate' })),
        ...current.history,
      ],
      renderHistory,
      'Nenhum evento disponível.',
    );
    outlet.replaceChildren(
      el(
        'article',
        { class: 'page deal-detail' },
        heading,
        actions,
        summary,
        fields,
        operations,
        history,
      ),
    );
    if (entryFocusPending) {
      h1.focus();
      entryFocusPending = false;
    }
  }

  function renderBlockers() {
    if (!current.blockers.length)
      return el('p', {
        class: 'ready-message',
        text: 'Sem bloqueios obrigatórios nesta etapa.',
      });
    return el(
      'div',
      {},
      el('p', {
        class: 'blocker-message',
        text: `${current.blockers.length} pendência${current.blockers.length === 1 ? '' : 's'} impede${current.blockers.length === 1 ? '' : 'm'} o avanço:`,
      }),
      el(
        'ul',
        { class: 'blocker-list' },
        ...current.blockers.map((item) => {
          const value = asObject(item);
          return el('li', {
            text: text(value.label ?? value.field ?? value.code ?? item),
          });
        }),
      ),
    );
  }

  /** @param {string} title @param {string} key @param {string[][]} definitions */
  function renderFieldSection(title, key, definitions) {
    const raw = /** @type {Record<string, any>} */ (current.raw);
    const sections = asObject(raw.sections);
    const source = asObject(raw[key] ?? sections[key]);
    const dl = el('dl', { class: 'field-list' });
    for (const [label, field] of definitions)
      dl.append(
        el(
          'div',
          {},
          el('dt', { text: label }),
          el('dd', { text: displayValue(source[field] ?? raw[field]) }),
        ),
      );
    return el(
      'section',
      { class: 'surface', 'aria-labelledby': `section-${key}` },
      el('h2', { id: `section-${key}`, text: title }),
      dl,
    );
  }

  /** @param {string} title @param {string} id @param {any[]} values @param {(item:Record<string,any>)=>HTMLElement} renderer @param {string} empty */
  function renderListSection(title, id, values, renderer, empty) {
    return el(
      'section',
      { class: 'surface', 'aria-labelledby': id },
      el('h2', { id, text: title }),
      values.length
        ? el(
            'ol',
            { class: 'timeline' },
            ...values.map((value) => el('li', {}, renderer(asObject(value)))),
          )
        : el('p', { class: 'muted', text: empty }),
    );
  }
  /** @param {Record<string,any>} task */
  function renderTask(task) {
    const content = el(
      'div',
      {},
      el('strong', {
        text: text(task.title ?? task.text ?? task.type, 'Tarefa'),
      }),
      el('p', {
        text: `${text(task.status, 'Pendente')} · ${formatDate(task.dueAt)}`,
      }),
      task.assignedUserLabel
        ? el('p', { text: `Responsável: ${text(task.assignedUserLabel)}` })
        : null,
    );
    const status = String(task.status ?? '').toLowerCase();
    if (task.id && Number.isFinite(Number(task.version))) {
      const actions = el('div', { class: 'inline-actions' });
      if (status === 'pending')
        actions.append(taskButton(task, 'start', 'Iniciar'));
      if (['pending', 'in_progress'].includes(status)) {
        actions.append(taskButton(task, 'complete', 'Concluir'));
        actions.append(taskButton(task, 'cancel', 'Cancelar'));
      }
      content.append(actions);
    }
    return content;
  }
  /** @param {Record<string,any>} handoff */
  function renderHandoff(handoff) {
    const content = el(
      'div',
      {},
      el('strong', {
        text: text(handoff.summary ?? handoff.status, 'Transferência'),
      }),
      el('p', {
        text: `${text(handoff.status, 'Pendente')} · ${formatDate(handoff.createdAt)}`,
      }),
    );
    const status = String(handoff.status ?? '').toLowerCase();
    if (hasHandoffVersions(handoff)) {
      const actions = el('div', { class: 'inline-actions' });
      if (status === 'pending')
        actions.append(handoffButton(handoff, 'accept', 'Aceitar retomada'));
      if (['pending', 'accepted'].includes(status))
        actions.append(transferButton(handoff));
      if (status === 'accepted')
        actions.append(handoffButton(handoff, 'resolve', 'Resolver retomada'));
      content.append(actions);
    }
    return content;
  }
  /** @param {Record<string,any>} event */
  function renderHistory(event) {
    if (event.kind === 'gate') {
      const blockers = asArray(event.blockers);
      return el(
        'div',
        {},
        el('strong', {
          text: blockers.length
            ? `Gate bloqueado em ${text(event.fromStage, 'etapa')}`
            : `Gate liberado em ${text(event.fromStage, 'etapa')}`,
        }),
        el('p', {
          text: `${formatDate(event.evaluatedAt)} · versão ${text(event.sourceVersion)}`,
        }),
      );
    }
    return el(
      'div',
      {},
      el('strong', {
        text: text(event.label ?? event.type ?? event.eventType, 'Atualização'),
      }),
      el('p', {
        text: `${formatDate(event.occurredAt ?? event.createdAt)}${event.actorLabel ? ` · ${text(event.actorLabel)}` : ''}`,
      }),
    );
  }

  /** @param {Record<string,any>} task @param {'start'|'complete'|'cancel'} action @param {string} label */
  function taskButton(task, action, label) {
    const button = el('button', {
      type: 'button',
      class: 'quiet',
      'data-focus-key': `task-${task.id}-${action}`,
      text: label,
    });
    button.addEventListener('click', () => {
      const key = commandKey();
      void withBusy(button, () =>
        request(
          `/api/v1/tasks/${encodeURIComponent(String(task.id))}/${action}`,
          {
            method: 'POST',
            idempotencyKey: key,
            body: {
              expectedTaskVersion: Number(task.version),
              reasonCode: 'manual_follow_up',
            },
          },
        ),
      )
        .then(async () => {
          context.announce(`Tarefa atualizada: ${label.toLowerCase()}.`);
          await load({ restoreFocusKey: button.dataset.focusKey });
        })
        .catch(async (error) => {
          if (error instanceof ApiError && error.status === 409) {
            context.showError('A tarefa mudou. Os dados foram atualizados.');
            await load({ restoreFocusKey: button.dataset.focusKey });
          } else context.showError('A tarefa não pôde ser atualizada.');
        });
    });
    return button;
  }

  /** @param {Record<string,any>} handoff */
  function hasHandoffVersions(handoff) {
    return (
      handoff.id &&
      handoff.taskId &&
      [
        handoff.version,
        handoff.dealVersion,
        handoff.conversationVersion,
        handoff.taskVersion,
      ].every((value) => Number.isFinite(Number(value)))
    );
  }

  /** @param {Record<string,any>} handoff @param {'accept'|'resolve'} action @param {string} label */
  function handoffButton(handoff, action, label) {
    const button = el('button', {
      type: 'button',
      class: 'quiet',
      'data-focus-key': `handoff-${handoff.id}-${action}`,
      text: label,
    });
    button.addEventListener('click', () => {
      const key = commandKey();
      void withBusy(button, () =>
        request(
          `/api/v1/handoffs/${encodeURIComponent(String(handoff.id))}/${action}`,
          {
            method: 'POST',
            idempotencyKey: key,
            body: handoffCommand(
              handoff,
              action === 'accept' ? 'handoff_accepted' : 'handoff_resolved',
            ),
          },
        ),
      )
        .then(async () => {
          context.announce(`${label} concluída.`);
          await load({ restoreFocusKey: button.dataset.focusKey });
        })
        .catch(async (error) =>
          handleHandoffError(error, button.dataset.focusKey),
        );
    });
    return button;
  }

  /** @param {Record<string,any>} handoff */
  function transferButton(handoff) {
    const button = el('button', {
      type: 'button',
      class: 'quiet',
      'data-focus-key': `handoff-${handoff.id}-transfer`,
      text: 'Transferir',
    });
    button.addEventListener('click', () =>
      commandDialog(
        button,
        'Transferir retomada',
        [
          el('label', { for: 'transfer-user', text: 'ID da nova pessoa' }),
          el('input', {
            id: 'transfer-user',
            name: 'assignedUserId',
            required: true,
          }),
        ],
        async (data, key) =>
          request(
            `/api/v1/handoffs/${encodeURIComponent(String(handoff.id))}/transfer`,
            {
              method: 'POST',
              idempotencyKey: key,
              body: {
                ...handoffCommand(handoff, 'manual_transfer'),
                assignedUserId: String(data.get('assignedUserId')),
              },
            },
          ),
        'Retomada transferida.',
      ),
    );
    return button;
  }

  /** @param {Record<string,any>} handoff @param {string} reasonCode */
  function handoffCommand(handoff, reasonCode) {
    return {
      expectedConversationVersion: Number(handoff.conversationVersion),
      expectedDealVersion: Number(handoff.dealVersion),
      expectedHandoffVersion: Number(handoff.version),
      expectedTaskVersion: Number(handoff.taskVersion),
      reasonCode,
    };
  }

  /** @param {unknown} error @param {string|undefined} restoreFocusKey */
  async function handleHandoffError(error, restoreFocusKey) {
    if (error instanceof ApiError && error.status === 409) {
      context.showError('A retomada mudou. Os dados foram atualizados.');
      await load({ restoreFocusKey });
    } else context.showError('A retomada não pôde ser atualizada.');
  }

  function renderActions() {
    const group = el('section', {
      class: 'action-bar',
      'aria-label': 'Ações do negócio',
    });
    const move = el('button', {
      class: 'primary',
      type: 'button',
      'data-focus-key': 'detail-move',
      text: 'Alterar etapa',
    });
    move.addEventListener('click', () => openMove(move));
    const task = el('button', {
      type: 'button',
      'data-focus-key': 'detail-task',
      text: 'Criar tarefa',
    });
    task.addEventListener('click', () => openTask(task));
    const assign = el('button', {
      type: 'button',
      'data-focus-key': 'detail-assign',
      text: 'Atribuir responsável',
    });
    assign.addEventListener('click', () => openAssign(assign));
    const lose = el('button', {
      type: 'button',
      class: 'danger',
      'data-focus-key': 'detail-lose',
      text: 'Marcar como perdido',
    });
    lose.addEventListener('click', () => openLose(lose));
    group.append(move, task, assign, lose);
    return group;
  }

  /** @param {HTMLElement} trigger */
  function openMove(trigger) {
    const currentIndex = STAGES.findIndex(([key]) => key === current.stage);
    const options = STAGES.filter(
      ([,], index) => Math.abs(index - currentIndex) === 1,
    ).map(([key, label]) => el('option', { value: key, text: label }));
    commandDialog(
      trigger,
      'Alterar etapa',
      [
        el('label', { for: 'detail-stage', text: 'Nova etapa' }),
        el(
          'select',
          { id: 'detail-stage', name: 'stage', required: true },
          ...options,
        ),
        el('label', { for: 'detail-reason', text: 'Motivo' }),
        el('input', {
          id: 'detail-reason',
          name: 'reason',
          required: true,
          maxlength: '160',
        }),
      ],
      async (data, key) =>
        request(`/api/v1/deals/${encodeURIComponent(dealId)}/transitions`, {
          method: 'POST',
          idempotencyKey: key,
          body: {
            direction:
              STAGES.findIndex(
                ([stage]) => stage === String(data.get('stage')),
              ) > currentIndex
                ? 'forward'
                : 'backward',
            expectedVersion: current.version,
            reason: String(data.get('reason')),
          },
        }),
      'Etapa alterada.',
    );
  }
  /** @param {HTMLElement} trigger */
  function openLose(trigger) {
    commandDialog(
      trigger,
      'Marcar negócio como perdido',
      [
        el('label', { for: 'loss-reason', text: 'Motivo da perda' }),
        el('input', {
          id: 'loss-reason',
          name: 'reason',
          required: true,
          maxlength: '160',
        }),
      ],
      async (data, key) =>
        request(`/api/v1/deals/${encodeURIComponent(dealId)}/lose`, {
          method: 'POST',
          idempotencyKey: key,
          body: {
            expectedVersion: current.version,
            reason: String(data.get('reason')),
          },
        }),
      'Negócio marcado como perdido.',
    );
  }
  /** @param {HTMLElement} trigger */
  function openAssign(trigger) {
    commandDialog(
      trigger,
      'Atribuir responsável',
      [
        el('label', { for: 'assigned-user', text: 'ID da pessoa' }),
        el('input', {
          id: 'assigned-user',
          name: 'assignedUserId',
          required: true,
        }),
        el('label', { for: 'assign-reason', text: 'Motivo' }),
        el('input', {
          id: 'assign-reason',
          name: 'reasonCode',
          required: true,
          value: 'manual_assignment',
        }),
      ],
      async (data, key) =>
        request(`/api/v1/deals/${encodeURIComponent(dealId)}/assign`, {
          method: 'POST',
          idempotencyKey: key,
          body: {
            assignedUserId: String(data.get('assignedUserId')),
            expectedDealVersion: current.version,
            reasonCode: String(data.get('reasonCode')),
          },
        }),
      'Responsável atualizado.',
    );
  }
  /** @param {HTMLElement} trigger */
  function openTask(trigger) {
    commandDialog(
      trigger,
      'Criar tarefa',
      [
        el('label', { for: 'task-text', text: 'Tarefa' }),
        el('input', {
          id: 'task-text',
          name: 'text',
          required: true,
          maxlength: '160',
        }),
        el('label', { for: 'task-due', text: 'Prazo' }),
        el('input', {
          id: 'task-due',
          name: 'dueAt',
          type: 'datetime-local',
          required: true,
        }),
        el('label', { for: 'task-user', text: 'ID do responsável' }),
        el('input', {
          id: 'task-user',
          name: 'assignedUserId',
          required: true,
        }),
      ],
      async (data, key) =>
        request(`/api/v1/deals/${encodeURIComponent(dealId)}/tasks`, {
          method: 'POST',
          idempotencyKey: key,
          body: {
            assignedUserId: String(data.get('assignedUserId')),
            dueAt: new Date(String(data.get('dueAt'))).toISOString(),
            expectedDealVersion: current.version,
            reasonCode: 'manual_follow_up',
            text: String(data.get('text')),
            type: 'follow_up',
          },
        }),
      'Tarefa criada.',
    );
  }

  /** @param {HTMLElement} trigger @param {string} title @param {HTMLElement[]} fields @param {(data:FormData,key:string)=>Promise<any>} action @param {string} success */
  function commandDialog(trigger, title, fields, action, success) {
    const dialog = /** @type {HTMLDialogElement} */ (
      el('dialog', {
        class: 'command-dialog',
        'aria-labelledby': 'command-title',
      })
    );
    const cancel = el('button', {
      type: 'button',
      class: 'quiet',
      text: 'Cancelar',
    });
    const submit = el('button', {
      type: 'submit',
      class: 'primary',
      text: 'Confirmar',
    });
    const form = /** @type {HTMLFormElement} */ (
      el(
        'form',
        {},
        el('h2', { id: 'command-title', text: title }),
        ...fields,
        el('div', { class: 'button-row' }, cancel, submit),
      )
    );
    const key = commandKey();
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new globalThis.FormData(form);
      void withBusy(submit, () => action(data, key))
        .then(async () => {
          dialog.close();
          context.announce(success);
          await load({ restoreFocusKey: trigger.dataset.focusKey });
        })
        .catch(async (error) => {
          if (error instanceof ApiError && error.status === 409) {
            dialog.close();
            context.showError(
              'Este negócio foi alterado por outra pessoa. Os dados foram atualizados.',
            );
            await load({ restoreFocusKey: trigger.dataset.focusKey });
          } else
            context.showError(
              'A ação não pôde ser concluída. Revise os dados e permissões.',
            );
        });
    });
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    openDialog(dialog, trigger);
  }
  /** @param {string} message */
  function renderFailure(message) {
    const h1 = el('h1', { tabindex: '-1', text: 'Detalhes do negócio' });
    const retry = el('button', {
      class: 'primary',
      type: 'button',
      'data-focus-key': 'detail-retry',
      text: 'Tentar novamente',
    });
    retry.addEventListener(
      'click',
      () => void load({ restoreFocusKey: 'detail-retry' }),
    );
    outlet.replaceChildren(
      el(
        'section',
        { class: 'page empty-state' },
        h1,
        el('p', { text: message }),
        retry,
      ),
    );
    if (entryFocusPending) {
      h1.focus();
      entryFocusPending = false;
    }
  }
  void load();
  return {
    refreshFromEvent(/** @type {Record<string,any>} */ event) {
      if (!event.dealId || String(event.dealId) === dealId)
        void load({ announce: true });
    },
    reset: () => void load({ announce: true }),
    dispose() {
      disposed = true;
      controller.abort();
    },
  };
}
