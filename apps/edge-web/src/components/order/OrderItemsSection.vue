<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { colorSwatch } from '../../lib/order-catalog.js';
import {
  itemHeading,
  itemPieces,
  itemQuantityLabel,
} from '../../lib/order-format.js';
import OrderIcon from './OrderIcon.vue';

const SECTION = 'items';
// The value the ficha prints when a garment has no sleeve or no viés (PFI-07).
const NOT_APPLICABLE = 'NAO APLICAVEL';
const NOT_APPLICABLE_LABEL = 'NÃO APLICÁVEL';
const GRADE_MESSAGE = 'Use uma quantidade inteira maior que zero.';
const EXTRAS_LABEL = 'Adicionais (não obrigatórios)';

// PIT-02 (ADR 016): what the seller may add to an item. None of it blocks
// the order. Only sleeves and viés accept "Não aplicável" (PFI-07): a shirt
// without sleeves still has a front and a back.
const EXTRA_FIELDS = Object.freeze([
  Object.freeze({ key: 'modelo', label: 'Modelo' }),
  Object.freeze({ color: true, key: 'cor_frente', label: 'Cor frente' }),
  Object.freeze({ color: true, key: 'cor_costas', label: 'Cor costas' }),
  Object.freeze({
    color: true,
    key: 'cor_manga_direita',
    label: 'Manga direita',
    optional: true,
  }),
  Object.freeze({
    color: true,
    key: 'cor_manga_esquerda',
    label: 'Manga esquerda',
    optional: true,
  }),
  Object.freeze({
    color: true,
    key: 'vies_gola',
    label: 'Viés gola',
    optional: true,
  }),
  Object.freeze({
    color: true,
    key: 'vies_mangas',
    label: 'Viés mangas',
    optional: true,
  }),
]);

const props = defineProps({
  order: { type: Object, required: true },
});

const editing = inject('orderEditing');
const form = ref(null);
const draft = ref([]);
const saving = ref(false);
const errorMessage = ref('');
/** @type {import('vue').Ref<Record<string, string>>} */
const lineErrors = ref({});
/** Which "Adicionais" blocks are open, by `read-N` or `edit-N`. */
/** @type {import('vue').Ref<Record<string, boolean>>} */
const extrasOpen = ref({});

const isEditing = computed(() => editing.editingSection.value === SECTION);
const canEdit = computed(
  () => editing.canEdit.value && props.order.status === 'pendente',
);
const otherSectionOpen = computed(
  () => editing.editingSection.value !== '' && !isEditing.value,
);
const items = computed(() =>
  isEditing.value ? draft.value : shownItems.value,
);
const shownItems = computed(() => props.order.ficha.items);
// PFI-04: every total is summed from the sizes, in reading and while
// editing, so the seller sees the number the server will store before saving.
const draftTotal = computed(() =>
  items.value.reduce((total, item) => total + itemPieces(item), 0),
);
const headline = computed(() => {
  const count = items.value.length;
  return `${count} ${count === 1 ? 'item' : 'itens'} · ${draftTotal.value} peças`;
});

/** @param {unknown} value */
function shownValue(value) {
  if (value === NOT_APPLICABLE) return NOT_APPLICABLE_LABEL;
  return value || '—';
}

/**
 * The colour chip beside a part, when the text names a catalog colour.
 *
 * @param {unknown} value
 */
function swatchOf(value) {
  if (value === NOT_APPLICABLE) return '';
  return colorSwatch(value);
}

/** @param {string} mode @param {number} index */
function extrasKey(mode, index) {
  return `${mode}-${index}`;
}

/**
 * PIT-02: a native button toggles the block, so Enter and Space work and the
 * focus stays on it; `aria-expanded` tells a screen reader the new state.
 *
 * @param {string} mode @param {number} index
 */
function toggleExtras(mode, index) {
  const key = extrasKey(mode, index);
  extrasOpen.value = { ...extrasOpen.value, [key]: !extrasOpen.value[key] };
}

