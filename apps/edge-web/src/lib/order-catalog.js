// ADR 007: the screen reads the same order catalog as the server, generated
// from the option sheet the Silmer approved. Every suggestion comes from it.
import {
  ORDER_CATALOG,
  foldText,
} from '../../../../modules/orders/src/catalog/index.js';

export {
  FIELDS,
  NOT_APPLICABLE,
  ORDER_CATALOG,
  applicationOptions,
  describeItem,
  fieldOptions,
  foldText,
  itemFields,
  productOptions,
  readField,
  resolveProduct,
  scaleById,
  scalesFor,
} from '../../../../modules/orders/src/catalog/index.js';

/**
 * `swatch` is an approximation for the screen only, so the seller sees at a
 * glance which colour the text names. It never reaches the printed ficha.
 */
const SWATCHES = ORDER_CATALOG.lists.cores
  .filter((option) => option.swatch)
  .flatMap((option) =>
    [option.value, option.label.split('/')[0]].map((name) => ({
      key: foldText(name),
      swatch: String(option.swatch),
    })),
  )
  // The longest name wins, so "azul marinho" is not read as a plain "azul".
  .sort((a, b) => b.key.length - a.key.length);

/**
 * The swatch of the first catalog colour named in a free-text value
 * ("AZUL MARINHO", "RIBANA · VERDE BANDEIRA"), or '' when none is.
 *
 * @param {unknown} value
 */
export function colorSwatch(value) {
  const text = foldText(value);
  if (text === '') return '';
  return SWATCHES.find((entry) => text.includes(entry.key))?.swatch ?? '';
}
