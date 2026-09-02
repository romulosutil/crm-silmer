/**
 * @typedef {{ query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>, release: () => void }} DatabaseClient
 * @typedef {{ connect: () => Promise<DatabaseClient> }} DatabasePool
 */

export class DatabaseConnectionTimeoutError extends Error {
  /** @param {{cause?: unknown}} [options] */
  constructor(options = {}) {
    super('Database connection acquisition timed out', options);
    this.name = 'DatabaseConnectionTimeoutError';
    this.code = 'DATABASE_CONNECTION_TIMEOUT';
  }
}

/**
 * Runs domain work in one PostgreSQL transaction. A rollback failure never
 * replaces the original application error.
 *
 * @template T
 * @template {DatabaseClient} Client
 * @param {{ connect: () => Promise<Client> }} pool
 * @param {(client: Client) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(pool, work) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    if (
      error instanceof Error &&
      /timeout exceeded when trying to connect/iu.test(error.message)
    ) {
      throw new DatabaseConnectionTimeoutError({ cause: error });
    }
    throw error;
  }
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the error that made the transaction fail.
    }
    throw error;
  } finally {
    client.release();
  }
}