/** @param {string} mode @param {number} index */
function isExtrasOpen(mode, index) {
  return Boolean(extrasOpen.value[extrasKey(mode, index)]);
}

/**
 * The extras someone filled, so a closed block still says it holds data.
 *
 * @param {Record<string, any>} item
 */
function filledExtras(item) {
  return EXTRA_FIELDS.filter((field) => String(item[field.key] ?? '') !== '')
    .length;
}

/**
 * The stepper beside the quantity moves a whole piece at a time and stops at
 * one, since the size rule refuses zero anyway.
 *
 * @param {Record<string, any>} line @param {number} delta
 */
function step(line, delta) {
  const current = Number.parseInt(String(line.quantidade), 10) || 0;
  line.quantidade = Math.max(1, current + delta);
}

/** @param {Record<string, any>} item @param {string} key */
function isNotApplicable(item, key) {
  return item[key] === NOT_APPLICABLE;
}

/**
 * Unchecking restores what was typed before, because an unchecked box means
 * "there is a colour here", not "erase it".
 *
 * @param {Record<string, any>} item @param {string} key @param {boolean} checked
 */
function toggleNotApplicable(item, key, checked) {
  if (checked) {
    item[`${key}_previous`] = item[key];
    item[key] = NOT_APPLICABLE;
    return;
  }
  item[key] = item[`${key}_previous`] ?? '';
}

/**
 * A ficha saved before ADR 016 has no colour, artwork or collar; the form
 * starts them blank, and an item with no fabric still offers one line.
 *
 * @param {Record<string, any>} item
 */
function editable(item) {
  return {
    ...blankItem(),
    ...item,
    malhas: item.malhas?.length ? [...item.malhas] : [''],
  };
}

function blankItem() {
  return {
    cor: '',
    cor_costas: '',
    cor_frente: '',
    cor_manga_direita: '',
    cor_manga_esquerda: '',
    estampa: '',
    gola: '',
    grade: [],
    malhas: [''],
    modelo: '',
    tipo: '',
    vies_gola: '',
    vies_mangas: '',
  };
}

async function startEditing() {
  // structuredClone refuses a reactive proxy (DataCloneError); the ficha is
  // plain JSON data, so a JSON round trip is the copy that works here.
  draft.value = JSON.parse(JSON.stringify(props.order.ficha.items)).map(
    editable,
  );
  lineErrors.value = {};
  errorMessage.value = '';
  extrasOpen.value = {};
  editing.start(SECTION);
  await nextTick();
  // The first field lives inside a v-for; a ref on a repeated element would
  // be a list, so the form itself is asked for its first input.
  form.value?.querySelector('input')?.focus();
}

function cancel() {
  errorMessage.value = '';
  lineErrors.value = {};
  editing.stop();
}

function addItem() {
  draft.value.push(blankItem());
}

/** @param {number} index */
function removeItem(index) {
  draft.value.splice(index, 1);
}

/** @param {Record<string, any>} item */
function addMalha(item) {
  item.malhas.push('');
}

/** @param {Record<string, any>} item @param {number} index */
function removeMalha(item, index) {
  item.malhas.splice(index, 1);
}

/** @param {Record<string, any>} item */
function addGradeLine(item) {
  item.grade.push({ quantidade: 1, tamanho: '' });
}

/** @param {Record<string, any>} item @param {number} index */
function removeGradeLine(item, index) {
  item.grade.splice(index, 1);
}

/**
 * The sizes are checked here before the request so the error lands on the
 * line the seller is looking at; the server checks them again and answers
 * 422 INVALID_GRADE with the same index. Everything else may stay blank
 * (PIT-03): the order says what is missing when it is generated.
 */
