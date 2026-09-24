<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { colorSwatch } from '../../lib/order-catalog.js';
import OrderIcon from './OrderIcon.vue';

const SECTION = 'items';
// The value the ficha prints when a garment has no sleeve or no viés (PFI-07).
const NOT_APPLICABLE = 'NAO APLICAVEL';
const NOT_APPLICABLE_LABEL = 'NÃO APLICÁVEL';
const GRADE_MESSAGE = 'Use uma quantidade inteira maior que zero.';

// Tipo and modelo head the item card; the parts below follow the ficha.
const PART_FIELDS = Object.freeze([
  Object.freeze({ key: 'cor_frente', label: 'Frente', list: 'catalog-colors' }),
  Object.freeze({ key: 'cor_costas', label: 'Costas', list: 'catalog-colors' }),
]);
// PFI-07: only these accept "Não aplicável" — a shirt without sleeves still
// has a front and a back.
const OPTIONAL_FIELDS = Object.freeze([
  Object.freeze({
    key: 'cor_manga_direita',
    label: 'Manga direita',
    list: 'catalog-colors',
  }),
  Object.freeze({
    key: 'cor_manga_esquerda',
    label: 'Manga esquerda',
    list: 'catalog-colors',
  }),
  Object.freeze({
    key: 'vies_gola',
    label: 'Viés gola',
    list: 'catalog-finishes',
  }),
  Object.freeze({
    key: 'vies_mangas',
    label: 'Viés mangas',
    list: 'catalog-finishes',
  }),
]);
const READ_FIELDS = Object.freeze([...PART_FIELDS, ...OPTIONAL_FIELDS]);

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
// PFI-04: every total is summed from the grade, in reading and while editing,
// so the seller sees the number the server will store before saving.
const draftTotal = computed(() =>
  items.value.reduce((total, item) => total + pieces(item), 0),
);
const headline = computed(() => {
  const count = items.value.length;
  return `${count} ${count === 1 ? 'item' : 'itens'} · ${draftTotal.value} peças`;
});

/** @param {Record<string, any>} item */
function pieces(item) {
  return item.grade.reduce(
    /** @param {number} total @param {Record<string, any>} line */
    (total, line) =>
      total + (Number.parseInt(String(line.quantidade), 10) || 0),
    0,
  );
}

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

