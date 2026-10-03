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
  DEFERRED,
  ITEM_EXTRA_FIELDS,
  ITEM_REQUIRED_FIELDS,
  MAX_OBSERVATIONS,
  NOT_APPLICABLE,
  blankItem,
  briefingToFicha,
  itemTotal,
  normalizeFicha,
  orderTotal,
  projectBriefingOntoFicha,
  validateItems,
  validateObservations,
  validateSummary,
} from './domain/ficha.js';
export { parseSizes } from './domain/sizes.js';
export { formatBrlAmount, parseBrlAmount } from './domain/money.js';
export {
  ORDER_STATUSES,
  PAYMENT_CONDITIONS,
  confirmOrder,
  formatOrderNumber,
  missingForConfirmation,
  recordMilestones,
  reopenOrder,
} from './domain/order.js';
export {
  PRODUCTION_FIELDS,
  blankProduction,
  renderFichaHtml,
} from './print/ficha-canonical-v2.js';
export {
  PRINT_TEMPLATE,
  TEMPLATE_V2,
  TEMPLATE_V3,
  renderOrderFicha,
} from './print/index.js';
export {
  MAX_ORDER_PAGE_SIZE,
  assertOrderRepositoryContract,
} from './ports/contracts.js';
