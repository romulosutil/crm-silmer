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
import { operationalDay } from '@crm-silmer/orders';

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
        input.previewToken === null
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
            const order = (
              await tx.query(
                'SELECT number,status,cancelled_at,conversation_id FROM crm.orders WHERE id=$1',
                [input.orderId],
              )
            ).rows[0];
            if (!order) throw new OlistError('ORDER_NOT_FOUND', 404);
            if (order.cancelled_at) throw new OlistError('ORDER_CANCELLED', 409);
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
            ['queued', 'resolving', 'ready'].includes(existing.state) &&
            existing.last_error_code &&
            !/OUTCOME_UNKNOWN|UNCERTAIN|RECONCILIATION_REQUIRED|DIVERGENT|AMBIGUOUS/u.test(
              String(existing.last_error_code),
            )
          ) {
            const safe = (
              await tx.query(
                `SELECT (e.remote_id IS NOT NULL OR e.observed_sale_id IS NOT NULL) AS sale_id,
                  EXISTS (SELECT 1 FROM crm.olist_attempts a WHERE a.export_id=e.id AND a.stage='sale') AS sale_attempt,
                  EXISTS (SELECT 1 FROM crm.olist_export_resources x JOIN crm.olist_resources r ON r.id=x.resource_id AND r.account_key=x.account_key
                    WHERE x.export_id=e.id AND r.state IN ('reserved','uncertain')) AS resource_open,
                  EXISTS (SELECT 1 FROM crm.olist_export_resources x JOIN crm.olist_attempts a ON a.resource_id=x.resource_id AND a.account_key=x.account_key
                    JOIN crm.olist_resources r ON r.id=a.resource_id AND r.account_key=a.account_key
                    WHERE x.export_id=e.id AND (a.outcome='reserved'
                      OR (a.outcome='uncertain' AND NOT (r.state='confirmed' AND r.remote_id IS NOT NULL)))) AS attempt_open,
                  EXISTS (SELECT 1 FROM crm.outbox_jobs j WHERE j.olist_export_id=e.id AND j.status IN ('pending','processing')) AS job_active
                 FROM crm.olist_exports e WHERE e.id=$1 AND e.account_key=$2 FOR UPDATE OF e`,
                [existing.id, config.accountKey],
              )
            ).rows[0];
            if (
              safe &&
              !safe.sale_id &&
              !safe.sale_attempt &&
              !safe.resource_open &&
              !safe.attempt_open &&
              !safe.job_active
            ) {
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
              await tx.query(
                "INSERT INTO crm.audit_events(id,actor_id,action,target_type,target_id,version,reason,correlation_id,occurred_at) VALUES($1,$2,'olist.export.resume','olist-export',$3,$4,'OLIST_EXPORT_RESUMED',$5,$6)",
                [
                  randomUUID(),
                  input.actor.id,
                  retired.id,
                  String(retired.version),
                  String(input.correlationId ?? '').slice(0, 128) || 'olist-resume',
                  acceptedAt,
                ],
              );
              existing = null;
            }
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