function validate() {
  /** @type {Record<string, string>} */
  const errors = {};
  draft.value.forEach((item, itemIndex) => {
    item.grade.forEach(
      /** @param {Record<string, any>} line @param {number} index */
      (line, index) => {
        const quantity = Number(line.quantidade);
        if (
          !Number.isSafeInteger(quantity) ||
          quantity <= 0 ||
          String(line.tamanho).trim() === ''
        ) {
          errors[`${itemIndex}:${index}`] = GRADE_MESSAGE;
        }
      },
    );
  });
  lineErrors.value = errors;
  return Object.keys(errors).length === 0;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  errorMessage.value = '';
  const result = await editing.save(
    SECTION,
    draft.value.map((item) => ({
      cor: item.cor,
      cor_costas: item.cor_costas,
      cor_frente: item.cor_frente,
      cor_manga_direita: item.cor_manga_direita,
      cor_manga_esquerda: item.cor_manga_esquerda,
      estampa: item.estampa,
      gola: item.gola,
      grade: item.grade.map(
        /** @param {Record<string, any>} line */
        (line) => ({
          quantidade: Number(line.quantidade),
          tamanho: String(line.tamanho).trim(),
        }),
      ),
      malhas: item.malhas.filter(
        /** @param {string} malha */
        (malha) => String(malha).trim() !== '',
      ),
      modelo: item.modelo,
      tipo: item.tipo,
      vies_gola: item.vies_gola,
      vies_mangas: item.vies_mangas,
    })),
  );
  saving.value = false;
  if (result.ok) {
    editing.stop();
    return;
  }
  if (result.code === 'INVALID_GRADE') {
    const target = String(result.fields?.[0] ?? '');
    const match = /^items\[(\d+)\]\.grade\[(\d+)\]$/u.exec(target);
    lineErrors.value = match
      ? { [`${match[1]}:${match[2]}`]: GRADE_MESSAGE }
      : { '0:0': GRADE_MESSAGE };
    return;
  }
  errorMessage.value = result.message;
}
</script>

