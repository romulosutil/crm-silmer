export { createDealConversionService } from './application/deal-conversion-service.js';
export { PostgresDealRepository } from './adapters/postgres-deal-repository.js';
export { INITIAL_DEAL_STAGE } from './domain/deal.js';
export {
  DealConflictError,
  DealError,
  DealForbiddenError,
  DealValidationError,
} from './domain/errors.js';