/**
 * The stepper beside the quantity moves a whole piece at a time and stops at
 * one, since the grade rule refuses zero anyway.
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

async function startEditing() {
  // structuredClone refuses a reactive proxy (DataCloneError); the ficha is
  // plain JSON data, so a JSON round trip is the copy that works here.
  draft.value = JSON.parse(JSON.stringify(props.order.ficha.items));
  lineErrors.value = {};
  errorMessage.value = '';
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
  draft.value.push({
    cor_costas: '',
    cor_frente: '',
    cor_manga_direita: '',
    cor_manga_esquerda: '',
    grade: [{ quantidade: 1, tamanho: '' }],
    malhas: [''],
    modelo: '',
    tipo: '',
    vies_gola: '',
    vies_mangas: '',
  });
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
 * The grade is checked here before the request so the error lands on the line
 * the seller is looking at; the server checks it again and answers 422
 * INVALID_GRADE with the same index.
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
      cor_costas: item.cor_costas,
      cor_frente: item.cor_frente,
      cor_manga_direita: item.cor_manga_direita,
      cor_manga_esquerda: item.cor_manga_esquerda,
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
         its own message; the error belongs on the grade line, in Portuguese. -->
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
            <span class="op-item-index">Item {{ itemIndex + 1 }}</span>
            <div class="op-item-names">
              <div class="op-field">
                <label :for="`item-${itemIndex}-tipo`">Tipo</label>
                <div class="op-combo">
                  <input
                    :id="`item-${itemIndex}-tipo`"
                    v-model="item.tipo"
                    type="text"
                    list="catalog-piece-types"
                    autocomplete="off"
                    autocapitalize="characters"
                  />
                  <OrderIcon name="chevron" />
                </div>
              </div>
              <div class="op-field">
                <label :for="`item-${itemIndex}-modelo`">Modelo</label>
                <div class="op-combo">
                  <input
                    :id="`item-${itemIndex}-modelo`"
                    v-model="item.modelo"
                    type="text"
                    list="catalog-modelings"
                    autocomplete="off"
                    autocapitalize="characters"
                  />
                  <OrderIcon name="chevron" />
                </div>
              </div>
            </div>
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

          <div class="op-item-fields">
            <div class="op-field op-field--wide">
              <span class="op-label">Malhas</span>
              <div
                v-for="(malha, malhaIndex) in item.malhas"
                :key="malhaIndex"
                class="op-input-row"
              >
                <div class="op-combo">
                  <input
                    v-model="item.malhas[malhaIndex]"
                    type="text"
                    list="catalog-fabrics"
                    autocomplete="off"
                    autocapitalize="characters"
                    :aria-label="`Malha ${malhaIndex + 1}`"
                  />
                  <OrderIcon name="chevron" />
                </div>
                <button
                  v-if="item.malhas.length > 1"
                  type="button"
                  class="op-icon-button"
                  @click="removeMalha(item, malhaIndex)"
                >
                  <OrderIcon name="x" />
                  <span class="op-visually-hidden">{{
                    `Remover malha ${malhaIndex + 1}`
                  }}</span>
                </button>
              </div>
              <button
                type="button"
                class="op-add-inline"
                @click="addMalha(item)"
              >
                <OrderIcon name="plus" />Adicionar malha
              </button>
            </div>

            <div v-for="field in PART_FIELDS" :key="field.key" class="op-field">
              <label :for="`item-${itemIndex}-${field.key}`">{{
                field.label
              }}</label>
              <div class="op-input-swatch op-combo">
                <span
                  v-if="swatchOf(item[field.key])"
                  class="op-swatch"
                  :style="{ background: swatchOf(item[field.key]) }"
                  aria-hidden="true"
                ></span>
                <input
                  :id="`item-${itemIndex}-${field.key}`"
                  v-model="item[field.key]"
                  type="text"
                  :list="field.list"
                  autocomplete="off"
                  autocapitalize="characters"
                />
                <OrderIcon name="chevron" />
              </div>
            </div>

            <div
              v-for="field in OPTIONAL_FIELDS"
              :key="field.key"
              class="op-field"
            >
              <label :for="`item-${itemIndex}-${field.key}`">{{
                field.label
              }}</label>
              <div class="op-input-swatch op-combo">
                <span
                  v-if="swatchOf(item[field.key])"
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
                  :list="field.list"
                  autocomplete="off"
                  autocapitalize="characters"
                  :disabled="isNotApplicable(item, field.key)"
                  @input="item[field.key] = $event.target.value"
                />
                <OrderIcon name="chevron" />
              </div>
              <label class="op-check">
                <input
                  type="checkbox"
                  :checked="isNotApplicable(item, field.key)"
                  :aria-label="`${field.label} não se aplica`"
                  @change="
                    toggleNotApplicable(item, field.key, $event.target.checked)
                  "
                />
                <span aria-hidden="true">Não aplicável</span>
              </label>
            </div>
          </div>

          <div class="op-grade-editor">
            <div class="op-grade-editor-head">
              <span class="op-label">Grade</span>
              <span class="op-num"
                >Total do item <strong>{{ pieces(item) }} peças</strong></span
              >
            </div>
            <div class="op-grade-lines">
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
                    list="catalog-sizes"
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
                    v-if="item.grade.length > 1"
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
            <button
              type="button"
              class="op-add-inline"
              @click="addGradeLine(item)"
            >
              <OrderIcon name="plus" />Adicionar tamanho
            </button>
          </div>
        </fieldset>

        <button type="button" class="op-add-item" @click="addItem">
          <OrderIcon name="plus" />Adicionar item
        </button>
      </div>

      <div class="op-form-actions">
        <p class="op-num">
          Total do pedido: <strong>{{ draftTotal }} peças</strong>, somado da
          grade.
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
        :aria-label="`Item ${itemIndex + 1}`"
      >
        <div class="op-item-head">
          <div class="op-item-title">
            <span class="op-item-index">Item {{ itemIndex + 1 }}</span>
            <h3>
              {{ item.tipo || '—' }}
              <span>{{ item.modelo || '' }}</span>
            </h3>
          </div>
          <p class="op-item-pieces op-num">
            <strong>{{ pieces(item) }}</strong> peças
          </p>
        </div>
        <div class="op-item-body">
          <dl class="op-specs">
            <div class="op-specs-wide">
              <dt>Malhas</dt>
              <dd>{{ item.malhas.join(' / ') || '—' }}</dd>
            </div>
            <div v-for="field in READ_FIELDS" :key="field.key">
              <dt>{{ field.label }}</dt>
              <dd :data-muted="isNotApplicable(item, field.key) || undefined">
                <span
                  v-if="swatchOf(item[field.key])"
                  class="op-swatch"
                  :style="{ background: swatchOf(item[field.key]) }"
                  aria-hidden="true"
                ></span>
                {{ shownValue(item[field.key]) }}
              </dd>
            </div>
          </dl>
          <div class="op-grade">
            <h4 class="op-label">Grade</h4>
            <ul v-if="item.grade.length" class="op-grade-tiles">
              <li v-for="(line, lineIndex) in item.grade" :key="lineIndex">
                <span>{{ line.tamanho }}</span
                ><strong class="op-num">{{ line.quantidade }}</strong>
              </li>
            </ul>
            <p v-else class="op-hint">Sem grade.</p>
          </div>
        </div>
      </div>
      <p v-if="!shownItems.length" class="op-empty">
        Nenhum item no pedido ainda.
      </p>
      <p class="op-hint">
        O total do item e o total do pedido saem da grade e nunca são digitados.
      </p>
    </div>
  </section>
</template>
