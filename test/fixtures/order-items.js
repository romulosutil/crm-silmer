import { readFile } from 'node:fs/promises';

const synthetic = JSON.parse(
  await readFile(
    new URL('../../docs/phase0/ficha-pdf-synthetic.json', import.meta.url),
    'utf8',
  ),
);

// ADR 016/020: the approved synthetic items predate the colour, technique
// and collar of the seven-point item. These are the values that complete
// them, with the print reference of the first item.
const PRINCIPAL_FIELDS = Object.freeze([
  Object.freeze({
    cor: 'AZUL MARINHO',
    estampa: 'Logo · frente',
    gola: 'GOLA REDONDA',
    tipo_servico: 'SUBLIMAÇÃO',
  }),
  Object.freeze({
    cor: 'PRETA',
    estampa: '',
    gola: 'SEM GOLA',
    tipo_servico: 'SEM ESTAMPA',
  }),
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

/**
 * ADR 020: who makes the art of a complete synthetic order.
 *
 * @returns {{feito_pelo_cliente: boolean, feito_pela_silmer: boolean, sem_estampa: boolean, files: unknown[]}}
 */
export function syntheticArtwork() {
  return {
    feito_pela_silmer: false,
    feito_pelo_cliente: true,
    files: [],
    sem_estampa: false,
  };
}
