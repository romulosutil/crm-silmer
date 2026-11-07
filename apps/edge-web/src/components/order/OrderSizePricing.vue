<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { AUDIENCE_OPTIONS, itemHeading } from '../../lib/order-format.js';
import {
  parseSubtotal,
  reviewedTotal,
  subtotalLabel,
} from '../../lib/order-money.js';

const props = defineProps({ order: { type: Object, required: true } });
const editing = inject('orderEditing');
const emit = defineEmits(['done']);
const active = ref(null);
const busy = ref(false);
const error = ref('');
const blocked = ref(false);
const result = ref('');
const feedback = ref(null);
const editor = ref(null);
const title = ref(null);
let opener = null;
const groups = computed(() => props.order.ficha.sizePricing ?? []);
const total = computed(() => reviewedTotal(groups.value));
const canOperate = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
const fields = [
  { key: 'tipo', label: 'Tipo de roupa' },
  { key: 'cor', label: 'Cor' },
  { key: 'tipo_servico', label: 'Técnica' },
  { key: 'gola', label: 'Gola' },
  { key: 'modelo', label: 'Modelo (opcional)' },
  { key: 'estampa', label: 'Estampa (referência)' },
  { key: 'cor_frente', label: 'Cor do tecido — frente' },
  { key: 'cor_costas', label: 'Cor do tecido — costas' },
  { key: 'cor_manga_direita', label: 'Cor do tecido — manga direita' },
  { key: 'cor_manga_esquerda', label: 'Cor do tecido — manga esquerda' },
  { key: 'vies_gola', label: 'Viés da gola (opcional)' },
  { key: 'vies_mangas', label: 'Viés das mangas' },
];

async function open(kind, group, line, event, index = 0) {
  if (busy.value || blocked.value || !canOperate.value) return;
  opener = event?.currentTarget;
  error.value = '';
  result.value = '';
  const item = kind === 'new-group' ? null : props.order.ficha.items[index];
  const attributes = item
    ? JSON.parse(JSON.stringify(item))
    : {
        tipo: '',
        cor: '',
        tipo_servico: '',
        gola: '',
        malhas: [''],
        grade: [],
      };
  delete attributes.grade;
  if (!attributes.malhas?.length) attributes.malhas = [''];
  active.value = {
    kind,
    groupId: group?.id,
    lineId: line?.id,
    size: line?.size ?? '',
    quantity: line?.quantity ?? 1,
    subtotal: line?.subtotalCents
      ? subtotalLabel(line.subtotalCents).slice(3)
      : '',
    attributes,
  };
  await nextTick();
  editor.value?.querySelector('input, select')?.focus();
}

async function cancel() {
  active.value = null;
  error.value = '';
  await nextTick();
  if (opener?.isConnected) opener.focus();
  else title.value?.focus();
}

async function run(value, message) {
  if (busy.value || blocked.value || !canOperate.value) return;
  busy.value = true;
  error.value = '';
  result.value = '';
  const response = await editing.save('size-pricing', value);
  busy.value = false;
  if (!response.ok) {
    blocked.value = /CONFLICT|LOCKED|FORBIDDEN/u.test(response.code ?? '');
    error.value = response.message;
    await nextTick();
    feedback.value?.focus();
    return;
  }
  result.value = message;
  active.value = null;
  await nextTick();
  if (opener?.isConnected) opener.focus();
  else title.value?.focus();
}

