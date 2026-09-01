export class CatalogError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class CatalogForbiddenError extends CatalogError {
  constructor() {
    super('Publishing requires COMMERCIAL_ADMIN', 'CATALOG_FORBIDDEN');
  }
}

export class CatalogConflictError extends CatalogError {
  /** @param {number} expectedLatestNumber @param {number} currentLatestNumber */
  constructor(expectedLatestNumber, currentLatestNumber) {
    super(
      `Expected latest catalog number ${expectedLatestNumber}, current latest number is ${currentLatestNumber}`,
      'CATALOG_VERSION_CONFLICT',
    );
    this.expectedLatestNumber = expectedLatestNumber;
    this.currentLatestNumber = currentLatestNumber;
  }
}

export class CatalogValidationError extends CatalogError {
  /** @param {string} message */
  constructor(message) {
    super(message, 'CATALOG_INVALID');
  }
}
