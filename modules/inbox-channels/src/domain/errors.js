export class InboxError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InboxValidationError extends InboxError {
  /** @param {string} message */
  constructor(message) {
    super(message, 'INBOX_INVALID');
  }
}

export class InboxForbiddenError extends InboxError {
  constructor() {
    super(
      'A human actor is required for this inbox mutation',
      'INBOX_FORBIDDEN',
    );
  }
}

export class InboxConflictError extends InboxError {
  /** @param {string} [message] */
  constructor(message = 'The inbox resource changed before this command') {
    super(message, 'INBOX_CONFLICT');
  }
}
