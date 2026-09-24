<script setup>
import {
  APPLICATIONS,
  COLORS,
  FABRICS,
  FINISHES,
  MODELINGS,
  PIECE_TYPES,
  SIZES,
} from '../../lib/order-catalog.js';

// Rendered once per page: every ficha field points at one of these lists by
// id, so the catalog is suggested without turning free text into a select.
// The ficha is written in capitals, so the suggestions are too: a picked
// option reads like the values already on the order.
/** @param {readonly string[]} values */
const caps = (values) =>
  values.map((value) => value.toLocaleUpperCase('pt-BR'));
const LISTS = Object.freeze([
  { id: 'catalog-piece-types', values: caps(PIECE_TYPES) },
  { id: 'catalog-modelings', values: caps(MODELINGS) },
  { id: 'catalog-fabrics', values: caps(FABRICS) },
  { id: 'catalog-colors', values: caps(COLORS.map((color) => color.name)) },
  { id: 'catalog-finishes', values: caps(FINISHES) },
  { id: 'catalog-applications', values: caps(APPLICATIONS) },
  { id: 'catalog-sizes', values: caps(SIZES) },
]);
</script>

<template>
  <div hidden>
    <datalist v-for="list in LISTS" :id="list.id" :key="list.id">
      <option v-for="value in list.values" :key="value" :value="value" />
    </datalist>
  </div>
</template>
