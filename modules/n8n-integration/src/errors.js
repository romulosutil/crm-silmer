export class N8nIntegrationError extends Error {
  /** @param {string} message @param {string} code @param {number} statusCode */
  constructor(message, code, statusCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class N8nValidationError extends N8nIntegrationError {
  /** @param {string} [message] */
  constructor(message = 'Invalid n8n integration command') {
    super(message, 'N8N_INVALID', 400);
  }
}

export class N8nForbiddenError extends N8nIntegrationError {
  constructor() {
    super('Forbidden', 'N8N_FORBIDDEN', 403);
  }
}

export class N8nNotFoundError extends N8nIntegrationError {
  /** @param {string} [message] */
  constructor(message = 'n8n integration resource was not found') {
    super(message, 'N8N_NOT_FOUND', 404);
  }
}

export class N8nConflictError extends N8nIntegrationError {
  /** @param {string} [message] @param {string} [code] */
  constructor(
    message = 'n8n integration command conflicts with current state',
    code = 'N8N_CONFLICT',
  ) {
    super(message, code, 409);
  }
}

export class N8nUnavailableError extends N8nIntegrationError {
  /** @param {string} [message] */
  constructor(message = 'n8n integration is temporarily unavailable') {
    super(message, 'N8N_UNAVAILABLE', 503);
  }
}
