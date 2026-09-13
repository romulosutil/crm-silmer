// Orders module (ADR 006): the Pedido aggregate, its ficha and persistence.
export { InMemoryOrderRepository } from './adapters/in-memory-order-repository.js';
export { PostgresOrderConversationPort } from './adapters/postgres-order-conversation-port.js';
export { PostgresOrderRepository } from './adapters/postgres-order-repository.js';
export {
  DEFAULT_ORDER_PAGE_SIZE,
  ORDER_SECTIONS,
  createOrderService,
} from './application/order-service.js';
export {
  OrderConflictError,
  OrderError,
  OrderForbiddenError,
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
  projectBriefingOntoFicha,
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
export { renderFichaHtml } from './print/ficha-canonical-v2.js';
export {
  MAX_ORDER_PAGE_SIZE,
  assertOrderRepositoryContract,
} from './ports/contracts.js';
