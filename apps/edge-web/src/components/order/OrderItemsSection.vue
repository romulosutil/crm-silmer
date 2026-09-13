<script setup>
import { computed, inject, nextTick, ref } from 'vue';

const SECTION = 'items';
// The value the ficha prints when a garment has no sleeve or no viés (PFI-07).
const NOT_APPLICABLE = 'NAO APLICAVEL';
const NOT_APPLICABLE_LABEL = 'NÃO APLICÁVEL';
const GRADE_MESSAGE = 'Use uma quantidade inteira maior que zero.';

const TEXT_FIELDS = Object.freeze([
  Object.freeze({ key: 'tipo', label: 'Tipo' }),
  Object.freeze({ key: 'modelo', label: 'Modelo' }),
  Object.freeze({ key: 'cor_frente', label: 'Frente' }),
  Object.freeze({ key: 'cor_costas', label: 'Costas' }),
]);
// PFI-07: only these accept "Não aplicável" — a shirt without sleeves still
// has a front and a back.
const OPTIONAL_FIELDS = Object.freeze([
  Object.freeze({ key: 'cor_manga_direita', label: 'Manga direita' }),
  Object.freeze({ key: 'cor_manga_esquerda', label: 'Manga esquerda' }),
  Object.freeze({ key: 'vies_gola', label: 'Viés gola' }),
  Object.freeze({ key: 'vies_mangas', label: 'Viés mangas' }),
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

/** @param {unknown} value */
function shownValue(value) {
  if (value === NOT_APPLICABLE) return NOT_APPLICABLE_LABEL;
  return value || '—';
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
  <section class="surface section-gap" aria-labelledby="order-items-title">
    <div class="panel-head">
      <h2 id="order-items-title">Itens e especificações</h2>
      <p>{{ headline }}</p>
      <button
        v-if="canEdit && !isEditing"
        type="button"
        :disabled="otherSectionOpen"
        @click="startEditing"
      >
        Editar
      </button>
    </div>

    <p v-if="errorMessage" role="alert" class="audit-note">
      {{ errorMessage }}
    </p>

    <!-- novalidate: the browser would block the submit on its own and show
         its own message; the error belongs on the grade line, in Portuguese. -->
    <form
      v-if="isEditing"
      ref="form"
      class="order-form"
      novalidate
      @submit.prevent="save"
    >
      <fieldset
        v-for="(item, itemIndex) in draft"
        :key="itemIndex"
        class="order-item"
      >
        <legend>Item {{ itemIndex + 1 }} · {{ pieces(item) }} peças</legend>

        <div class="field-list">
          <template v-for="field in TEXT_FIELDS" :key="field.key">
            <label :for="`item-${itemIndex}-${field.key}`">{{
              field.label
            }}</label>
            <input
              :id="`item-${itemIndex}-${field.key}`"
              v-model="item[field.key]"
              type="text"
            />
          </template>

          <template v-for="field in OPTIONAL_FIELDS" :key="field.key">
            <label :for="`item-${itemIndex}-${field.key}`">{{
              field.label
            }}</label>
            <input
              :id="`item-${itemIndex}-${field.key}`"
              v-model="item[field.key]"
              type="text"
              :disabled="isNotApplicable(item, field.key)"
            />
            <label class="checkbox-line">
              <input
                type="checkbox"
                :checked="isNotApplicable(item, field.key)"
                :aria-label="`${field.label} não se aplica`"
                @change="
                  toggleNotApplicable(item, field.key, $event.target.checked)
                "
              />
              Não aplicável
            </label>
          </template>
        </div>

        <div class="order-subblock">
          <h3>Malhas</h3>
          <div
            v-for="(malha, malhaIndex) in item.malhas"
            :key="malhaIndex"
            class="inline-actions"
          >
            <input
              v-model="item.malhas[malhaIndex]"
              type="text"
              :aria-label="`Malha ${malhaIndex + 1}`"
            />
            <button
              v-if="item.malhas.length > 1"
              type="button"
              @click="removeMalha(item, malhaIndex)"
            >
              Remover malha {{ malhaIndex + 1 }}
            </button>
          </div>
          <button type="button" @click="addMalha(item)">Adicionar malha</button>
        </div>

        <div class="order-subblock">
          <h3>Grade</h3>
          <div
            v-for="(line, lineIndex) in item.grade"
            :key="lineIndex"
            class="order-grade-line"
          >
            <input
              v-model="line.tamanho"
              type="text"
              :aria-label="`Tamanho da linha ${lineIndex + 1}`"
            />
            <input
              v-model="line.quantidade"
              type="number"
              min="1"
              step="1"
              :aria-label="
                line.tamanho
                  ? `Quantidade do tamanho ${line.tamanho}`
                  : `Quantidade da linha ${lineIndex + 1}`
              "
            />
            <button
              v-if="item.grade.length > 1"
              type="button"
              @click="removeGradeLine(item, lineIndex)"
            >
              Remover linha {{ lineIndex + 1 }}
            </button>
            <p
              v-if="lineErrors[`${itemIndex}:${lineIndex}`]"
              role="alert"
              class="audit-note"
            >
              {{ lineErrors[`${itemIndex}:${lineIndex}`] }}
            </p>
          </div>
          <button type="button" @click="addGradeLine(item)">
            Adicionar tamanho
          </button>
        </div>

        <button
          v-if="draft.length > 1"
          type="button"
          @click="removeItem(itemIndex)"
        >
          Remover item {{ itemIndex + 1 }}
        </button>
      </fieldset>

      <div class="inline-actions">
        <button type="button" @click="addItem">Adicionar item</button>
      </div>
      <div class="inline-actions">
        <button class="primary" type="submit" :disabled="saving">
          {{ saving ? 'Salvando…' : 'Salvar' }}
        </button>
        <button type="button" :disabled="saving" @click="cancel">
          Cancelar
        </button>
      </div>
    </form>

    <template v-else>
      <div
        v-for="(item, itemIndex) in shownItems"
        :key="itemIndex"
        class="order-item"
        role="group"
        :aria-label="`Item ${itemIndex + 1}`"
      >
        <div class="panel-head">
          <h3>Item {{ itemIndex + 1 }} · {{ item.tipo || '—' }}</h3>
          <p>{{ item.modelo || '—' }} · {{ pieces(item) }} peças</p>
        </div>
        <dl class="client-facts">
          <div>
            <dt>Malhas</dt>
            <dd>{{ item.malhas.join(' / ') || '—' }}</dd>
          </div>
          <div v-for="field in TEXT_FIELDS.slice(2)" :key="field.key">
            <dt>{{ field.label }}</dt>
            <dd>{{ shownValue(item[field.key]) }}</dd>
          </div>
          <div v-for="field in OPTIONAL_FIELDS" :key="field.key">
            <dt>{{ field.label }}</dt>
            <dd>{{ shownValue(item[field.key]) }}</dd>
          </div>
        </dl>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Tamanho</th>
                <th scope="col" class="num">Quantidade</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(line, lineIndex) in item.grade" :key="lineIndex">
                <td>{{ line.tamanho }}</td>
                <td class="num">{{ line.quantidade }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p v-if="!shownItems.length" class="empty-list">
        Nenhum item no pedido ainda.
      </p>
    </template>

    <p class="footnote">
      O total do item e o total do pedido saem da grade e nunca são digitados.
    </p>
  </section>
</template>
