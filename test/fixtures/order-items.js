import { readFile } from 'node:fs/promises';

const synthetic = JSON.parse(
  await readFile(
    new URL('../../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

// ADR 016: the approved synthetic items predate the colour, artwork and
// collar of the seven-point item. These are the values that complete them.
const PRINCIPAL_FIELDS = Object.freeze([
  Object.freeze({
    cor: 'AZUL MARINHO',
    estampa: 'Arte do cliente · frente',
    gola: 'GOLA REDONDA',
  }),
  Object.freeze({ cor: 'PRETA', estampa: 'Sem estampa', gola: 'SEM GOLA' }),
]);

/**
 * The approved synthetic items, complete under ADR 016 (32 pieces).
 *
 * @returns {Record<string, any>[]}
 */
export function syntheticItems() {
  return structuredClone(synthetic.pedido.itens).map(
    (/** @type {Record<string, any>} */ item, /** @type {number} */ index) => ({
      ...item,
      ...PRINCIPAL_FIELDS[index],
    }),
  );
}
