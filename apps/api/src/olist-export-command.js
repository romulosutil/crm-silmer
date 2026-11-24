import { randomUUID } from 'node:crypto';
import {
  PostgresIdempotencyRecordStore,
  fingerprintCommand,
} from '@crm-silmer/integration-reliability';
import {
  createOlistRepository,
  assertOlistPilotActor,
  assertOlistOrderCommercialRead,
  lockOlistActor,
  identityHash,
  OlistError,
  olistSettings,
  olistNewSendBuyerBlocked,
} from '@crm-silmer/olist';
import { operationalDay, orderReadable } from '@crm-silmer/orders';

const UNSAFE_RETRY_ERROR_CODE =
  /OUTCOME_UNKNOWN|UNCERTAIN|RECONCILIATION_REQUIRED|DIVERGENT|AMBIGUOUS|ALREADY_EXISTS|READBACK|MISMATCH|PERSISTENCE_FAILED|DISPATCH_FAILED|INCOMPLETE_LOOKUP|RESOURCE_UNAVAILABLE|REQUEST_CHANGED|ALREADY_RESERVED|LEGACY_REVIEW/u;

/** SQL proof that a stopped export generation never started any sale attempt,
 * has no open/uncertain resources or attempts, and has no active/unknown job.
 * @param {any} client
 * @param {{exportId:string,accountKey:string,errorCode:unknown,lock?:boolean}} input */
export async function isExportSafeToRetry(client, input) {
  if (
    !input.exportId ||
    !input.errorCode ||
    UNSAFE_RETRY_ERROR_CODE.test(String(input.errorCode))
  )
    return false;
  const check = (
    await client.query(
      `SELECT e.state,
        (e.remote_id IS NOT NULL OR e.observed_sale_id IS NOT NULL) AS sale_id,
        EXISTS (SELECT 1 FROM crm.olist_attempts a WHERE a.export_id=e.id AND a.stage='sale') AS sale_attempt,
        EXISTS (SELECT 1 FROM crm.olist_export_resources x JOIN crm.olist_resources r ON r.id=x.resource_id AND r.account_key=x.account_key
          WHERE x.export_id=e.id AND r.state IN ('reserved','uncertain')) AS resource_open,
        EXISTS (SELECT 1 FROM crm.olist_export_resources x JOIN crm.olist_attempts a ON a.resource_id=x.resource_id AND a.account_key=x.account_key
          JOIN crm.olist_resources r ON r.id=a.resource_id AND r.account_key=a.account_key
          WHERE x.export_id=e.id AND (a.outcome='reserved'
            OR (a.outcome='uncertain' AND NOT (r.state='confirmed' AND r.remote_id IS NOT NULL)))) AS attempt_open,
        EXISTS (SELECT 1 FROM crm.outbox_jobs j WHERE j.olist_export_id=e.id AND j.status IN ('pending','processing','retry','outcome_unknown')) AS job_active
       FROM crm.olist_exports e WHERE e.id=$1 AND e.account_key=$2${input.lock ? ' FOR NO KEY UPDATE OF e' : ''}`,
      [input.exportId, input.accountKey],
    )
  ).rows[0];
  return Boolean(
    check &&
    ['queued', 'resolving', 'ready'].includes(check.state) &&
    !check.sale_id &&
    !check.sale_attempt &&
    !check.resource_open &&
    !check.attempt_open &&
    !check.job_active,
  );
}

/** Local human command only. T08 owns dispatch. Current authority, receipt,
 * snapshot, outbox, audit and idempotency completion share one SQL client.
 * @param {any} database @param {{config:any,preview:any,environment:Record<string,string|undefined>,clock:()=>Date}} options */
