export class PostgresOperationalUserPort {
  /** @param {{userId: string}} input @param {{transaction: any}} context */
  async lockActive(input, context) {
    const database = queryable(context);
    const result = await database.query(
      `SELECT users.id, users.disabled_at, functions.function_name
       FROM crm.users AS users
       JOIN crm.user_functions AS functions ON functions.user_id = users.id
       WHERE users.id = $1
       FOR SHARE OF users, functions`,
      [input.userId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.disabled_at ||
      !['Atendimento', 'Vendedor'].includes(row.function_name)
    ) {
      return null;
    }
    return Object.freeze({ id: row.id, functionName: row.function_name });
  }
}

/** @param {any} context */
function queryable(context) {
  if (
    !context?.transaction ||
    typeof context.transaction.query !== 'function'
  ) {
    throw new TypeError('context.transaction must implement query');
  }
  return context.transaction;
}
