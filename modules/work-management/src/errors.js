export class WorkValidationError extends Error {
  /** @param {string} message */
  constructor(message = 'Invalid work-management command') {
    super(message);
    this.name = 'WorkValidationError';
    this.code = 'WORK_INVALID';
    this.statusCode = 422;
  }
}

export class WorkConflictError extends Error {
  /** @param {string} message */
  constructor(message = 'Work-management state conflict') {
    super(message);
    this.name = 'WorkConflictError';
    this.code = 'WORK_CONFLICT';
    this.statusCode = 409;
  }
}

export class WorkForbiddenError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'WorkForbiddenError';
    this.code = 'WORK_FORBIDDEN';
    this.statusCode = 403;
  }
}
