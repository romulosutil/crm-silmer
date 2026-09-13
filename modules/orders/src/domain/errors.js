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
 * @typedef {{itemIndex?: number, index?: number}} OrderErrorDetails
 */

/**
 * A rejected business rule (422). `fields` names what the seller has to fix,
 * so the page can show the error next to the field instead of a banner;
 * `itemIndex`/`index` point at the refused grade line.
 */
export class OrderValidationError extends OrderError {
  /**
   * @param {string} message
   * @param {string} code
   * @param {readonly string[]} [fields]
   * @param {OrderErrorDetails} [details]
   */
  constructor(message, code, fields = [], details = {}) {
    super(message, code, 422);
    this.fields = Object.freeze([...fields]);
    if (details.itemIndex !== undefined) this.itemIndex = details.itemIndex;
    if (details.index !== undefined) this.index = details.index;
  }
}

/**
 * A malformed section payload (400). The UI blocks these before sending, so
 * reaching the API means a broken or hostile client.
 */
export class OrderInputError extends OrderError {
  /** @param {string} message @param {readonly string[]} [fields] */
  constructor(message, fields = []) {
    super(message, 'ORDER_INVALID', 400);
    this.fields = Object.freeze([...fields]);
  }
}
