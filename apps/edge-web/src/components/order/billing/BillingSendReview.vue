<script setup>
import { computed, useId } from 'vue';
import { billingMoney } from '../../../lib/order-billing.js';
import { KIND } from '../../../lib/order-billing-view.js';
import OrderIcon from '../OrderIcon.vue';

/*
 * RFC 074: the review before a link leaves — order, destination, value,
 * payment forms and the message as the customer receives it, with the CRM
 * link. Reused by the order page and the Inbox.
 *
 * Props
 * - `orderNumber`, `orderTitle`: "07-CRM", "Escola Aurora — Jogos 2026".
 * - `destination`: "Escola Aurora (WhatsApp)"; '' hides the "Para" line.
 * - `kind`: 'signal' · 'balance' · 'full' · 'part'.
 * - `amountCents`: the link's value.
 * - `valueSub`: `valueSub(kind, figures)`.
 * - `condition`: `{text, after}` when the condition is saved with this send.
 * - `url`: the existing link's CRM URL; '' for a link not created yet.
 * - `existing`: the same link is being sent again.
 */
const props = defineProps({
  orderNumber: { type: String, required: true },
  orderTitle: { type: String, default: '' },
  destination: { type: String, default: '' },
  kind: { type: String, required: true },
  amountCents: { type: Number, required: true },
  valueSub: { type: String, default: '' },
  condition: { type: Object, default: null },
  url: { type: String, default: '' },
  existing: { type: Boolean, default: false },
});
const labelId = useId();
const noun = computed(
  () => KIND[/** @type {keyof typeof KIND} */ (props.kind)]?.noun ?? 'parcela',
);
</script>

<template>
  <dl class="bl-dl">
    <div>
      <dt>Pedido</dt>
      <dd>
        {{ orderNumber }}<span v-if="orderTitle">{{ orderTitle }}</span>
      </dd>
    </div>
    <div v-if="destination">
      <dt>Para</dt>
      <dd>{{ destination }}</dd>
    </div>
    <div>
      <dt>Valor</dt>
      <dd>
        {{ billingMoney(amountCents)
        }}<span v-if="valueSub">{{ valueSub }}</span>
      </dd>
    </div>
    <div>
      <dt>Formas</dt>
      <dd>
        Pix ou cartão: o cliente escolhe na InfinitePay, depois de clicar em
        Pagar
      </dd>
    </div>
    <div v-if="condition">
      <dt>Condição</dt>
      <dd>
        {{ condition.text }} · {{ condition.after
        }}<span>Fica salva no pedido ao enviar</span>
      </dd>
    </div>
  </dl>
  <div class="bl-wa-preview">
    <p :id="labelId" class="bl-wa-label">
      Prévia da mensagem, como o cliente recebe
    </p>
    <div class="bl-wa-stage" role="group" :aria-labelledby="labelId">
      <div class="bl-bubble">
        Pedido {{ orderNumber }} —
        {{ noun }}
        de {{ billingMoney(amountCents) }}. Link para pagamento:
        <span v-if="url" class="bl-bubble-link">{{ url }}</span
        ><span v-else class="bl-bubble-link" data-pending
          >link do CRM, criado ao enviar</span
        ><span class="bl-bubble-meta">agora</span>
      </div>
    </div>
  </div>
  <p class="bl-note">
    <OrderIcon name="info" /><span
      >{{
        existing ? 'É o mesmo link; o cliente ainda não clicou em Pagar. ' : ''
      }}Você pode cancelar este link enquanto o cliente não clicar em Pagar.
      Enviar não confirma o pagamento.</span
    >
  </p>
</template>
