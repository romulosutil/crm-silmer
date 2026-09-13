export class OrderError extends Error {
  /**
   * `statusCode` and `code` are what the HTTP boundary reads to classify a
   * failure, the same contract the inbox domain errors follow.
   *
   * @param {string} message @param {string} code @param {number} statusCode
   */
  constructor(message, code, statusCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * A rejected input. `fields` names what the seller has to fix, so the page can
 * show the error next to the field instead of a generic banner.
 */
export class OrderValidationError extends OrderError {
  /**
   * @param {string} message
   * @param {string} code
   * @param {readonly string[]} [fields]
   */
  constructor(message, code, fields = []) {
    super(message, code, 422);
    this.fields = Object.freeze([...fields]);
  }
}
