<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref } from 'vue';
import OrderSheetHead from '../../apps/edge-web/src/components/order/OrderSheetHead.vue';
import OrderIcon from '../../apps/edge-web/src/components/order/OrderIcon.vue';
import { openDialog } from '../../apps/edge-web/src/lib/ui.js';

defineProps({ order: { type: Object, required: true } });
const editing = inject('orderEditing', null);
const expanded = computed(() => editing?.isSectionOpen?.('billing') ?? true);
const scenario = ref('paid');
const entries = ref([]);
const notice = ref('');
const sectionRoot = ref(null);
let resultFocusId = '';
const dialog = ref(null);
const mode = ref('');
const selected = ref(null);
const amount = ref('');
const method = ref('Pix fora da InfinitePay');
const receivedOn = ref('2026-11-11');
const reason = ref('');
const formError = ref('');
const total = 120000;
const received = computed(() =>
  entries.value.reduce(
    (sum, entry) => sum + (entry.paid && !entry.reversed ? entry.amount : 0),
    0,
  ),
);
const balance = computed(() => Math.max(0, total - received.value));
const pending = computed(() =>
  entries.value.find((entry) => !entry.paid && !entry.reversed),
);
const needsReview = computed(() =>
  Boolean(pending.value && pending.value.amount > balance.value),
);
const status = computed(() =>
  needsReview.value
    ? 'Precisa de conferência'
    : balance.value === 0
      ? 'Quitado'
      : received.value
        ? 'Pago parcialmente'
        : 'A receber',
);
const title = computed(
  () =>
    ({
      issue: 'Revisar cobrança do saldo',
      external: 'Registrar recebimento externo',
      reverse: 'Estornar registro',
      refund: 'Registrar devolução',
      check: 'Conferir cobrança',
      receipt: 'Comprovante do pagamento',
      link: 'Link da cobrança',
    })[mode.value] ?? 'Detalhes',
);
const money = (value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    value / 100,
  );
const day = (value) => value.split('-').reverse().join('/');
const entryStatus = (entry) =>
  entry.reversed
    ? 'Registro estornado'
    : entry.paid
      ? 'Recebido'
      : entry.amount > balance.value
        ? 'Conferência necessária'
        : 'Aguardando pagamento';
