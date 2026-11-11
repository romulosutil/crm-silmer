import { createOlistAdministration } from './olist-administration.js';
import { createOlistExportCommand } from './olist-export-command.js';
import { createOlistPreview } from './olist-preview.js';
import {
  PostgresIdempotencyRecordStore,
  fingerprintCommand,
} from '@crm-silmer/integration-reliability';
import {
  createOlistConnection,
  createOlistClient,
  olistConfiguration,
  olistReadWait,
  lockOlistActor,
  OlistError,
  identityHash,
  open,
  olistSettings,
} from '@crm-silmer/olist';
/** @param {any} database @param {{access:any,environment?:Record<string,string|undefined>,fetch?:typeof fetch,clock?:()=>Date,timeoutMs?:number}} options */
export function createOlistApiRuntime(database, options) {
  const env = options.environment ?? process.env;
  const config = olistConfiguration(env);
  const clock = options.clock ?? (() => new Date());
  const connection = createOlistConnection(database, {
    config,
    fetch: options.fetch,
    clock,
    timeoutMs: options.timeoutMs,
  });
  const idemKey = Buffer.from(env.IDEMPOTENCY_ENVELOPE_KEY ?? '', 'base64url');
  const idempotency =
    idemKey.length === 32
      ? new PostgresIdempotencyRecordStore({ database, envelopeKey: idemKey })
      : null;
  /** @param {any} input @param {string} name */
  async function mutate(input, name) {
    // Replay revalidates current authorization before reading a stored response.
    await database.transaction((/** @type {any} */ client) =>
      lockOlistActor(client, input, 'olist.manage', clock()),
    );
    if (!config.configured) throw new OlistError('OLIST_NOT_CONFIGURED', 503);
    if (!idempotency) throw new OlistError('OLIST_NOT_CONFIGURED', 503);
    if (
      typeof input.idempotencyKey !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.idempotencyKey)
    )
      throw new OlistError('INVALID_REQUEST', 400);
    const command =
      name === 'settings'
        ? {
            expectedVersion: input.expectedVersion,
            settings: input.settings,
            reason: input.reason,
          }
        : name === 'creation'
          ? {
              expectedVersion: input.expectedVersion,
              enabled: input.enabled,
              reason: input.reason,
            }
          : name === 'recovery'
            ? {
                expectedVersion: input.expectedVersion,
                confirmed: input.confirmed,
                reason: input.reason,
              }
            : name === 'disconnect'
              ? { expectedVersion: input.expectedVersion, reason: input.reason }
              : {};
    // Include the session so a stored authorize URL cannot cross sessions.
    const fingerprint = identityHash(config.hmacKey, 'command', [
      name,
      input.actor.id,
      input.sessionBinding,
      fingerprintCommand(command),
    ]);
    const scopedDatabase = {
      query: database.query.bind(database),
      transaction: (/** @type {any} */ work) =>
        database.transaction(async (/** @type {any} */ client) => {
          await lockOlistActor(client, input, 'olist.manage', clock());
          return work(client);
        }),
    };
    const store = new PostgresIdempotencyRecordStore({
      database: scopedDatabase,
      envelopeKey: idemKey,
    });
    return store.execute(
      {
        scope: 'olist:' + config.contextKey + ':' + input.actor.id + ':' + name,
        key: input.idempotencyKey,
        fingerprint,
        actor: input.actor.id,
        action: 'olist.' + name,
        target: { type: 'olist-account', id: config.accountKey },
        version: input.expectedVersion ?? 0,
        reason: 'OLIST_' + name.toUpperCase(),
        correlationId: input.correlationId,
      },
      (client) =>
        connection[
          /** @type {'authorize'|'disconnect'|'settings'|'creation'|'recovery'} */ (
            name
          )
        ]({
          ...input,
          transaction: client,
        }),
    );
  }
  /** @param {any} input */
  async function project(input) {
    return database.transaction(async (/** @type {any} */ client) => {
      const actor = await lockOlistActor(
        client,
        input,
        input.action ?? 'olist.read',
        clock(),
      );
      const { rows } = await client.query(
        'SELECT o.id,o.number,o.status,o.manual_owner_id,c.assigned_user_id FROM crm.orders o LEFT JOIN crm.conversations c ON c.id=o.conversation_id WHERE o.id=$1',
        [input.orderId],
      );
      const order = rows[0];
      if (!order) throw new OlistError('ORDER_NOT_FOUND', 404);
      if (
        input.action === 'order.read' &&
        !actor.capabilities.includes('COMMERCIAL_ADMIN') &&
        order.manual_owner_id !== actor.id &&
        order.assigned_user_id !== actor.id
      )
        throw new OlistError('FORBIDDEN', 403);
      // One ACTIVE export per order/account; older generations stay as
      // `invalidated` history. Prefer the active row, else the latest
      // invalidated one (the panel explains why a new preview is possible).
      const exports = await client.query(
        "SELECT id,state,stage,remote_number,last_error_code FROM crm.olist_exports WHERE account_key=$1 AND order_id=$2 ORDER BY (state='invalidated'),created_at DESC,id DESC LIMIT 1",
        [config.accountKey, order.id],
      );
      const operation = exports.rows[0];
      const settingsRow = (
        await client.query(
          'SELECT settings_envelope FROM crm.olist_settings WHERE account_key=$1',
          [config.accountKey],
        )
      ).rows[0];
      const settings =
        config.configured && settingsRow?.settings_envelope
          ? olistSettings(
              open(
                settingsRow.settings_envelope,
                config.envelopeKey,
                'settings',
                config.accountKey,
                'central',
              ),
            )
          : null;
      const availability = (
        await client.query(
          'SELECT a.creation_enabled,a.recovery_required,c.token_envelope IS NOT NULL AS connected,c.reconnect_required,c.expires_at,c.refresh_nonce,c.exchange_nonce FROM crm.olist_accounts a JOIN crm.olist_connections c USING(account_key) WHERE a.account_key=$1 AND c.context_key=$2',
          [config.accountKey, config.contextKey],
        )
      ).rows[0];
      const creationEnabled = Boolean(
        order.status === 'confirmado' &&
        config.configured &&
        actor.olistEnabled &&
        config.pilotUserIds.includes(actor.id) &&
        availability?.creation_enabled &&
        !availability?.recovery_required &&
        availability?.connected &&
        !availability?.exchange_nonce &&
        !availability?.reconnect_required,
      );
      const paymentDuePolicy = settings?.paymentDuePolicy ?? 'fixed_date';
      /** @type {Array<{code:string,field?:string,label:string}>} */
      let pendingFields = creationEnabled
        ? []
        : [
            {
              code: 'OLIST_CREATION_DISABLED',
              label: 'Geração Olist ainda indisponível.',
            },
          ];
      // OLC-T04: the Order detail shows every local pendency of a confirmed
      // order (buyer registration, composition, exact cents) without any ERP
      // call. The administrative lookup keeps its minimal projection.
      if (input.lookup !== true && order.status === 'confirmado') {
        await client.query('SAVEPOINT olist_local_plan');
        try {
          const { plan } = await preview.localPlan({
            ...input,
            transaction: client,
            action: input.action ?? 'olist.read',
          });
          const relevant = (plan.issues ?? []).filter(
            (/** @type {any} */ issue) =>
              !(
                paymentDuePolicy === 'per_order' &&
                issue.field === 'commercial.paymentDueOn'
              ) &&
              !(
                !creationEnabled &&
                String(issue.field ?? '').startsWith('settings.')
              ),
          );
          if (relevant.length > 0) {
            pendingFields = relevant.map((/** @type {any} */ issue) => ({
              code: issue.code,
              field: issue.field,
              label: 'Pendência para gerar no Olist.',
            }));
            if (!creationEnabled) {
              pendingFields.push({
                code: 'OLIST_CREATION_DISABLED',
                field: 'connection',
                label: 'Geração Olist ainda indisponível.',
              });
            }
          }
          await client.query('RELEASE SAVEPOINT olist_local_plan');
        } catch {
          // Keep the fallback pendingFields; the server still validates the
          // export command itself. Undo whatever the failed read touched.
          await client.query('ROLLBACK TO SAVEPOINT olist_local_plan');
        }
      }
      let retrySafe = false;
      if (
        operation?.id &&
        ['queued', 'resolving', 'ready'].includes(operation.state) &&
        operation.last_error_code &&
        !/OUTCOME_UNKNOWN|UNCERTAIN|RECONCILIATION_REQUIRED|DIVERGENT|AMBIGUOUS/u.test(
          String(operation.last_error_code),
        )
      ) {
        await client.query('SAVEPOINT olist_retry_safe');
        try {
          const check = (
            await client.query(
              `SELECT (e.remote_id IS NOT NULL OR e.observed_sale_id IS NOT NULL) AS sale_id,
                EXISTS (SELECT 1 FROM crm.olist_attempts a WHERE a.export_id=e.id AND a.stage='sale') AS sale_attempt,
                EXISTS (SELECT 1 FROM crm.olist_export_resources x JOIN crm.olist_resources r ON r.id=x.resource_id AND r.account_key=x.account_key
                  WHERE x.export_id=e.id AND r.state IN ('reserved','uncertain')) AS resource_open,
                EXISTS (SELECT 1 FROM crm.olist_export_resources x JOIN crm.olist_attempts a ON a.resource_id=x.resource_id AND a.account_key=x.account_key
                  JOIN crm.olist_resources r ON r.id=a.resource_id AND r.account_key=a.account_key
                  WHERE x.export_id=e.id AND (a.outcome='reserved'
                    OR (a.outcome='uncertain' AND NOT (r.state='confirmed' AND r.remote_id IS NOT NULL)))) AS attempt_open,
                EXISTS (SELECT 1 FROM crm.outbox_jobs j WHERE j.olist_export_id=e.id AND j.status IN ('pending','processing')) AS job_active
               FROM crm.olist_exports e WHERE e.id=$1 AND e.account_key=$2`,
              [operation.id, config.accountKey],
            )
          ).rows[0];
          retrySafe = Boolean(
            check &&
              !check.sale_id &&
              !check.sale_attempt &&
              !check.resource_open &&
              !check.attempt_open &&
              !check.job_active,
          );
          await client.query('RELEASE SAVEPOINT olist_retry_safe');
        } catch {
          retrySafe = false;
          await client.query('ROLLBACK TO SAVEPOINT olist_retry_safe');
        }
      }
      return {
        orderId: order.id,
        number: order.number,
        status: order.status,
        creationEnabled:
          creationEnabled && operation?.state !== 'legacy_review_required',
        paymentDuePolicy,
        productFiscalRequired: false,
        productFiscalDeferred:
          settings?.productFiscal === null ||
          settings?.productFiscal === undefined,
        pendingFields,
        operation: operation
          ? {
              state: operation.state,
              stage: operation.stage,
              number: operation.remote_number ?? null,
              ...(operation.last_error_code
                ? { errorCode: operation.last_error_code }
                : {}),
              ...(retrySafe ? { retrySafe: true } : {}),
            }
          : null,
      };
    });
  }
  const preview = createOlistPreview(database, {
    config,
    connection,
    environment: env,
    clock,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  });
  return Object.freeze({
    /** @param {any} input */ authorizeRead: (input) =>
      options.access.authorizeRead(input),
    /** @param {any} input */ authorizeWrite: (input) =>
      options.access.authorizeWrite(input),
    status: connection.status,
    /** @param {any} input */ authorize: (input) => mutate(input, 'authorize'),
    complete: connection.complete,
    /** @param {any} input */ disconnect: (input) =>
      mutate(input, 'disconnect'),
    /** @param {any} input */ settings: (input) => mutate(input, 'settings'),
    /** @param {any} input */ creation: (input) => mutate(input, 'creation'),
    /** @param {any} input */ recovery: (input) => mutate(input, 'recovery'),
    preview: preview.preview,
    checkPreview: preview.checkPreview,
    ...createOlistExportCommand(database, {
      config,
      preview,
      environment: env,
      clock,
    }),
    ...createOlistAdministration(database, {
      config,
      connection,
      preview,
      environment: env,
      clock,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
    }),
    project,
    /** @param {any} input */
    async lookup(input) {
      if (typeof input.query !== 'string' || input.query.length > 64)
        throw new OlistError('INVALID_REQUEST', 400);
      const query = input.query.trim();
      if (
        !/^(?:[0-9]{2,15}-CRM|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.test(
          query,
        )
      )
        throw new OlistError('INVALID_REQUEST', 400);
      const orderId = await database.transaction(
        async (/** @type {any} */ client) => {
          await lockOlistActor(client, input, 'olist.export', clock());
          const { rows } = await client.query(
            'SELECT id FROM crm.orders WHERE number=$1 OR id=$1',
            [query],
          );
          if (rows.length !== 1) throw new OlistError('ORDER_NOT_FOUND', 404);
          return rows[0].id;
        },
      );
      return project({ ...input, orderId, action: 'olist.read', lookup: true });
    },
    /** @param {any} input */
    async lookups(input) {
      const client = createOlistClient({
        credentials: () => connection.credentials(input),
        quota: connection.quota,
        readWait: olistReadWait('api'),
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        onAuthFailure: (version) => connection.authFailure(input, version),
      });
      return { items: await client.catalog(input.kind) };
    },
    /** @param {any} input */
    async mappings(input) {
      if (
        typeof input.resourceId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
          input.resourceId,
        )
      )
        throw new OlistError('INVALID_REQUEST', 400);
      return database.transaction(async (/** @type {any} */ client) => {
        await lockOlistActor(client, input, 'olist.manage', clock());
        const { rows } = await client.query(
          'SELECT id,kind,state,remote_id FROM crm.olist_resources WHERE id=$1 AND account_key=$2',
          [input.resourceId, config.accountKey],
        );
        if (!rows[0]) throw new OlistError('OLIST_RESOURCE_NOT_FOUND', 404);
        return {
          id: rows[0].id,
          kind: rows[0].kind,
          state: rows[0].state,
          remoteId: rows[0].remote_id,
        };
      });
    },
  });
}
