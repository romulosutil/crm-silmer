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

export class CatalogValidationError extends CatalogError {
  /** @param {string} message */
  constructor(message) {
    super(message, 'CATALOG_INVALID');
  }
}