<template>
  <section
    class="op-sheet"
    :data-editing="isEditing || undefined"
    aria-labelledby="order-items-title"
  >
    <div class="op-sheet-head">
      <h2 id="order-items-title">Itens e especificações</h2>
      <p class="op-num">{{ headline }}</p>
      <span v-if="isEditing" class="op-editing-tag">Editando</span>
      <button
        v-if="canEdit && !isEditing"
        type="button"
        class="op-edit"
        :disabled="otherSectionOpen"
        @click="startEditing"
      >
        <OrderIcon name="pencil" />Editar
      </button>
    </div>

    <p v-if="errorMessage" role="alert" class="op-alert">
      {{ errorMessage }}
    </p>

    <!-- novalidate: the browser would block the submit on its own and show
         its own message; the error belongs on the size line, in Portuguese. -->
    <form
      v-if="isEditing"
      ref="form"
      class="op-form"
      novalidate
      @submit.prevent="save"
    >
      <div class="op-sheet-body op-item-list">
        <fieldset
          v-for="(item, itemIndex) in draft"
          :key="itemIndex"
          class="op-item op-item-edit"
        >
          <legend class="op-visually-hidden">Item {{ itemIndex + 1 }}</legend>
          <div class="op-item-head">
            <p class="op-item-heading" aria-hidden="true">
              {{ itemHeading(item, itemIndex) }}
            </p>
            <button
              v-if="draft.length > 1"
              type="button"
              class="op-icon-button op-icon-button--danger"
              @click="removeItem(itemIndex)"
            >
              <OrderIcon name="trash" />
              <span class="op-visually-hidden">{{
                `Remover item ${itemIndex + 1}`
              }}</span>
            </button>
          </div>

          <!-- PIT-01: the seven points in the bot's order. -->
          <div class="op-item-fields">
            <div class="op-field">
              <label :for="`item-${itemIndex}-tipo`">Tipo de roupa</label>
              <input
                :id="`item-${itemIndex}-tipo`"
                v-model="item.tipo"
                type="text"
                autocomplete="off"
                autocapitalize="characters"
              />
            </div>

            <div class="op-field">
              <label :for="`item-${itemIndex}-cor`">Cor</label>
              <div class="op-input-swatch">
                <span
                  v-if="swatchOf(item.cor)"
                  class="op-swatch"
                  :style="{ background: swatchOf(item.cor) }"
                  aria-hidden="true"
                ></span>
                <input
                  :id="`item-${itemIndex}-cor`"
                  v-model="item.cor"
                  type="text"
                  autocomplete="off"
                  autocapitalize="characters"
                />
              </div>
            </div>

            <div class="op-field">
              <span :id="`item-${itemIndex}-quantidade`" class="op-label"
                >Quantidade</span
              >
              <output
                class="op-quantity op-num"
                :aria-labelledby="`item-${itemIndex}-quantidade`"
                >{{ itemPieces(item) }} peças</output
              >
              <p class="op-hint">Soma dos tamanhos.</p>
            </div>

            <div class="op-field op-field--wide">
              <label :for="`item-${itemIndex}-estampa`">Estampa</label>
              <input
                :id="`item-${itemIndex}-estampa`"
                v-model="item.estampa"
                type="text"
                autocomplete="off"
              />
            </div>

            <div class="op-field op-field--wide">
              <span class="op-label">Tecido</span>
              <div
                v-for="(malha, malhaIndex) in item.malhas"
                :key="malhaIndex"
                class="op-input-row"
              >
                <input
                  v-model="item.malhas[malhaIndex]"
                  type="text"
                  autocomplete="off"
                  autocapitalize="characters"
                  :aria-label="`Tecido ${malhaIndex + 1}`"
                />
                <button
                  v-if="item.malhas.length > 1"
                  type="button"
                  class="op-icon-button"
                  @click="removeMalha(item, malhaIndex)"
                >
                  <OrderIcon name="x" />
                  <span class="op-visually-hidden">{{
                    `Remover tecido ${malhaIndex + 1}`
                  }}</span>
                </button>
              </div>
              <button
                type="button"
                class="op-add-inline"
                @click="addMalha(item)"
              >
                <OrderIcon name="plus" />Adicionar tecido
              </button>
            </div>

            <div class="op-grade-editor op-field--wide">
              <div class="op-grade-editor-head">
                <span class="op-label">Tamanhos</span>
                <span class="op-num"
                  >Total do item
                  <strong>{{ itemPieces(item) }} peças</strong></span
                >
              </div>
              <div v-if="item.grade.length" class="op-grade-lines">
                <div
                  v-for="(line, lineIndex) in item.grade"
                  :key="lineIndex"
                  class="op-grade-cell"
                >
                  <div
                    class="op-grade-line"
                    :data-invalid="
                      Boolean(lineErrors[`${itemIndex}:${lineIndex}`]) ||
                      undefined
                    "
                  >
                    <input
                      v-model="line.tamanho"
                      class="op-grade-size"
                      type="text"
                      autocomplete="off"
                      autocapitalize="characters"
                      :aria-label="`Tamanho da linha ${lineIndex + 1}`"
                      :aria-invalid="
                        (Boolean(lineErrors[`${itemIndex}:${lineIndex}`]) &&
                          String(line.tamanho).trim() === '') ||
                        undefined
                      "
                      :aria-describedby="
                        lineErrors[`${itemIndex}:${lineIndex}`]
                          ? `grade-error-${itemIndex}-${lineIndex}`
                          : undefined
                      "
                    />
                    <button
                      type="button"
                      class="op-icon-button"
                      @click="step(line, -1)"
                    >
                      <OrderIcon name="minus" />
                      <span class="op-visually-hidden">{{
                        `Uma peça a menos na linha ${lineIndex + 1}`
                      }}</span>
                    </button>
                    <input
                      v-model="line.quantidade"
                      class="op-grade-qty op-num"
                      type="number"
                      min="1"
                      step="1"
                      inputmode="numeric"
                      :aria-invalid="
                        Boolean(lineErrors[`${itemIndex}:${lineIndex}`]) ||
                        undefined
                      "
                      :aria-describedby="
                        lineErrors[`${itemIndex}:${lineIndex}`]
                          ? `grade-error-${itemIndex}-${lineIndex}`
                          : undefined
                      "
                      :aria-label="
                        line.tamanho
                          ? `Quantidade do tamanho ${line.tamanho}`
                          : `Quantidade da linha ${lineIndex + 1}`
                      "
                    />
                    <button
                      type="button"
                      class="op-icon-button"
                      @click="step(line, 1)"
                    >
                      <OrderIcon name="plus" />
                      <span class="op-visually-hidden">{{
                        `Uma peça a mais na linha ${lineIndex + 1}`
                      }}</span>
                    </button>
                    <button
                      type="button"
                      class="op-icon-button op-icon-button--quiet"
                      @click="removeGradeLine(item, lineIndex)"
                    >
                      <OrderIcon name="x" />
                      <span class="op-visually-hidden">{{
                        `Remover linha ${lineIndex + 1}`
                      }}</span>
                    </button>
                  </div>
                  <p
                    v-if="lineErrors[`${itemIndex}:${lineIndex}`]"
                    :id="`grade-error-${itemIndex}-${lineIndex}`"
                    role="alert"
                    class="op-field-error"
                  >
                    {{ lineErrors[`${itemIndex}:${lineIndex}`] }}
                  </p>
                </div>
              </div>
              <p v-else class="op-hint">Nenhum tamanho ainda.</p>
              <button
                type="button"
                class="op-add-inline"
                @click="addGradeLine(item)"
              >
                <OrderIcon name="plus" />Adicionar tamanho
              </button>
            </div>

            <div class="op-field">
              <label :for="`item-${itemIndex}-gola`">Gola</label>
              <input
                :id="`item-${itemIndex}-gola`"
                v-model="item.gola"
                type="text"
                autocomplete="off"
                autocapitalize="characters"
              />
            </div>
          </div>

          <div class="op-extras">
            <button
              type="button"
              class="op-extras-toggle"
              :aria-expanded="isExtrasOpen('edit', itemIndex)"
              :aria-controls="`item-edit-${itemIndex}-extras`"
              @click="toggleExtras('edit', itemIndex)"
            >
              {{ EXTRAS_LABEL }}
              <OrderIcon name="chevron" />
            </button>
            <div
              :id="`item-edit-${itemIndex}-extras`"
              class="op-item-fields op-extras-body"
              :hidden="!isExtrasOpen('edit', itemIndex)"
            >
              <div
                v-for="field in EXTRA_FIELDS"
                :key="field.key"
                class="op-field"
              >
                <label :for="`item-${itemIndex}-${field.key}`">{{
                  field.label
                }}</label>
                <div class="op-input-swatch">
                  <span
                    v-if="field.color && swatchOf(item[field.key])"
                    class="op-swatch"
                    :style="{ background: swatchOf(item[field.key]) }"
                    aria-hidden="true"
                  ></span>
                  <input
                    :id="`item-${itemIndex}-${field.key}`"
                    :value="
                      isNotApplicable(item, field.key)
                        ? NOT_APPLICABLE_LABEL
                        : item[field.key]
                    "
                    type="text"
                    autocomplete="off"
                    autocapitalize="characters"
                    :disabled="isNotApplicable(item, field.key)"
                    @input="item[field.key] = $event.target.value"
                  />
                </div>
                <label v-if="field.optional" class="op-check">
                  <input
                    type="checkbox"
                    :checked="isNotApplicable(item, field.key)"
                    :aria-label="`${field.label} não se aplica`"
                    @change="
                      toggleNotApplicable(
                        item,
                        field.key,
                        $event.target.checked,
                      )
                    "
                  />
                  <span aria-hidden="true">Não aplicável</span>
                </label>
              </div>
            </div>
          </div>
        </fieldset>

        <button type="button" class="op-add-item" @click="addItem">
          <OrderIcon name="plus" />Adicionar item
        </button>
      </div>

      <div class="op-form-actions">
        <p class="op-num">
          Total do pedido: <strong>{{ draftTotal }} peças</strong>, somado dos
          tamanhos.
        </p>
        <button type="button" :disabled="saving" @click="cancel">
          Cancelar
        </button>
        <!-- PFI-13: "Gerar pedido" is the only primary button here. -->
        <button type="submit" class="op-save" :disabled="saving">
          {{ saving ? 'Salvando…' : 'Salvar itens' }}
        </button>
      </div>
    </form>

    <div v-else class="op-sheet-body op-item-list">
      <div
        v-for="(item, itemIndex) in shownItems"
        :key="itemIndex"
        class="op-item"
        role="group"
        :aria-labelledby="`item-${itemIndex}-title`"
      >
        <div class="op-item-head">
          <h3 :id="`item-${itemIndex}-title`" class="op-item-heading">
            {{ itemHeading(item, itemIndex) }}
          </h3>
        </div>
        <!-- PIT-01: the seven points in the bot's order. -->
        <dl class="op-points">
          <div>
            <dt>Tipo de roupa</dt>
            <dd>{{ shownValue(item.tipo) }}</dd>
          </div>
          <div>
            <dt>Cor</dt>
            <dd>
              <span
                v-if="swatchOf(item.cor)"
                class="op-swatch"
                :style="{ background: swatchOf(item.cor) }"
                aria-hidden="true"
              ></span>
              {{ shownValue(item.cor) }}
            </dd>
          </div>
          <div>
            <dt>Quantidade</dt>
            <dd class="op-num">
              {{ itemQuantityLabel(item, itemIndex, order) }}
            </dd>
          </div>
          <div class="op-point--wide">
            <dt>Estampa</dt>
            <dd>{{ shownValue(item.estampa) }}</dd>
          </div>
          <div>
            <dt>Tecido</dt>
            <dd>{{ (item.malhas ?? []).join(' / ') || '—' }}</dd>
          </div>
          <div class="op-point--wide">
            <dt>Tamanhos</dt>
            <dd>
              <ul v-if="item.grade.length" class="op-grade-tiles">
                <li v-for="(line, lineIndex) in item.grade" :key="lineIndex">
                  <span>{{ line.tamanho }}</span
                  ><strong class="op-num">{{ line.quantidade }}</strong>
                </li>
              </ul>
              <template v-else>—</template>
            </dd>
          </div>
          <div>
            <dt>Gola</dt>
            <dd>{{ shownValue(item.gola) }}</dd>
          </div>
        </dl>
        <div class="op-extras">
          <button
            type="button"
            class="op-extras-toggle"
            :aria-expanded="isExtrasOpen('read', itemIndex)"
            :aria-controls="`item-${itemIndex}-extras`"
            @click="toggleExtras('read', itemIndex)"
          >
            {{ EXTRAS_LABEL }}
            <span v-if="filledExtras(item)" class="op-quiet-tag op-num">{{
              filledExtras(item)
            }}</span>
            <OrderIcon name="chevron" />
          </button>
          <dl
            :id="`item-${itemIndex}-extras`"
            class="op-points op-extras-body"
            :hidden="!isExtrasOpen('read', itemIndex)"
          >
            <div v-for="field in EXTRA_FIELDS" :key="field.key">
              <dt>{{ field.label }}</dt>
              <dd :data-muted="isNotApplicable(item, field.key) || undefined">
                <span
                  v-if="field.color && swatchOf(item[field.key])"
                  class="op-swatch"
                  :style="{ background: swatchOf(item[field.key]) }"
                  aria-hidden="true"
                ></span>
                {{ shownValue(item[field.key]) }}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <p v-if="!shownItems.length" class="op-empty">
        Nenhum item no pedido ainda.
      </p>
      <p class="op-hint">
        A quantidade de cada item e o total do pedido saem dos tamanhos e nunca
        são digitados.
      </p>
    </div>
  </section>
</template>
