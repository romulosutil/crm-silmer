/**
 * The conversation port reads order contexts in batches (ADR 018: every
 * pending order re-reads its client). This answers like the PostgreSQL port
 * from a reader of one conversation: unknown ids are left out of the map.
 *
 * @param {(conversationId: string) => Promise<any>|any} readOne
 * @returns {(conversationIds: string[]) => Promise<Map<string, any>>}
 */
export function orderContextsFrom(readOne) {
  return async (conversationIds) => {
    const contexts = new Map();
    for (const conversationId of conversationIds) {
      const context = await readOne(conversationId);
      if (context) contexts.set(conversationId, context);
    }
    return contexts;
  };
}
