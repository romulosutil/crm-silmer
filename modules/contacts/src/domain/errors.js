export class ContactIdentityError extends Error {
  /** @param {string} message @param {string} code @param {number} statusCode */
  constructor(message, code, statusCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ContactIdentityValidationError extends ContactIdentityError {
  constructor() {
    super('Invalid contact identity command', 'CONTACT_IDENTITY_INVALID', 400);
  }
}

export class ContactIdentityForbiddenError extends ContactIdentityError {
  constructor() {
    super('Forbidden', 'CONTACT_IDENTITY_FORBIDDEN', 403);
  }
}

export class ContactIdentityNotFoundError extends ContactIdentityError {
  constructor() {
    super('Contact identity was not found', 'CONTACT_IDENTITY_NOT_FOUND', 404);
  }
}

export class ContactIdentityConflictError extends ContactIdentityError {
  constructor() {
    super(
      'Contact identity command conflicts with current state',
      'CONTACT_IDENTITY_CONFLICT',
      409,
    );
  }
}
