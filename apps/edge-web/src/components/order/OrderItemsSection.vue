<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import {
  NOT_APPLICABLE,
  colorSwatch,
  describeItem,
  itemFields,
  productOptions,
  readField,
  resolveProduct,
  scaleById,
  scalesFor,
} from '../../lib/order-catalog.js';
import {
  draftItem,
  emptyItem,
  gradeForScale,
  itemPayload,
} from '../../lib/order-items.js';
import OrderCombobox from './OrderCombobox.vue';
import OrderIcon from './OrderIcon.vue';
import OrderSpecField from './OrderSpecField.vue';

const SECTION = 'items';
const NOT_APPLICABLE_LABEL = 'NÃO APLICÁVEL';
const GRADE_MESSAGE = 'Use uma quantidade inteira maior que zero.';
// FIT-01: every Tipo suggests the catalog products, grouped by family.
const PRODUCT_OPTIONS = productOptions();
// PFI-07 only where the catalog cannot say the part is missing (F14).
const NOT_APPLICABLE_FIELDS = new Set([
  'cor_manga_direita',
  'cor_manga_esquerda',
  'vies_gola',
  'vies_mangas',
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

/** @param {Record<string, any>} item */
function productOf(item) {
  return resolveProduct(item.tipo);
}

/** FIT-02/FIT-03 @param {Record<string, any>} item */
function fieldsOf(item) {
  return itemFields(productOf(item));
}

/** FGR-01 @param {Record<string, any>} item */
function scaleOptions(item) {
  return scalesFor(productOf(item));
}

/**
 * FGR-02/FGR-05: the scale is stored on the item and its sizes join the grade.
 * One handler does both, so the grade never reads a stale scale.
 *
 * @param {Record<string, any>} item @param {string} id
 */
function setScale(item, id) {
  item.escala = id;
  const scale = scaleById(id);
  if (scale && !scale.freeText) item.grade = gradeForScale(item.grade, scale);
}

/**
 * The sizes the grade suggests: the chosen scale, or every scale the product
 * offers; a "Medida" scale is typed freely (FGR-03, FGR-04).
 *
 * @param {Record<string, any>} item
 */
function sizeGroups(item) {
  const chosen = scaleById(item.escala);
  const scales = chosen ? [chosen] : scaleOptions(item);
  return scales
    .filter((scale) => !scale.freeText)
    .map((scale) => ({
      label: scale.label,
      options: scale.sizes.map((size) => ({ value: size, label: size })),
    }));
}

/** @param {Record<string, any>} item */
function gradeTitle(item) {
  const scale = scaleById(String(item.escala ?? ''));
  return scale && scale.id !== 'adulto' ? `Grade · ${scale.label}` : 'Grade';
}

/**
 * @param {Record<string, any>} item
 * @param {{path: string}} field
 * @param {string | string[]} value
 */
function writeValue(item, field, value) {
  if (field.path.startsWith('specs.')) {
    item.specs[field.path.slice('specs.'.length)] = value;
    return;
  }
  item[field.path] = value;
}

/** @param {string | string[]} value */
function joined(value) {
  return Array.isArray(value) ? value.join(' / ') : value;
}

/** FIT-11: reading shows only what the product has and someone filled. @param {Record<string, any>} item */
function view(item) {
  const filled = describeItem(item).cells.filter((cell) => !cell.empty);
  return {
    header: filled
      .filter((cell) => cell.field.placement === 'header')
      .map((cell) => joined(cell.value))
      .join(' · '),
    grid: filled.filter((cell) => cell.field.placement === 'grid'),
    wide: filled.filter((cell) => cell.field.placement === 'wide'),
  };
}

/** @param {string | string[]} value */
function shownValue(value) {
  if (value === NOT_APPLICABLE) return NOT_APPLICABLE_LABEL;
  return joined(value) || '—';
}

/** FIT-10 @param {{field: {list: string, colorList?: string}, value: string | string[]}} cell */
function swatchOf(cell) {
  if (Array.isArray(cell.value) || cell.value === NOT_APPLICABLE) return '';
  if (cell.field.list !== 'cores' && cell.field.colorList !== 'cores') {
    return '';
  }
  return colorSwatch(cell.value);
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

async function startEditing() {
  // structuredClone refuses a reactive proxy (DataCloneError); the ficha is
  // plain JSON data, so a JSON round trip is the copy that works here.
  draft.value = JSON.parse(JSON.stringify(props.order.ficha.items)).map(
    draftItem,
  );
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
  draft.value.push(emptyItem());
}

/** @param {number} index */
function removeItem(index) {
  draft.value.splice(index, 1);
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
        // FGR-02: a line nobody counted is dropped on save, not refused.
        if (String(line.quantidade ?? '').trim() === '') return;
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
  const result = await editing.save(SECTION, draft.value.map(itemPayload));
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
                <OrderCombobox
                  :id="`item-${itemIndex}-tipo`"
                  v-model="item.tipo"
                  :groups="PRODUCT_OPTIONS"
                />
                <p
                  v-if="item.tipo.trim() !== '' && !productOf(item)"
                  class="op-hint"
                >
                  Produto fora do catálogo: todos os campos aparecem.
                </p>
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
            <OrderSpecField
              v-for="field in fieldsOf(item)"
              :key="field.id"
              :field="field"
              :product-id="productOf(item)?.id ?? null"
              :input-id="`item-${itemIndex}-${field.id}`"
              :allow-not-applicable="
                !productOf(item) && NOT_APPLICABLE_FIELDS.has(field.id)
              "
              :model-value="readField(item, field)"
              @update:model-value="(value) => writeValue(item, field, value)"
            />
            <div class="op-field op-field--wide">
              <label :for="`item-${itemIndex}-outras`"
                >Outras especificações</label
              >
              <textarea
                :id="`item-${itemIndex}-outras`"
                v-model="item.outras"
                rows="2"
                maxlength="500"
              ></textarea>
            </div>
          </div>

          <div class="op-grade-editor">
            <div class="op-grade-editor-head">
              <span class="op-label">Grade</span>
              <select
                :value="item.escala"
                class="op-grade-scale"
                :aria-label="`Escala da grade do item ${itemIndex + 1}`"
                @change="setScale(item, $event.target.value)"
              >
                <option value="">Escala…</option>
                <option
                  v-for="scale in scaleOptions(item)"
                  :key="scale.id"
                  :value="scale.id"
                >
                  {{ scale.label }}
                </option>
              </select>
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
                  <OrderCombobox
                    :id="`item-${itemIndex}-tamanho-${lineIndex}`"
                    v-model="line.tamanho"
                    class="op-grade-size"
                    :groups="sizeGroups(item)"
                    :aria-label="`Tamanho da linha ${lineIndex + 1}`"
                    :invalid="
                      Boolean(lineErrors[`${itemIndex}:${lineIndex}`]) &&
                      String(line.tamanho).trim() === ''
                    "
                    :aria-describedby="
                      lineErrors[`${itemIndex}:${lineIndex}`]
                        ? `grade-error-${itemIndex}-${lineIndex}`
                        : ''
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
              <span>{{ view(item).header }}</span>
            </h3>
          </div>
          <p class="op-item-pieces op-num">
            <strong>{{ pieces(item) }}</strong> peças
          </p>
        </div>
        <div class="op-item-body">
          <dl class="op-specs">
            <div
              v-for="cell in view(item).grid"
              :key="cell.field.id"
              :class="{ 'op-specs-wide': cell.field.kind === 'multi' }"
            >
              <dt>{{ cell.field.label }}</dt>
              <dd :data-muted="cell.value === NOT_APPLICABLE || undefined">
                <span
                  v-if="swatchOf(cell)"
                  class="op-swatch"
                  :style="{ background: swatchOf(cell) }"
                  aria-hidden="true"
                ></span>
                {{ shownValue(cell.value) }}
              </dd>
            </div>
            <div
              v-for="cell in view(item).wide"
              :key="cell.field.id"
              class="op-specs-wide"
            >
              <dt>{{ cell.field.label }}</dt>
              <dd>{{ shownValue(cell.value) }}</dd>
            </div>
            <div v-if="item.outras" class="op-specs-wide">
              <dt>Outras especificações</dt>
              <dd>{{ item.outras }}</dd>
            </div>
          </dl>
          <div class="op-grade">
            <h4 class="op-label">{{ gradeTitle(item) }}</h4>
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
