/**
 * @typedef {{ query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>, release: () => void }} DatabaseClient
 * @typedef {{ connect: () => Promise<DatabaseClient> }} DatabasePool
 */

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
  const client = await pool.connect();
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