const ip = () => ({
  id: 'signal',
  title: 'Sinal do pedido',
  source: 'InfinitePay',
  method: 'Pix',
  date: '2026-11-09',
  amount: 36000,
  paid: true,
  events: [
    ['09/11/2026, 09:00', 'Cobrança de sinal criada'],
    ['09/11/2026, 09:01', 'Link enviado na conversa'],
    ['09/11/2026, 09:12', 'Pagamento confirmado no CRM'],
  ],
});
const external = (amount = 84000) => ({
  id: 'manual',
  title: 'Recebimento manual',
  source: 'Registro manual',
  method: 'Transferência bancária',
  date: '2026-11-11',
  amount,
  paid: true,
  events: [['11/11/2026, 09:10', 'Registrado por Vendedor Silmer']],
});
const waiting = (amount = 84000) => ({
  id: 'balance',
  title: 'Saldo do pedido',
  source: 'InfinitePay',
  method: 'Pix ou cartão',
  date: '2026-11-11',
  amount,
  paid: false,
  events: [
    ['11/11/2026, 09:30', 'Cobrança do saldo criada'],
    ['11/11/2026, 09:31', 'Link enviado na conversa'],
  ],
});
function reset() {
  entries.value =
    scenario.value === 'paid'
      ? [external(), ip()]
      : scenario.value === 'partial'
        ? [ip()]
        : scenario.value === 'waiting'
          ? [waiting(), ip()]
          : scenario.value === 'review'
            ? [waiting(30000), external(64000), ip()]
            : [];
  notice.value = '';
}
reset();
async function show(nextMode, event, entry = null) {
  const trigger = event.currentTarget;
  resultFocusId = '';
  mode.value = nextMode;
  selected.value = entry;
  amount.value = (balance.value / 100).toFixed(2).replace('.', ',');
  reason.value = '';
  formError.value = '';
  await nextTick();
  openDialog(dialog.value, trigger);
}
function close() {
  dialog.value?.close();
}
async function afterClose() {
  mode.value = '';
  if (!resultFocusId) return;
  const target = resultFocusId;
  resultFocusId = '';
  await nextTick();
  [...(sectionRoot.value?.querySelectorAll('summary[data-entry-id]') ?? [])]
    .find((element) => element.dataset.entryId === target)
    ?.focus();
}
function confirm() {
  if (mode.value === 'external') {
    const cents = Math.round(Number(amount.value.replace(',', '.')) * 100);
    if (
      !Number.isInteger(cents) ||
      cents <= 0 ||
      cents > balance.value ||
      !receivedOn.value
    ) {
      formError.value =
        'Informe uma data e um valor maior que zero, até o saldo pendente.';
      return;
    }
    const id = `manual-${entries.value.length}`;
    entries.value.unshift({
      ...external(cents),
      id,
      date: receivedOn.value,
      method: method.value,
      events: [
        ['11/11/2026, 10:00', 'Registrado por Vendedor Silmer nesta simulação'],
      ],
    });
    resultFocusId = id;
    notice.value =
      'Recebimento registrado na simulação. O resumo foi atualizado.';
  } else if (mode.value === 'issue') {
    entries.value.unshift(waiting(balance.value));
    resultFocusId = 'balance';
    notice.value =
      'Link gerado e envio simulado na conversa vinculada ao pedido.';
  } else if (mode.value === 'reverse') {
    if (!reason.value.trim()) {
      formError.value = 'Informe o motivo do estorno do registro.';
      return;
    }
    selected.value.reversed = true;
    resultFocusId = selected.value.id;
    selected.value.events.push([
      '11/11/2026, 10:00',
      `Registro estornado por Vendedor Silmer. Motivo: ${reason.value.trim()}`,
    ]);
    notice.value =
      'Registro estornado na simulação. Nenhum dinheiro foi devolvido.';
  } else {
    notice.value =
      mode.value === 'refund'
        ? 'Prévia da conciliação de devolução. Nesta avaliação, o lançamento foi preservado.'
        : 'Conferência simulada: resultado ainda não confirmado. O saldo foi preservado.';
  }
  close();
}
onBeforeUnmount(close);
</script>

