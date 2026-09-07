import {
  emptyQualificationState,
  evaluateQualificationState,
} from './in-memory-qualification-repository.js';
import {
  isAssessmentApplicable,
  resolveFieldDefinition,
} from './field-registry.js';

const PIECE_COLORS = [
  'front',
  'back',
  'rightSleeve',
  'leftSleeve',
  'collarTrim',
  'sleeveTrim',
];

export class PostgresQualificationRepository {
  /** @param {{cipher: any}} input */
  constructor({ cipher }) {
    this.cipher = cipher;
  }

  /** @param {QualificationPatch} input @param {any} context */
  async applyPatch(input, context) {
    const database = queryable(context);
    const fields = input.fields;
    if (fields.order) await this.#replaceOrder(database, input);
    if (fields.items) await this.#replaceItems(database, input);
    if (fields.artwork) await this.#replaceArtwork(database, input);
    if (fields.logistics) await this.#replaceLogistics(database, input);
    if (fields.observations) await this.#replaceObservations(database, input);
    if (fields.assessments) await this.#appendAssessments(database, input);
    await database.query(
      `INSERT INTO crm.qualification_changes
         (deal_id, resulting_version, reason_code, reason_detail_envelope,
          fields_fingerprint, actor_id, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [
        input.dealId,
        input.resultingVersion,
        input.reasonCode,
        input.reasonDetail
          ? json(
              this.#encrypt(
                input.reasonDetail,
                input.dealId,
                `changes.${input.resultingVersion}.reasonDetail`,
              ),
            )
          : null,
        input.fieldsFingerprint,
        input.actorId,
        input.correlationId,
        input.occurredAt,
      ],
    );
  }

  /** @param {{dealId: string, stage: string}} input @param {any} context */
  async evaluateGate({ dealId, stage }, context) {
    return evaluateQualificationState(
      await this.#load(queryable(context), dealId),
      stage,
    );
  }

  /** @param {string} dealId @param {any} context */
  async evaluateAll(dealId, context) {
    const state = await this.#load(queryable(context), dealId);
    return Object.fromEntries(
      ['produto', 'especificacao', 'estampa', 'logistica'].map((stage) => [
        stage,
        evaluateQualificationState(state, stage),
      ]),
    );
  }

  /** @param {string} dealId @param {any} context */
  async getProjection(dealId, context) {
    const state = await this.#load(queryable(context), dealId);
    return {
      totalQuantity: state.items.reduce(
        (/** @type {number} */ total, /** @type {any} */ item) =>
          total + (Number(item.estimatedQuantity) || 0),
        0,
      ),
    };
  }

  /** @param {any} database @param {QualificationPatch} input */
  async #replaceOrder(database, input) {
    const order = input.fields.order;
    if (!order) throw new TypeError('order is required');
    await database.query(
      `INSERT INTO crm.deal_qualification
         (deal_id, customer_envelope, order_name_envelope, commercial_intent, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)
       ON CONFLICT (deal_id) DO UPDATE SET
         customer_envelope = COALESCE(EXCLUDED.customer_envelope, crm.deal_qualification.customer_envelope),
         order_name_envelope = COALESCE(EXCLUDED.order_name_envelope, crm.deal_qualification.order_name_envelope),
         commercial_intent = COALESCE(EXCLUDED.commercial_intent, crm.deal_qualification.commercial_intent),
         updated_at = EXCLUDED.updated_at`,
      [
        input.dealId,
        order.customer === undefined
          ? null
          : json(this.#encrypt(order.customer, input.dealId, 'order.customer')),
        order.name === undefined
          ? null
          : json(this.#encrypt(order.name, input.dealId, 'order.name')),
        order.commercialIntent ?? null,
        input.occurredAt,
      ],
    );
  }

  /** @param {any} database @param {QualificationPatch} input */
  async #replaceItems(database, input) {
    const items = input.fields.items;
    if (!items) throw new TypeError('items are required');
    const positionResult = await database.query(
      'SELECT COALESCE(MAX(position), -1) AS position FROM crm.deal_items WHERE deal_id = $1',
      [input.dealId],
    );
    let nextPosition = Number(positionResult.rows[0].position) + 1;
    for (const [patchIndex, item] of items.entries()) {
      const existing = await database.query(
        'SELECT deal_id, position FROM crm.deal_items WHERE id = $1 FOR UPDATE',
        [item.id],
      );
      if (existing.rows[0] && existing.rows[0].deal_id !== input.dealId) {
        throw invalid('Item does not belong to Deal');
      }
      if (item.operation === 'remove') {
        const referenced = await database.query(
          'SELECT 1 FROM crm.artwork_files WHERE deal_id = $1 AND item_id = $2',
          [input.dealId, item.id],
        );
        if (referenced.rows.length > 0)
          throw invalid('Referenced items cannot be removed');
        await database.query(
          'DELETE FROM crm.deal_items WHERE deal_id = $1 AND id = $2',
          [input.dealId, item.id],
        );
        continue;
      }
      const snapshot = input.catalogs.items[patchIndex];
      const selectionTouched = [
        'catalogVersionId',
        'productCode',
        'modelCode',
        'fabrics',
      ].some((field) => item[field] !== undefined);
      await database.query(
        `INSERT INTO crm.deal_items
           (id, deal_id, catalog_version_id, catalog_version_number,
            product_code, product_snapshot, model_code, model_snapshot,
            estimated_quantity, position)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           catalog_version_id = CASE WHEN $11 THEN EXCLUDED.catalog_version_id ELSE crm.deal_items.catalog_version_id END,
           catalog_version_number = CASE WHEN $11 THEN EXCLUDED.catalog_version_number ELSE crm.deal_items.catalog_version_number END,
           product_code = CASE WHEN $11 THEN EXCLUDED.product_code ELSE crm.deal_items.product_code END,
           product_snapshot = CASE WHEN $11 THEN EXCLUDED.product_snapshot ELSE crm.deal_items.product_snapshot END,
           model_code = CASE WHEN $11 THEN EXCLUDED.model_code ELSE crm.deal_items.model_code END,
           model_snapshot = CASE WHEN $11 THEN EXCLUDED.model_snapshot ELSE crm.deal_items.model_snapshot END,
           estimated_quantity = COALESCE(EXCLUDED.estimated_quantity, crm.deal_items.estimated_quantity)`,
        [
          item.id,
          input.dealId,
          snapshot?.catalogVersionId ?? null,
          snapshot?.catalogVersionNumber ?? null,
          snapshot ? item.productCode : null,
          snapshot ? json(snapshot.product) : null,
          snapshot ? item.modelCode : null,
          snapshot ? json(snapshot.model) : null,
          item.estimatedQuantity ?? null,
          existing.rows[0]?.position ?? nextPosition++,
          selectionTouched,
        ],
      );
      if (selectionTouched) {
        await database.query(
          'DELETE FROM crm.item_fabrics WHERE item_id = $1',
          [item.id],
        );
        if (item.fabrics && snapshot) {
          for (const [fabricPosition, code] of item.fabrics.entries()) {
            await database.query(
              `INSERT INTO crm.item_fabrics (item_id, material_code, material_snapshot, position)
               VALUES ($1, $2, $3::jsonb, $4)`,
              [
                item.id,
                code,
                json(
                  /** @type {any[]} */ (snapshot.materials).find(
                    (value) => value.code === code,
                  ),
                ),
                fabricPosition,
              ],
            );
          }
        }
      }
      if (item.colors) {
        for (const key of PIECE_COLORS) {
          if (item.colors[key] === undefined) continue;
          await database.query(
            `INSERT INTO crm.item_piece_colors (item_id, field_key, value_envelope)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (item_id, field_key) DO UPDATE SET
               value_envelope = EXCLUDED.value_envelope`,
            [
              item.id,
              key,
              json(
                this.#encrypt(
                  item.colors[key],
                  input.dealId,
                  `items.${item.id}.colors.${key}`,
                ),
              ),
            ],
          );
        }
      }
      if (item.grade) {
        await database.query('DELETE FROM crm.grade_lines WHERE item_id = $1', [
          item.id,
        ]);
        for (const [linePosition, line] of item.grade.entries()) {
          await database.query(
            `INSERT INTO crm.grade_lines
               (item_id, position, size_lookup, size_envelope, quantity, duplicate_reason_envelope)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)`,
            [
              item.id,
              linePosition,
              line.size.trim().toLocaleLowerCase('pt-BR'),
              json(
                this.#encrypt(
                  line.size,
                  input.dealId,
                  `items.${item.id}.grade.${linePosition}.size`,
                ),
              ),
              line.quantity,
              line.duplicateSizeReason
                ? json(
                    this.#encrypt(
                      line.duplicateSizeReason,
                      input.dealId,
                      `items.${item.id}.grade.${linePosition}.duplicateSizeReason`,
                    ),
                  )
                : null,
            ],
          );
        }
      }
    }
  }

  /** @param {any} database @param {QualificationPatch} input */
  async #replaceArtwork(database, input) {
    const artwork = input.fields.artwork;
    if (!artwork) throw new TypeError('artwork is required');
    const snapshot = input.catalogs.artwork;
    const selectionTouched = ['catalogVersionId', 'techniqueCode'].some(
      (field) => artwork[field] !== undefined,
    );
    if (artwork.status === 'not_applicable') {
      await database.query('DELETE FROM crm.artwork WHERE deal_id = $1', [
        input.dealId,
      ]);
    }
    await database.query(
      `INSERT INTO crm.artwork
         (deal_id, status, responsibility_envelope, catalog_version_id,
          catalog_version_number, technique_code, technique_snapshot, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (deal_id) DO UPDATE SET
         status = COALESCE(EXCLUDED.status, crm.artwork.status),
         responsibility_envelope = COALESCE(EXCLUDED.responsibility_envelope, crm.artwork.responsibility_envelope),
         catalog_version_id = CASE WHEN $9 THEN EXCLUDED.catalog_version_id ELSE crm.artwork.catalog_version_id END,
         catalog_version_number = CASE WHEN $9 THEN EXCLUDED.catalog_version_number ELSE crm.artwork.catalog_version_number END,
         technique_code = CASE WHEN $9 THEN EXCLUDED.technique_code ELSE crm.artwork.technique_code END,
         technique_snapshot = CASE WHEN $9 THEN EXCLUDED.technique_snapshot ELSE crm.artwork.technique_snapshot END,
         updated_at = EXCLUDED.updated_at`,
      [
        input.dealId,
        artwork.status,
        artwork.responsibility
          ? json(
              this.#encrypt(
                artwork.responsibility,
                input.dealId,
                'artwork.responsibility',
              ),
            )
          : null,
        snapshot?.catalogVersionId ?? null,
        snapshot?.catalogVersionNumber ?? null,
        snapshot ? artwork.techniqueCode : null,
        snapshot?.technique ? json(snapshot.technique) : null,
        input.occurredAt,
        selectionTouched,
      ],
    );
    if (artwork.locations) {
      const referenced = await database.query(
        `SELECT DISTINCT location_id FROM crm.artwork_files WHERE deal_id = $1`,
        [input.dealId],
      );
      const incoming = new Set(
        artwork.locations.map((/** @type {any} */ location) => location.id),
      );
      if (
        referenced.rows.some(
          (/** @type {any} */ row) => !incoming.has(row.location_id),
        )
      ) {
        throw invalid('Referenced artwork locations cannot be removed');
      }
      await database.query(
        `DELETE FROM crm.artwork_colors
         WHERE deal_id = $1 AND NOT (location_id = ANY($2::text[]))`,
        [input.dealId, [...incoming]],
      );
      await database.query(
        `DELETE FROM crm.artwork_locations
         WHERE deal_id = $1 AND NOT (id = ANY($2::text[]))`,
        [input.dealId, [...incoming]],
      );
      for (const [position, location] of artwork.locations.entries()) {
        await database.query(
          `INSERT INTO crm.artwork_locations (deal_id, id, name_envelope, position)
           VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (deal_id, id) DO UPDATE SET
             name_envelope = EXCLUDED.name_envelope,
             position = EXCLUDED.position`,
          [
            input.dealId,
            location.id,
            json(
              this.#encrypt(
                location.name,
                input.dealId,
                `artwork.locations.${location.id}`,
              ),
            ),
            position,
          ],
        );
      }
    }
    if (artwork.files) {
      await database.query('DELETE FROM crm.artwork_files WHERE deal_id = $1', [
        input.dealId,
      ]);
      for (const file of artwork.files) {
        await database.query(
          `INSERT INTO crm.artwork_files
           (deal_id, item_id, location_id, attachment_message_id, attachment_media_id)
         VALUES ($1, $2, $3, $4, $5)`,
          [
            input.dealId,
            file.itemId,
            file.locationId,
            file.attachmentId.messageId,
            file.attachmentId.transientMediaId,
          ],
        );
      }
    }
    if (artwork.colors) {
      await database.query(
        'DELETE FROM crm.artwork_colors WHERE deal_id = $1',
        [input.dealId],
      );
      for (const [position, colors] of artwork.colors.entries()) {
        await database.query(
          `INSERT INTO crm.artwork_colors (deal_id, location_id, values_envelope)
         VALUES ($1, $2, $3::jsonb)`,
          [
            input.dealId,
            colors.locationId,
            json(
              this.#encrypt(
                JSON.stringify(colors.values),
                input.dealId,
                `artwork.colors.${position}`,
              ),
            ),
          ],
        );
      }
    }
  }

  /** @param {any} database @param {QualificationPatch} input */
  async #replaceLogistics(database, input) {
    const value = input.fields.logistics;
    if (!value) throw new TypeError('logistics is required');
    /** @param {string} key */
    const encrypted = (key) =>
      value[key]
        ? json(this.#encrypt(value[key], input.dealId, `logistics.${key}`))
        : null;
    await database.query(
      `INSERT INTO crm.logistics
         (deal_id, desired_date, mode, purpose_envelope, purchase_profile_envelope,
          city_envelope, address_envelope, pickup_location_envelope, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
       ON CONFLICT (deal_id) DO UPDATE SET
         desired_date = COALESCE(EXCLUDED.desired_date, crm.logistics.desired_date),
         mode = COALESCE(EXCLUDED.mode, crm.logistics.mode),
         purpose_envelope = COALESCE(EXCLUDED.purpose_envelope, crm.logistics.purpose_envelope),
         purchase_profile_envelope = COALESCE(EXCLUDED.purchase_profile_envelope, crm.logistics.purchase_profile_envelope),
         city_envelope = CASE WHEN EXCLUDED.mode = 'pickup' THEN NULL ELSE COALESCE(EXCLUDED.city_envelope, crm.logistics.city_envelope) END,
         address_envelope = CASE WHEN EXCLUDED.mode = 'pickup' THEN NULL ELSE COALESCE(EXCLUDED.address_envelope, crm.logistics.address_envelope) END,
         pickup_location_envelope = CASE WHEN EXCLUDED.mode = 'delivery' THEN NULL ELSE COALESCE(EXCLUDED.pickup_location_envelope, crm.logistics.pickup_location_envelope) END,
         updated_at = EXCLUDED.updated_at`,
      [
        input.dealId,
        value.desiredDate ?? null,
        value.mode ?? null,
        encrypted('purpose'),
        encrypted('purchaseProfile'),
        encrypted('city'),
        encrypted('address'),
        encrypted('pickupLocation'),
        input.occurredAt,
      ],
    );
  }

  /** @param {any} database @param {QualificationPatch} input */
  async #replaceObservations(database, input) {
    const observations = input.fields.observations;
    if (!observations) throw new TypeError('observations are required');
    await database.query(
      'DELETE FROM crm.deal_observations WHERE deal_id = $1',
      [input.dealId],
    );
    for (const [position, value] of observations.entries()) {
      await database.query(
        `INSERT INTO crm.deal_observations (deal_id, position, value_envelope)
         VALUES ($1, $2, $3::jsonb)`,
        [
          input.dealId,
          position,
          json(this.#encrypt(value, input.dealId, `observations.${position}`)),
        ],
      );
    }
  }

  /** @param {any} database @param {QualificationPatch} input */
  async #appendAssessments(database, input) {
    const assessments = input.fields.assessments;
    if (!assessments) throw new TypeError('assessments are required');
    const resultingState = await this.#load(database, input.dealId);
    for (const [position, assessment] of assessments.entries()) {
      const definition = resolveFieldDefinition(assessment.field);
      if (!definition || !isAssessmentApplicable(definition, resultingState)) {
        throw invalid(
          'Assessment target is not applicable to the resulting state',
        );
      }
      await database.query(
        `INSERT INTO crm.field_assessments
           (deal_id, field_key, status, reason_envelope, actor_id, source,
            correlation_id, resulting_version, occurred_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
        [
          input.dealId,
          assessment.field,
          assessment.status,
          assessment.reason
            ? json(
                this.#encrypt(
                  assessment.reason,
                  input.dealId,
                  `assessments.${position}.reason`,
                ),
              )
            : null,
          input.actorId,
          input.source,
          input.correlationId,
          input.resultingVersion,
          input.occurredAt,
        ],
      );
    }
  }

