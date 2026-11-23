<script setup>
import { computed } from 'vue';
import { billingMoney } from '../../../lib/order-billing.js';
import {
  KIND,
  cancelReview,
  dayMonthTimeOf,
  timeOf,
} from '../../../lib/order-billing-view.js';
import OrderIcon from '../OrderIcon.vue';

/*
 * RFC 074: what "Cancelar link" will do, and — when the customer clicked
 * Pagar first — the refusal in place (LPC-04: the server decides the race).
 * Reused by the order page and the Inbox.
 *
 * Props
 * - `link`: a normalized link (view.links).
 * - `figures`: view.figures.
 * - `refusal`: `{clickedAt, providerValidUntil, state}` after a 409
 *   BILLING_LINK_NOT_OPEN, or null. The refusal paragraph has id
 *   `refusalId`, role=alert and tabindex=-1 so the caller can focus it.
 * - `refusalId`: id of that paragraph.
 */
const props = defineProps({
  link: { type: Object, required: true },
  figures: { type: Object, required: true },
  refusal: { type: Object, default: null },
  refusalId: { type: String, default: 'order-billing-cancel-refusal' },
});
const K = computed(
  () => KIND[/** @type {keyof typeof KIND} */ (props.link.kind)] ?? KIND.part,
);
const after = computed(() => cancelReview(props.link, props.figures));
const refusalText = computed(() => {
  const r = props.refusal;
  if (!r) return '';
  if (r.state === 'cancelled') return 'Este link já estava cancelado.';
  if (r.state === 'paid')
    return 'Não deu para cancelar: o cliente já pagou este link.';
  return r.clickedAt
    ? `Não deu para cancelar: o cliente clicou em Pagar às ${timeOf(r.clickedAt)}. Acompanhe o pagamento.`
    : 'Não deu para cancelar: o cliente clicou em Pagar. Acompanhe o pagamento.';
});
</script>

<template>
  <template v-if="refusal">
    <p :id="refusalId" class="bl-warn" tabindex="-1" role="alert">
      <OrderIcon name="alert" /><span>{{ refusalText }}</span>
    </p>
    <dl
      v-if="refusal.state !== 'cancelled' && refusal.state !== 'paid'"
      class="bl-dl"
    >
      <div>
        <dt>Link</dt>
        <dd>
          {{ K.title }} · {{ billingMoney(link.amountCents)
          }}<span
            >Em pagamento<template v-if="refusal.clickedAt">
              · aberto na InfinitePay às
              {{ timeOf(refusal.clickedAt) }}</template
            ><template v-if="refusal.providerValidUntil"
              >, vale até
              {{ dayMonthTimeOf(refusal.providerValidUntil) }}</template
            ></span
          >
        </dd>
      </div>
    </dl>
    <p class="bl-note">
      <OrderIcon name="info" /><span
        >O CRM não cancela pagamentos na InfinitePay. Se o cliente pagar, o link
        aparece como Recebido.</span
      >
    </p>
  </template>
  <template v-else>
    <dl class="bl-dl">
      <div>
        <dt>Link</dt>
        <dd>
          {{ K.title }} · {{ billingMoney(link.amountCents)
          }}<span v-if="link.url">{{ link.url }}</span>
        </dd>
      </div>
      <div>
        <dt>Situação</dt>
        <dd>
          {{
            link.sentAt
              ? `Enviado na conversa em ${dayMonthTimeOf(link.sentAt)}`
              : `Gerado em ${dayMonthTimeOf(link.createdAt)}, não enviado`
          }}<span>{{
            link.pageOpenedAt
              ? `O cliente abriu a página às ${timeOf(link.pageOpenedAt)}, mas não clicou em Pagar`
              : 'O cliente ainda não clicou em Pagar'
          }}</span>
        </dd>
      </div>
    </dl>
    <p class="bl-review">
      Em links abertos passa a
      <strong>{{ billingMoney(after.reserved) }}</strong> · livre para cobrar
      <strong>{{ billingMoney(after.free) }}</strong>
    </p>
    <p class="bl-note">
      <OrderIcon name="info" /><span
        >Quem abrir este link verá que ele foi cancelado. Nada foi criado na
        InfinitePay, então não há o que cancelar lá.</span
      >
    </p>
  </template>
</template>