<template>
  <section
    id="cobrancas"
    ref="sectionRoot"
    class="op-sheet simplified-billing"
    aria-labelledby="order-billing-title"
  >
    <OrderSheetHead
      title-id="order-billing-title"
      title="Cobranças"
      :state="status"
      :tone="balance === 0 ? 'ok' : 'neutral'"
      section="billing"
      body-id="simple-billing-body"
    />
    <div id="simple-billing-body" class="op-sheet-body" :hidden="!expanded">
      <div class="simple-preview-controls">
        <p class="op-hint">
          Prévia interativa com dados fictícios. As ações são simuladas.
        </p>
        <div class="simple-scenario">
          <label for="simple-scenario">Cenário</label>
          <select id="simple-scenario" v-model="scenario" @change="reset">
            <option value="paid">Pedido quitado</option>
            <option value="partial">Saldo a cobrar</option>
            <option value="waiting">Link aguardando pagamento</option>
            <option value="review">Cobrança em conferência</option>
            <option value="empty">Sem lançamentos</option>
          </select>
        </div>
      </div>
      <dl class="simple-totals" aria-label="Valores do pedido">
        <div>
          <dt>Total do pedido</dt>
          <dd>{{ money(total) }}</dd>
        </div>
        <div>
          <dt>Recebido</dt>
          <dd>{{ money(received) }}</dd>
        </div>
        <div>
          <dt>Falta receber</dt>
          <dd :class="{ 'simple-settled': balance === 0 }">
            {{ money(balance) }}
          </dd>
        </div>
      </dl>
      <div v-if="needsReview" class="simple-alert" role="alert">
        <OrderIcon name="alert" />
        <div>
          <strong>Confira o link antes de cobrar novamente</strong>
          <p>
            O link de {{ money(pending.amount) }} supera o saldo de
            {{ money(balance) }}. Não envie esse link ao cliente. O registro
            manual não cancela o link na InfinitePay.
          </p>
        </div>
      </div>
      <div v-if="balance > 0 && !needsReview" class="simple-actions">
        <button
          v-if="!pending"
          type="button"
          class="primary"
          @click="show('issue', $event)"
        >
          Cobrar {{ received ? 'saldo de ' : '' }}{{ money(balance) }}
        </button>
        <button type="button" @click="show('external', $event)">
          Registrar recebimento
        </button>
      </div>
      <p v-if="notice" class="simple-notice" role="status">{{ notice }}</p>
      <section class="simple-records" aria-labelledby="simple-records-title">
        <h3 id="simple-records-title">
          Cobranças e recebimentos <span>{{ entries.length }}</span>
        </h3>
        <p v-if="!entries.length" class="simple-empty">
          Nenhuma cobrança ou recebimento registrado. Gere uma cobrança ou
          registre um valor já recebido.
        </p>
        <ol v-else class="simple-list" :key="scenario">
          <li v-for="entry in entries" :key="entry.id">
            <details
              class="simple-entry"
              :data-attention="!entry.paid || undefined"
              :open="!entry.paid"
            >
              <summary :data-entry-id="entry.id">
                <span class="simple-entry-icon"
                  ><OrderIcon
                    :name="
                      entry.reversed ? 'swap' : entry.paid ? 'check' : 'clock'
                    "
                /></span>
                <span class="simple-entry-info"
                  ><strong>{{ entry.title }}</strong
                  ><span
                    >{{ entry.source }} · {{ entry.method }} ·
                    {{ day(entry.date) }}</span
                  ></span
                >
                <span class="simple-entry-value"
                  ><strong>{{ money(entry.amount) }}</strong
                  ><span
                    class="simple-status"
                    :data-tone="
                      entry.reversed ? 'neutral' : entry.paid ? 'ok' : 'pending'
                    "
                    >{{ entryStatus(entry) }}</span
                  ></span
                >
                <span class="simple-details-label"
                  >Detalhes <OrderIcon name="chevron"
                /></span>
              </summary>
              <div class="simple-entry-body">
                <p v-if="entry.reversed" class="op-hint">
                  O original foi preservado e não compõe o valor recebido.
                </p>
                <template v-else-if="!entry.paid">
                  <p class="op-hint">
                    {{
                      needsReview
                        ? 'Link anterior disponível apenas para conferência.'
                        : 'Link válido até 18/11/2026. O cliente escolhe Pix ou cartão.'
                    }}
                  </p>
                  <div class="simple-actions">
                    <template v-if="!needsReview">
                      <button
                        type="button"
                        @click="notice = 'Link fictício copiado na simulação.'"
                      >
                        <OrderIcon name="copy" /> Copiar link
                      </button>
                      <button
                        type="button"
                        @click="show('link', $event, entry)"
                      >
                        Abrir cobrança
                      </button>
                    </template>
                    <button type="button" @click="show('check', $event, entry)">
                      Conferir pagamento
                    </button>
                  </div>
                </template>
                <div v-else class="simple-actions">
                  <template v-if="entry.source === 'InfinitePay'">
                    <button
                      type="button"
                      @click="show('receipt', $event, entry)"
                    >
                      Ver comprovante
                    </button>
                    <button
                      type="button"
                      class="quiet"
                      @click="show('refund', $event, entry)"
                    >
                      Registrar devolução
                    </button>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="quiet"
                    @click="show('reverse', $event, entry)"
                  >
                    Estornar registro
                  </button>
                </div>
                <h4>Movimentações desta operação</h4>
                <ol class="simple-events">
                  <li v-for="(event, index) in entry.events" :key="index">
                    <span>{{ event[0] }}</span
                    ><span>{{ event[1] }}</span>
                  </li>
                </ol>
              </div>
            </details>
          </li>
        </ol>
      </section>
    </div>
    <Teleport to="body">
      <dialog
        v-if="mode"
        ref="dialog"
        class="op-dialog simple-dialog"
        aria-labelledby="simple-dialog-title"
        @close="afterClose"
      >
        <form @submit.prevent="confirm">
          <h2 id="simple-dialog-title">{{ title }}</h2>
          <p class="op-hint">Simulação do protótipo · nenhum efeito real.</p>
          <template v-if="mode === 'external'">
            <div class="op-field">
              <label for="simple-amount">Valor recebido (R$)</label
              ><input id="simple-amount" v-model="amount" inputmode="decimal" />
            </div>
            <div class="op-field">
              <label for="simple-date">Recebido em</label
              ><input id="simple-date" v-model="receivedOn" type="date" />
            </div>
            <div class="op-field">
              <label for="simple-method">Forma de recebimento</label
              ><select id="simple-method" v-model="method">
                <option>Pix fora da InfinitePay</option>
                <option>Transferência bancária</option>
                <option>Dinheiro</option>
                <option>Cartão em outra maquininha</option>
              </select>
            </div>
          </template>
          <template v-else-if="mode === 'issue'"
            ><p>
              Cobrar o saldo de <strong>{{ money(balance) }}</strong> via
              InfinitePay e enviar o link na conversa vinculada ao pedido.
            </p>
            <p class="op-hint">
              Pix ou cartão. Gerar um link não confirma o pagamento.
            </p></template
          >
          <template v-else-if="mode === 'reverse'"
            ><p>
              Estornar o registro manual de
              <strong>{{ money(selected.amount) }}</strong
              >? O saldo será atualizado. Esta ação não devolve dinheiro.
            </p>
            <div class="op-field">
              <label for="simple-reason">Motivo</label
              ><textarea id="simple-reason" v-model="reason" rows="3" /></div
          ></template>
          <template v-else-if="mode === 'receipt'"
            ><p>
              <strong>{{ money(selected.amount) }} · Pix</strong>
            </p>
            <p>
              Pagamento confirmado no CRM em {{ day(selected.date) }}.
              Comprovante ilustrativo da operação selecionada.
            </p></template
          >
          <template v-else-if="mode === 'link'"
            ><p>
              Prévia do checkout de <strong>{{ money(selected.amount) }}</strong
              >.
            </p>
            <p class="op-hint">
              O pagamento seria aberto na InfinitePay. Este exemplo não contém
              link real.
            </p></template
          >
          <template v-else-if="mode === 'refund'"
            ><p>
              A devolução deve ser feita primeiro na InfinitePay. Depois, sua
              conciliação fica vinculada a este recebimento e preserva o
              registro original.
            </p></template
          >
          <template v-else
            ><p>
              Conferir o pagamento de
              <strong>{{ money(selected.amount) }}</strong> na InfinitePay.
              Enquanto o resultado não for confirmado, o saldo continua o mesmo.
            </p></template
          >
          <p v-if="formError" class="op-field-error" role="alert">
            {{ formError }}
          </p>
          <div class="simple-actions simple-dialog-actions">
            <button type="button" @click="close">
              {{
                ['receipt', 'link', 'refund'].includes(mode)
                  ? 'Fechar'
                  : 'Cancelar'
              }}</button
            ><button
              v-if="!['receipt', 'link', 'refund'].includes(mode)"
              class="primary"
              type="submit"
            >
              {{
                mode === 'issue'
                  ? 'Gerar e enviar cobrança'
                  : mode === 'external'
                    ? 'Confirmar recebimento'
                    : mode === 'reverse'
                      ? 'Confirmar estorno'
                      : 'Conferir pagamento'
              }}
            </button>
          </div>
        </form>
      </dialog>
    </Teleport>
  </section>
