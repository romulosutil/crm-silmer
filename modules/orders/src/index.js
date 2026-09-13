// Orders module (ADR 006): the Pedido aggregate, its ficha and persistence.
export {
  OrderConflictError,
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
export {
  ORDER_STATUSES,
  PAYMENT_CONDITIONS,
  confirmOrder,
  formatOrderNumber,
  missingForConfirmation,
  reopenOrder,
} from './domain/order.js';
