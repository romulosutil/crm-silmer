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
const COLOR_NAMES = COLORS.map((color) => color.name);
</script>

<template>
  <div hidden>
    <datalist id="catalog-piece-types">
      <option v-for="value in PIECE_TYPES" :key="value" :value="value" />
    </datalist>
    <datalist id="catalog-modelings">
      <option v-for="value in MODELINGS" :key="value" :value="value" />
    </datalist>
    <datalist id="catalog-fabrics">
      <option v-for="value in FABRICS" :key="value" :value="value" />
    </datalist>
    <datalist id="catalog-colors">
      <option v-for="value in COLOR_NAMES" :key="value" :value="value" />
    </datalist>
    <datalist id="catalog-finishes">
      <option v-for="value in FINISHES" :key="value" :value="value" />
    </datalist>
    <datalist id="catalog-applications">
      <option v-for="value in APPLICATIONS" :key="value" :value="value" />
    </datalist>
    <datalist id="catalog-sizes">
      <option v-for="value in SIZES" :key="value" :value="value" />
    </datalist>
  </div>
</template>