async function submit() {
  const current = active.value;
  if (!current || busy.value) return;
  const base = { groupId: current.groupId };
  let value;
  let message;
  if (current.kind === 'subtotal') {
    const cents = parseSubtotal(current.subtotal);
    if (cents === null) {
      error.value = 'Informe um subtotal maior que zero, no formato 120,00.';
    } else {
      value = {
        ...base,
        action: 'review_subtotal',
        lineId: current.lineId,
        subtotalCents: cents,
      };
      message = 'Subtotal revisado para a quantidade atual.';
    }
  } else if (current.kind === 'quantity') {
    const quantity = Number(current.quantity);
    if (
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > 2147483647
    ) {
      error.value = 'Informe uma quantidade inteira maior que zero.';
    } else {
      value = {
        ...base,
        action: 'change_quantity',
        lineId: current.lineId,
        quantity,
      };
      message = 'Quantidade salva. Revise o subtotal desta linha.';
    }
  } else if (current.kind === 'size' || current.kind === 'line') {
    const size = String(current.size).trim();
    const quantity = Number(current.quantity);
    if (
      !size ||
      size.length > 200 ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > 2147483647
    ) {
      error.value =
        'Informe o tamanho e uma quantidade inteira maior que zero.';
    } else {
      value =
        current.kind === 'size'
          ? { ...base, action: 'rename_line', lineId: current.lineId, size }
          : { ...base, action: 'add_line', size, quantity };
      message = 'Tamanho salvo. Revise o subtotal desta linha.';
    }
  } else {
    const attributes = {
      ...current.attributes,
      malhas: current.attributes.malhas.filter(
        (value) => String(value).trim() !== '',
      ),
    };
    value =
      current.kind === 'group'
        ? { ...base, action: 'update_group', attributes }
        : { action: 'add_group', item: { ...attributes, grade: [] } };
    message =
      'Grupo salvo. Revise os subtotais após alterar suas especificações.';
  }
  if (!value) {
    await nextTick();
    feedback.value?.focus();
    return;
  }
  await run(value, message);
}

async function remove(group, line, event) {
  opener = event.currentTarget;
  await run(
    line
      ? { action: 'remove_line', groupId: group.id, lineId: line.id }
      : { action: 'remove_group', groupId: group.id },
    line ? 'Tamanho removido.' : 'Grupo removido.',
  );
}

async function duplicate(group, event) {
  opener = event.currentTarget;
  await run(
    { action: 'duplicate_group', groupId: group.id },
    'Grupo duplicado com novos identificadores. Revise os subtotais da cópia.',
  );
}

