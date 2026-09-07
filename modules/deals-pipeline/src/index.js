export { createDealConversionService } from './application/deal-conversion-service.js';
export { createDealCommandService } from './application/deal-command-service.js';
export { InMemoryDealRepository } from './adapters/in-memory-deal-repository.js';
export { PostgresDealAutomationFencePort } from './adapters/postgres-deal-automation-fence.js';
export { PostgresDealRepository } from './adapters/postgres-deal-repository.js';
export { PostgresDealWorkPort } from './adapters/postgres-deal-work-port.js';
export { PostgresDealReadRepository } from './adapters/postgres-deal-read-repository.js';
export {
  DealReadError,
  createDealReadService,
  decodeDealCursor,
  encodeDealCursor,
} from './deal-read-service.js';
export {
  DEAL_STAGES,
  INITIAL_DEAL_STAGE,
  deriveDealStage,
} from './domain/deal.js';
export { createDealLossReasonCipher } from './domain/loss-reason-cipher.js';
export {
  DealConflictError,
  DealError,
  DealForbiddenError,
  DealGateIncompleteError,
  DealValidationError,
} from './domain/errors.js';