export function createOlistExportCommand(
  database,
  { config, preview, environment, clock },
) {
  const key = Buffer.from(
    environment.IDEMPOTENCY_ENVELOPE_KEY ?? '',
    'base64url',
  );
  const repository = createOlistRepository(database, {
    envelopeKey: config.envelopeKey,
    hmacKey: config.hmacKey,
    pilotUserIds: config.pilotUserIds,
    clock,
  });
  /** Tokens carry only server-owned data. Random IVs, actors, sessions and
   * preview time are excluded from the logical operation's fingerprint.
   * @param {any} input @param {any} receipt */
  function operationFingerprint(input, receipt) {
    if (
      receipt.policy !== 'exact-cent-v1' ||
      !receipt.sourceVersions ||
      !receipt.customer ||
      !receipt.commercial ||
      !receipt.settings
    )
      throw new OlistError('OLIST_PREVIEW_INVALID', 409);
    const settings = olistSettings(receipt.settings);
    return identityHash(
      config.hmacKey,
      'export-semantic',
      fingerprintCommand({
        account: config.accountKey,
        context: config.contextKey,
        orderId: input.orderId,
        orderVersion: receipt.binding.orderVersion,
        sourceVersions: receipt.sourceVersions,
        settingsVersion: receipt.binding.settingsVersion,
        settings,
        policy: receipt.policy,
        customer: receipt.customer,
        buyerSource: receipt.buyerSource ?? null,
        productFiscal: receipt.productFiscal ?? null,
        productFiscalDeferred: receipt.productFiscalDeferred === true,
        commercial: {
          ...receipt.commercial,
          orderDate: receipt.binding.proposedDay
            ? null
            : receipt.commercial.orderDate,
        },
      }),
    );
  }
  /** @param {any} row @param {string} number */
  function response(row, number) {
    return {
      operationId: row.id,
      orderId: row.order_id,
      number,
      state: row.state,
      stage: row.stage,
      creationEnabled: true,
    };
  }
  return Object.freeze({
    /** @param {any} input */
    async exportOrder(input) {
      const hasPreviewToken =
        input.previewToken !== undefined && input.previewToken !== null;
      if (
        Object.hasOwn(input, 'productFiscal') ||
        Object.hasOwn(input, 'buyerSource') ||
        Object.hasOwn(input, 'productFiscalDeferred') ||
        (hasPreviewToken && Object.hasOwn(input, 'paymentDueOn'))
      )
        throw new OlistError('INVALID_REQUEST', 400);
      assertOlistPilotActor(config.pilotUserIds, input);
      if (!config.configured || key.length !== 32)
        throw new OlistError('OLIST_NOT_CONFIGURED', 503);
      if (
        typeof input.idempotencyKey !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.idempotencyKey) ||
        typeof input.orderId !== 'string' ||
        input.orderId.length < 1 ||
        input.orderId.length > 200 ||
        (hasPreviewToken &&
          (typeof input.previewToken !== 'string' ||
            input.previewToken.length > 262144 ||
            !/^[A-Za-z0-9_-]+$/u.test(input.previewToken))) ||
        input.previewToken === null ||
        (!hasPreviewToken &&
          Object.hasOwn(input, 'paymentDueOn') &&
          input.paymentDueOn !== undefined &&
          (typeof input.paymentDueOn !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/u.test(input.paymentDueOn)))
      )
        throw new OlistError('INVALID_REQUEST', 400);
      /** @type {any} */
      let existing;
      let number = '';
      const base = {
        ...input,
        accountKey: config.accountKey,
        contextKey: config.contextKey,
      };
      const scoped = {
        query: database.query.bind(database),
        transaction: (/** @type {any} */ work) =>
          database.transaction(async (/** @type {any} */ tx) => {
            const actor = await lockOlistActor(
              tx,
              input,
              'olist.export',
              clock(),
            );
            // OLC-02: checkbox plus the existing commercial read of the Order.
            assertOlistOrderCommercialRead(actor);
            // Orders mutations lock conversation before order. Prelock it here
            // so snapshot reads never invert that order or upgrade a shared lock.
            // WAP-07/08: a seller never sends the order of a Contact that
            // seller may not read; it is not found, as in the preview.
            const order = (
              await tx.query(
                `SELECT number,status,cancelled_at,conversation_id FROM crm.orders WHERE id=$1
                   AND ($2::text IS NULL OR ${orderReadable('orders', '$2')})`,
                [
                  input.orderId,
                  actor.functionName === 'Vendedor' ? actor.id : null,
                ],
              )
            ).rows[0];
            if (!order) throw new OlistError('ORDER_NOT_FOUND', 404);
            if (order.cancelled_at)
              throw new OlistError('ORDER_CANCELLED', 409);
            if (order.status !== 'confirmado')
              throw new OlistError('ORDER_NOT_CONFIRMED', 409);
            if (order.conversation_id)
              await tx.query(
                'SELECT id FROM crm.conversations WHERE id=$1 FOR SHARE',
                [order.conversation_id],
              );
            existing = await repository.findExport({
              ...base,
              transaction: tx,
            });
            if (
              existing &&
              existing.actor_id === actor.id &&
              Number(existing.authorization_version) !==
                actor.olistAuthorizationVersion
            )
              throw new OlistError('FORBIDDEN', 403);
            number = order.number;
            const locked = (
              await tx.query(
                'SELECT conversation_id FROM crm.orders WHERE id=$1',
                [input.orderId],
              )
            ).rows[0];
            if (locked.conversation_id !== order.conversation_id)
              throw new OlistError('OLIST_PREVIEW_STALE', 409);
            return work(tx);
          }),
      };
      const store = new PostgresIdempotencyRecordStore({
        database: scoped,
        envelopeKey: key,
      });
      return store.execute(
        {
          scope:
            'olist:' + config.contextKey + ':' + input.actor.id + ':export',
          key: input.idempotencyKey,
          fingerprint: identityHash(
            config.hmacKey,
            'export-request',
            hasPreviewToken
              ? [
                  input.actor.id,
                  input.sessionBinding,
                  input.orderId,
                  input.previewToken,
                ]
              : [
                  input.actor.id,
                  input.sessionBinding,
                  input.orderId,
                  'direct-order-export-v1',
                  fingerprintCommand({
                    paymentDueOn: input.paymentDueOn ?? null,
                  }),
                ],
          ),
          actor: input.actor.id,
          action: 'olist.export.request',
          target: { type: 'order', id: input.orderId },
          version: 0,
          reason: 'OLIST_EXPORT_REQUESTED',
          correlationId: input.correlationId,
        },
        async (tx) => {
          const acceptedAt = clock();
          let receipt;
          let current;
          if (hasPreviewToken) {
            receipt = preview.readReceipt(input);
            if (olistNewSendBuyerBlocked(receipt))
              throw new OlistError('OLIST_CUSTOMER_INVALID', 409);
            const semantic = operationFingerprint(input, receipt);
            if (existing) {
              if (existing.command_fingerprint !== semantic)
                throw new OlistError('OLIST_EXPORT_CONFLICT', 409);
              return response(existing, number);
            }
            current = await preview.assertFreshReceipt(
              { ...input, transaction: tx },
              receipt,
            );
          } else {
            ({ current, receipt } = await preview.prepareDirectReceipt(
              { ...input, transaction: tx },
              acceptedAt,
            ));
          }
          const semantic = operationFingerprint(input, receipt);
          if (
            existing &&
            !hasPreviewToken &&
            (await isExportSafeToRetry(tx, {
              exportId: existing.id,
              accountKey: config.accountKey,
              errorCode: existing.last_error_code,
              lock: true,
            }))
          ) {
            await tx.query(
              'SELECT r.id FROM crm.olist_resources r JOIN crm.olist_export_resources x ON x.resource_id=r.id AND x.account_key=r.account_key WHERE x.export_id=$1 AND r.account_key=$2 ORDER BY r.id FOR SHARE OF r',
              [existing.id, config.accountKey],
            );
            const job = (
              await tx.query(
                "SELECT id,status FROM crm.outbox_jobs WHERE olist_export_id=$1 AND job_type='olist.export' FOR UPDATE",
                [existing.id],
              )
            ).rows[0];
            if (
              job &&
              ['pending', 'processing', 'retry', 'outcome_unknown'].includes(
                String(job.status),
              )
            )
              throw new OlistError('OLIST_EXPORT_CONFLICT', 409);
            // OLC-10/OLC-16: the stopped generation provably had no effect
            // (no sale attempt, no open resource, no active job). It is
            // retired as terminal history and a new generation is queued;
            // confirmed resources are reused by identity, never re-posted.
            const retired = (
              await tx.query(
                "UPDATE crm.olist_exports SET state='invalidated',last_error_code='OLIST_EXPORT_RESUMED',version=version+1,updated_at=$2 WHERE id=$1 AND state IN ('queued','resolving','ready') RETURNING id,version",
                [existing.id, acceptedAt],
              )
            ).rows[0];
            if (!retired) throw new OlistError('OLIST_EXPORT_CONFLICT', 409);
            if (job?.status === 'dead_letter') {
              await tx.query(
                "UPDATE crm.outbox_jobs SET status='completed',locked_by=NULL,locked_until=NULL,heartbeat_at=NULL,updated_at=greatest(updated_at,$2),completed_at=$2,last_error_code=COALESCE(last_error_code,'OLIST_EXPORT_RESUMED') WHERE id=$1 AND status='dead_letter'",
                [job.id, acceptedAt],
              );
              await tx.query(
                "UPDATE crm.reconciliation_items SET status='resolved',resolved_at=greatest(created_at,$2) WHERE job_id=$1 AND status='open'",
                [job.id, acceptedAt],
              );
            }
            const correlation =
              String(input.correlationId ?? '').slice(0, 128) || 'olist-resume';
            await tx.query(
              "INSERT INTO crm.olist_events(id,account_key,export_id,resource_id,actor_id,event_code,version,correlation_id,occurred_at) VALUES($1,$2,$3,NULL,$4,'OLIST_EXPORT_RESUMED',$5,$6,$7)",
              [
                randomUUID(),
                config.accountKey,
                retired.id,
                input.actor.id,
                Number(retired.version),
                correlation,
                acceptedAt,
              ],
            );
            await tx.query(
              "INSERT INTO crm.audit_events(id,actor_id,action,target_type,target_id,version,reason,correlation_id,occurred_at) VALUES($1,$2,'olist.export.resume','olist-export',$3,$4,'OLIST_EXPORT_RESUMED',$5,$6)",
              [
                randomUUID(),
                input.actor.id,
                retired.id,
                String(retired.version),
                correlation,
                acceptedAt,
              ],
            );
            existing = null;
          }
          if (existing) {
            if (existing.command_fingerprint !== semantic)
              throw new OlistError('OLIST_EXPORT_CONFLICT', 409);
            return response(existing, number);
          }
          const proposedDay = receipt.binding.proposedDay;
          if (proposedDay && proposedDay !== operationalDay(acceptedAt))
            throw new OlistError('OLIST_PREVIEW_STALE', 409);
          // Explicit allowlist: no binding/session data, ficha, notes, AI or file.
          const snapshot = {
            policy: receipt.policy,
            customer: structuredClone(receipt.customer),
            buyerSource: structuredClone(receipt.buyerSource ?? null),
            commercial: {
              ...structuredClone(receipt.commercial),
              orderDate:
                current.source.order.orderDate ?? operationalDay(acceptedAt),
            },
            sourceVersions: structuredClone(current.sourceVersions),
            productFiscal: structuredClone(receipt.productFiscal ?? null),
            productFiscalDeferred: receipt.productFiscalDeferred === true,
            settings: olistSettings(current.settings),
            registrations: structuredClone(receipt.registrations),
            acceptedAt: acceptedAt.toISOString(),
          };
          const row = await repository.prepareExport({
            ...base,
            transaction: tx,
            orderVersion: current.binding.orderVersion,
            settingsVersion: current.binding.settingsVersion,
            authorizationVersion: current.binding.authorizationVersion,
            connectionGeneration: current.binding.connectionGeneration,
            connectionVersion: current.binding.connectionVersion,
            snapshot,
            snapshotFingerprint: semantic,
          });
          return response(row, number);
        },
      );
    },
  });
}
