// Orders module (ADR 006): the Pedido aggregate, its ficha and persistence.
export { InMemoryOrderRepository } from './adapters/in-memory-order-repository.js';
export {
  OrderConflictError,
  OrderError,
  OrderInputError,
  OrderNotFoundError,
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
export {
  MAX_ORDER_PAGE_SIZE,
  assertOrderRepositoryContract,
} from './ports/contracts.js';
