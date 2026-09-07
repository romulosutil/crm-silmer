export class DealError extends Error {
  /** @param {string} message @param {string} code @param {number} statusCode */
  constructor(message, code, statusCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class DealValidationError extends DealError {
  /** @param {string} [message] */
  constructor(message = 'Invalid deal command') {
    super(message, 'DEAL_INVALID', 400);
  }
}

export class DealForbiddenError extends DealError {
  constructor() {
    super('Forbidden', 'DEAL_FORBIDDEN', 403);
  }
}

export class DealConflictError extends DealError {
  /** @param {string} [message] */
  constructor(message = 'Deal command conflicts with current state') {
    super(message, 'DEAL_CONFLICT', 409);
  }
}