async function move(group, line, offset, event) {
  opener = event.currentTarget;
  const collection = line ? group.lines : groups.value;
  const ids = collection.map((entry) => entry.id);
  const from = ids.indexOf(line?.id ?? group.id);
  const to = from + offset;
  if (to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  await run(
    line
      ? { action: 'reorder_lines', groupId: group.id, lineIds: ids }
      : { action: 'reorder_groups', groupIds: ids },
    line ? 'Ordem dos tamanhos atualizada.' : 'Ordem dos grupos atualizada.',
  );
}
</script>

<template>
  <div class="op-sheet-body op-item-list op-price-editor">
    <h3 ref="title" tabindex="-1">Grade e subtotais por tamanho</h3>
    <p class="op-hint">
      Cada subtotal corresponde a todas as peças daquele tamanho. A quantidade e
      o total são calculados; nenhum preço unitário é aplicado.
    </p>
    <p
      v-if="error"
      id="price-command-error"
      ref="feedback"
      class="op-alert"
      role="alert"
      tabindex="-1"
    >
      {{ error }}
    </p>
    <p v-if="result" class="op-hint" role="status">{{ result }}</p>
    <p v-if="blocked" class="op-hint">
      Feche a edição e atualize o pedido antes de continuar.
    </p>
    <fieldset
      class="op-price-controls"
      :disabled="busy || blocked || !canOperate"
    >
      <legend class="op-visually-hidden">Composição do pedido</legend>
      <div v-for="(group, index) in groups" :key="group.id" class="op-item">
        <h4>{{ itemHeading(order.ficha.items[index], index) }}</h4>
        <p class="op-num">
          Subtotal do grupo:
          <strong>{{ subtotalLabel(reviewedTotal([group])) }}</strong>
        </p>
        <div v-if="!active" class="op-price-actions">
          <button
            type="button"
            @click="open('group', group, null, $event, index)"
          >
            Editar especificações do grupo {{ index + 1 }}
          </button>
          <details class="op-price-more">
            <summary>Mais ações do grupo {{ index + 1 }}</summary>
            <div class="op-price-actions">
              <button type="button" @click="duplicate(group, $event)">
                Duplicar grupo {{ index + 1 }}
              </button>
              <button
                v-if="index > 0"
                type="button"
                @click="move(group, null, -1, $event)"
              >
                Mover grupo {{ index + 1 }} para cima
              </button>
              <button
                v-if="index < groups.length - 1"
                type="button"
                @click="move(group, null, 1, $event)"
              >
                Mover grupo {{ index + 1 }} para baixo
              </button>
              <button
                type="button"
                class="danger"
                @click="remove(group, null, $event)"
              >
                Remover grupo {{ index + 1 }}
              </button>
            </div>
          </details>
        </div>
        <ul
          class="op-price-lines"
          :aria-label="`Tamanhos e subtotais do grupo ${index + 1}`"
        >
          <li v-for="(line, lineIndex) in group.lines" :key="line.id">
            <dl class="op-price-values">
              <div>
                <dt>Tamanho</dt>
                <dd>{{ line.size }}</dd>
              </div>
              <div>
                <dt>Quantidade</dt>
                <dd class="op-num">{{ line.quantity }} peças</dd>
              </div>
              <div>
                <dt>Subtotal do tamanho</dt>
                <dd class="op-num">{{ subtotalLabel(line.subtotalCents) }}</dd>
              </div>
            </dl>
            <p v-if="!line.subtotalReviewed" class="op-quantity-warning">
              {{
                line.subtotalCents === null
                  ? 'Informe o subtotal deste tamanho.'
                  : 'Revise o subtotal para a quantidade e as especificações atuais.'
              }}
            </p>
            <div v-if="!active" class="op-price-actions">
              <button
                type="button"
                :aria-label="`Editar quantidade de ${line.size}, grupo ${index + 1}`"
                @click="open('quantity', group, line, $event)"
              >
                Editar quantidade
              </button>
              <button
                type="button"
                :aria-label="`Revisar subtotal de ${line.size}, grupo ${index + 1}`"
                @click="open('subtotal', group, line, $event)"
              >
                Revisar subtotal
              </button>
              <details class="op-price-more">
                <summary>
                  Mais ações do tamanho {{ line.size }}, grupo {{ index + 1 }}
                </summary>
                <div class="op-price-actions">
                  <button
                    v-if="lineIndex > 0"
                    type="button"
                    :aria-label="`Mover tamanho ${line.size} para cima, grupo ${index + 1}`"
                    @click="move(group, line, -1, $event)"
                  >
                    Mover para cima
                  </button>
                  <button
                    v-if="lineIndex < group.lines.length - 1"
                    type="button"
                    :aria-label="`Mover tamanho ${line.size} para baixo, grupo ${index + 1}`"
                    @click="move(group, line, 1, $event)"
                  >
                    Mover para baixo
                  </button>
                  <button
                    type="button"
                    :aria-label="`Editar tamanho ${line.size}, grupo ${index + 1}`"
                    @click="open('size', group, line, $event)"
                  >
                    Editar tamanho
                  </button>
                  <button
                    type="button"
                    class="danger"
                    :aria-label="`Remover tamanho ${line.size}, grupo ${index + 1}`"
                    @click="remove(group, line, $event)"
                  >
                    Remover tamanho
                  </button>
                </div>
              </details>
            </div>
          </li>
        </ul>
        <button
          v-if="!active"
          type="button"
          @click="open('line', group, null, $event)"
        >
          Adicionar tamanho ao grupo {{ index + 1 }}
        </button>
      </div>
      <button
        v-if="!active"
        type="button"
        @click="open('new-group', null, null, $event)"
      >
        Adicionar grupo
      </button>
      <form
        v-if="active"
        ref="editor"
        class="op-form op-price-form"
        novalidate
        :aria-describedby="error ? 'price-command-error' : undefined"
        @submit.prevent="submit"
      >
        <h4>
          {{
            active.kind === 'subtotal'
              ? 'Revisar subtotal'
              : active.kind === 'quantity'
                ? 'Alterar quantidade'
                : active.kind === 'size'
                  ? 'Alterar tamanho'
                  : active.kind === 'line'
                    ? 'Adicionar tamanho'
                    : active.kind === 'group'
                      ? 'Especificações do grupo'
                      : 'Adicionar grupo'
          }}
        </h4>
        <p v-if="active.kind === 'subtotal'" class="op-hint">
          Confirme o valor de todas as {{ active.quantity }} peças do tamanho
          {{ active.size }}. Não informe o valor de uma peça.
        </p>
        <div v-if="active.kind === 'subtotal'" class="op-field">
          <label for="size-subtotal">Subtotal do tamanho (R$)</label>
          <input
            id="size-subtotal"
            v-model="active.subtotal"
            inputmode="decimal"
            type="text"
            autocomplete="off"
            maxlength="30"
            :aria-invalid="Boolean(error) || undefined"
            aria-describedby="size-subtotal-hint"
          />
          <p id="size-subtotal-hint" class="op-hint">
            Exemplo: 120,00. Confirmar registra a revisão para a quantidade
            atual.
          </p>
        </div>
        <div v-if="['size', 'line'].includes(active.kind)" class="op-field">
          <label for="price-size">Tamanho</label
          ><input
            id="price-size"
            v-model="active.size"
            type="text"
            maxlength="200"
          />
        </div>
        <div v-if="['quantity', 'line'].includes(active.kind)" class="op-field">
          <label for="price-quantity">Quantidade de peças</label
          ><input
            id="price-quantity"
            v-model="active.quantity"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
          />
          <p class="op-hint">
            Alterar a quantidade exige nova revisão do subtotal. O valor
            anterior não é reajustado.
          </p>
        </div>
        <template v-if="['group', 'new-group'].includes(active.kind)">
          <div class="op-item-fields">
            <div v-for="field in fields" :key="field.key" class="op-field">
              <label :for="`pricing-${field.key}`">{{ field.label }}</label
              ><input
                :id="`pricing-${field.key}`"
                v-model="active.attributes[field.key]"
                type="text"
              />
            </div>
            <div class="op-field">
              <label for="pricing-publico">Público</label
              ><select id="pricing-publico" v-model="active.attributes.publico">
                <option value="">Não informado</option>
                <option
                  v-for="option in AUDIENCE_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>
            <div class="op-field">
              <span class="op-label">Modelo de malha</span>
              <div v-for="(_, i) in active.attributes.malhas" :key="i">
                <label :for="`pricing-malha-${i}`"
                  >Modelo de malha {{ i + 1 }}</label
                ><input
                  :id="`pricing-malha-${i}`"
                  v-model="active.attributes.malhas[i]"
                  type="text"
                />
              </div>
              <button type="button" @click="active.attributes.malhas.push('')">
                Adicionar modelo de malha
              </button>
            </div>
          </div>
          <p class="op-hint">
            Mudar as especificações exige revisar os subtotais de todos os
            tamanhos do grupo.
          </p>
        </template>
        <div class="op-price-actions">
          <button type="button" @click="cancel">Voltar à grade</button
          ><button type="submit" class="op-save">
            {{
              busy
                ? 'Salvando…'
                : active.kind === 'subtotal'
                  ? 'Confirmar subtotal'
                  : 'Salvar alteração'
            }}
          </button>
        </div>
      </form>
    </fieldset>
    <p class="op-num">
      Total do pedido: <strong>{{ subtotalLabel(total) }}</strong>
    </p>
    <div class="op-price-actions">
      <button type="button" :disabled="busy" @click="emit('done')">
        Fechar edição de itens
      </button>
    </div>
  </div>
</template>

<style scoped>
.op-price-controls {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
  display: grid;
  gap: var(--space-4);
}
.op-price-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block: var(--space-3);
}
.op-price-more summary {
  min-block-size: var(--target-min);
  padding-block: var(--space-2);
  color: var(--color-link);
  cursor: pointer;
}
.op-price-more summary:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: var(--focus-ring-offset);
}
.op-price-lines {
  padding: 0;
  list-style: none;
}
.op-price-lines > li {
  border-block-start: 1px solid var(--color-border);
  padding-block: var(--space-3);
}
.op-price-values {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-6);
}
.op-price-values dt {
  color: var(--color-text-muted);
}
.op-price-values dd {
  margin: 0;
  font-weight: 600;
}
.op-price-values > div,
.op-price-more,
.op-price-editor h4 {
  min-width: 0;
  overflow-wrap: anywhere;
}
.op-price-form {
  display: grid;
  gap: var(--space-3);
}
.op-price-form input,
.op-price-form select {
  width: 100%;
  min-width: 0;
}
.op-price-editor h3:focus {
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: var(--focus-ring-offset);
}
</style>
