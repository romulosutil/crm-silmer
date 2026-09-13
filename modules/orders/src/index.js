// Orders module (ADR 006): the Pedido aggregate, its ficha and persistence.
export {
  OrderError,
  OrderInputError,
  OrderValidationError,
} from './domain/errors.js';
export {
  MAX_OBSERVATIONS,
  NOT_APPLICABLE,
  briefingToFicha,
  itemTotal,
  orderTotal,
  validateItems,
  validateObservations,
  validateSummary,
} from './domain/ficha.js';
export { formatBrlAmount, parseBrlAmount } from './domain/money.js';