  /** @param {any} database @param {string} dealId */
  async #load(database, dealId) {
    const state = emptyQualificationState();
    const [
      order,
      items,
      fabrics,
      colors,
      grade,
      artwork,
      locations,
      files,
      printColors,
      logistics,
      observations,
      assessments,
    ] = await Promise.all([
      database.query(
        'SELECT * FROM crm.deal_qualification WHERE deal_id = $1',
        [dealId],
      ),
      database.query(
        'SELECT * FROM crm.deal_items WHERE deal_id = $1 ORDER BY position',
        [dealId],
      ),
      database.query(
        `SELECT fabric.* FROM crm.item_fabrics fabric JOIN crm.deal_items item ON item.id = fabric.item_id WHERE item.deal_id = $1 ORDER BY item.position, fabric.position`,
        [dealId],
      ),
      database.query(
        `SELECT color.* FROM crm.item_piece_colors color JOIN crm.deal_items item ON item.id = color.item_id WHERE item.deal_id = $1`,
        [dealId],
      ),
      database.query(
        `SELECT line.* FROM crm.grade_lines line JOIN crm.deal_items item ON item.id = line.item_id WHERE item.deal_id = $1 ORDER BY item.position, line.position`,
        [dealId],
      ),
      database.query('SELECT * FROM crm.artwork WHERE deal_id = $1', [dealId]),
      database.query(
        'SELECT * FROM crm.artwork_locations WHERE deal_id = $1 ORDER BY position',
        [dealId],
      ),
      database.query(
        `SELECT * FROM crm.artwork_files
         WHERE deal_id = $1
         ORDER BY attachment_message_id, attachment_media_id`,
        [dealId],
      ),
      database.query(
        'SELECT * FROM crm.artwork_colors WHERE deal_id = $1 ORDER BY location_id',
        [dealId],
      ),
      database.query('SELECT * FROM crm.logistics WHERE deal_id = $1', [
        dealId,
      ]),
      database.query(
        'SELECT * FROM crm.deal_observations WHERE deal_id = $1 ORDER BY position',
        [dealId],
      ),
      database.query(
        'SELECT * FROM crm.field_assessments WHERE deal_id = $1 ORDER BY id',
        [dealId],
      ),
    ]);
    if (order.rows[0])
      state.order = {
        commercialIntent: order.rows[0].commercial_intent,
        customerEnvelope: order.rows[0].customer_envelope,
        nameEnvelope: order.rows[0].order_name_envelope,
      };
    state.items = /** @type {any[]} */ (items.rows).map((item) => ({
      catalogSnapshot: item.catalog_version_id
        ? {
            catalogVersionId: item.catalog_version_id,
            catalogVersionNumber: Number(item.catalog_version_number),
            product: item.product_snapshot,
            model: item.model_snapshot,
          }
        : null,
      colors: Object.fromEntries(
        /** @type {any[]} */ (colors.rows)
          .filter((row) => row.item_id === item.id)
          .map((row) => [row.field_key, row.value_envelope]),
      ),
      estimatedQuantity: Number(item.estimated_quantity),
      fabrics: /** @type {any[]} */ (fabrics.rows)
        .filter((row) => row.item_id === item.id)
        .map((row) => ({
          code: row.material_code,
          snapshot: row.material_snapshot,
        })),
      grade: /** @type {any[]} */ (grade.rows)
        .filter((row) => row.item_id === item.id)
        .map((row) => ({
          duplicateSizeReasonEnvelope: row.duplicate_reason_envelope,
          quantity: Number(row.quantity),
          sizeEnvelope: row.size_envelope,
          sizeLookup: row.size_lookup,
        })),
      id: item.id,
      modelCode: item.model_code,
      productCode: item.product_code,
    }));
    if (artwork.rows[0])
      state.artwork = {
        catalogSnapshot: artwork.rows[0].catalog_version_id
          ? {
              catalogVersionId: artwork.rows[0].catalog_version_id,
              catalogVersionNumber: Number(
                artwork.rows[0].catalog_version_number,
              ),
              technique: artwork.rows[0].technique_snapshot,
            }
          : null,
        colors: /** @type {any[]} */ (printColors.rows).map((row) => ({
          locationId: row.location_id,
          valuesEnvelope: row.values_envelope,
        })),
        files: /** @type {any[]} */ (files.rows).map((row) => ({
          attachmentId: {
            messageId: row.attachment_message_id,
            transientMediaId: row.attachment_media_id,
          },
          itemId: row.item_id,
          locationId: row.location_id,
        })),
        locations: /** @type {any[]} */ (locations.rows).map((row) => ({
          id: row.id,
          nameEnvelope: row.name_envelope,
        })),
        responsibilityEnvelope: artwork.rows[0].responsibility_envelope,
        status: artwork.rows[0].status,
        techniqueCode: artwork.rows[0].technique_code,
      };
    if (logistics.rows[0])
      state.logistics = {
        desiredDate: logistics.rows[0].desired_date,
        mode: logistics.rows[0].mode,
        purposeEnvelope: logistics.rows[0].purpose_envelope,
        purchaseProfileEnvelope: logistics.rows[0].purchase_profile_envelope,
        cityEnvelope: logistics.rows[0].city_envelope,
        addressEnvelope: logistics.rows[0].address_envelope,
        pickupLocationEnvelope: logistics.rows[0].pickup_location_envelope,
      };
    state.observations = /** @type {any[]} */ (observations.rows).map(
      (row) => row.value_envelope,
    );
    state.assessments = /** @type {any[]} */ (assessments.rows).map((row) => ({
      field: row.field_key,
      occurredAt: row.occurred_at,
      reasonEnvelope: row.reason_envelope,
      status: row.status,
    }));
    return state;
  }

  /** @param {string} value @param {string} dealId @param {string} field */
  #encrypt(value, dealId, field) {
    return this.cipher.encrypt(value, `${dealId}:${field}`);
  }
}

/** @param {any} context @returns {any} */
function queryable(context) {
  if (
    !context?.transaction ||
    typeof context.transaction.query !== 'function'
  ) {
    throw new TypeError('context.transaction must implement query');
  }
  return context.transaction;
}

/** @param {any} value */
function json(value) {
  return value === null ? null : JSON.stringify(value);
}

/** @param {string} message */
function invalid(message) {
  return Object.assign(new Error(message), {
    code: 'DEAL_INVALID',
    statusCode: 422,
  });
}

/** @typedef {{dealId: string, fields: {order?: Record<string, any>, items?: any[], artwork?: Record<string, any>, logistics?: Record<string, any>, observations?: string[], assessments?: any[]}, catalogs: {items: any[], artwork: any}, occurredAt: string, actorId: string, source: string, correlationId: string, resultingVersion: number, fieldsFingerprint: string, reasonCode: string, reasonDetail?: string}} QualificationPatch */
