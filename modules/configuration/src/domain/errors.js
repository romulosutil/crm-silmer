export class ConfigurationError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ConfigurationValidationError extends ConfigurationError {
  /** @param {string} message */
  constructor(message) {
    super(message, 'CONFIGURATION_INVALID');
  }
}

export class ConfigurationForbiddenError extends ConfigurationError {
  constructor() {
    super(
      'COMMERCIAL_ADMIN is required to change configuration',
      'CONFIGURATION_FORBIDDEN',
    );
  }
}

export class ConfigurationConflictError extends ConfigurationError {
  /**
   * @param {number} expectedVersion
   * @param {number} currentVersion
   */
  constructor(expectedVersion, currentVersion) {
    super(
      `Expected configuration version ${expectedVersion}, current version is ${currentVersion}`,
      'CONFIGURATION_VERSION_CONFLICT',
    );
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}