</template>

<style scoped>
.simple-preview-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.simple-preview-controls p {
  margin: 0;
  max-width: 44ch;
}
.simple-scenario {
  display: grid;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.simple-preview-controls select {
  min-height: 44px;
  max-width: 100%;
  color: var(--color-text);
}
.simple-totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding-block: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.simple-totals dt {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.simple-totals dd {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.simple-settled {
  color: var(--status-success-text);
}
.simple-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block: var(--space-4);
}
.simple-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 44px;
}
.simple-alert {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin-top: var(--space-4);
  padding: var(--space-3);
  background: var(--status-warning-surface);
  color: var(--status-warning-text);
  border-radius: var(--radius-md);
}
.simple-alert .op-icon {
  flex-shrink: 0;
}
.simple-alert p {
  margin: var(--space-2) 0 0;
  max-width: 80ch;
}
.simple-notice {
  padding-block: var(--space-3);
  color: var(--status-info-text);
}
.simple-records {
  margin-top: var(--space-5);
}
.simple-records h3 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
}
.simple-records h3 > span {
  color: var(--color-text-muted);
  font-weight: 400;
}
.simple-list,
.simple-events {
  list-style: none;
  padding: 0;
  margin: 0;
}
.simple-entry {
  border-block-start: 1px solid var(--color-border-subtle);
}
.simple-list > li:last-child {
  border-block-end: 1px solid var(--color-border-subtle);
}
.simple-entry > summary {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-3);
  padding-block: var(--space-4);
  cursor: pointer;
  list-style: none;
}
.simple-entry > summary::-webkit-details-marker {
  display: none;
}
.simple-entry > summary:hover {
  background: var(--color-surface-muted);
}
.simple-entry > summary:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 3px;
}
.simple-entry-icon {
  color: var(--status-success-text);
}
.simple-entry[data-attention] .simple-entry-icon {
  color: var(--status-warning-text);
}
.simple-entry-info,
.simple-entry-value {
  display: grid;
  gap: var(--space-1);
}
.simple-entry-info > span {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
.simple-entry-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.simple-status {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.simple-status[data-tone='ok'] {
  color: var(--status-success-text);
}
.simple-status[data-tone='pending'] {
  color: var(--status-warning-text);
}
.simple-details-label {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-inline-start: var(--space-4);
  color: var(--color-link);
  font-size: var(--text-sm);
}
.simple-details-label .op-icon {
  width: 16px;
  height: 16px;
}
.simple-entry[open] .simple-details-label .op-icon {
  transform: rotate(180deg);
}
.simple-entry-body {
  padding: 0 0 var(--space-4) 40px;
}
.simple-entry-body h4 {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--color-text-muted);
}
.simple-entry-body .simple-actions {
  margin-top: 0;
}
.simple-events {
  display: grid;
  gap: var(--space-2);
}
.simple-events li {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--space-4);
  row-gap: var(--space-1);
  font-size: var(--text-xs);
}
.simple-events li > span:first-child {
  color: var(--color-text-muted);
  min-width: 135px;
}
.simple-empty {
  max-width: 65ch;
  padding-block: var(--space-4);
  color: var(--color-text-muted);
}
.simple-dialog {
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
}
.simple-dialog .op-field {
  margin-block: var(--space-3);
}
.simple-dialog-actions {
  justify-content: flex-end;
  margin-bottom: 0;
}
@media (max-width: 600px) {
  .simple-preview-controls {
    align-items: stretch;
    flex-direction: column;
  }
  .simple-totals {
    gap: var(--space-2);
  }
  .simple-totals dt {
    font-size: var(--text-xs);
  }
  .simple-totals dd {
    font-size: var(--text-base);
  }
  .simple-entry > summary {
    grid-template-columns: 20px minmax(0, 1fr) auto;
    gap: var(--space-2);
  }
  .simple-entry-value {
    grid-column: 2;
    text-align: left;
    display: grid;
    align-items: center;
    gap: var(--space-2);
  }
  .simple-details-label {
    grid-column: 3;
    grid-row: 2;
    margin: 0;
    font-size: var(--text-xs);
  }
  .simple-entry-body {
    padding-inline-start: 28px;
  }
  .simple-entry-info {
    grid-column: 2 / -1;
  }
}
@media (max-width: 380px) {
  .simple-totals {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .simple-totals > div:first-child {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
  }
}
</style>
