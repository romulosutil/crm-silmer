export class PostgresQualificationCatalog {
  /** @param {any} input @param {{transaction: any}} context */
  async resolveReferences(input, context) {
    const database = requireQueryable(context?.transaction);
    const version = await database.query(
      `SELECT id, number, status FROM crm.catalog_versions
       WHERE id = $1`,
      [input.catalogVersionId],
    );
    if (version.rows.length !== 1) {
      throw invalidCatalog('catalog_version_missing');
    }
    if (version.rows[0].status !== 'published') {
      throw invalidCatalog('catalog_version_unpublished');
    }
    const [product, model, materials, technique] = await Promise.all([
      input.productCode
        ? database.query(
            `SELECT code, name FROM crm.catalog_products
             WHERE catalog_version_id = $1 AND code = $2`,
            [input.catalogVersionId, input.productCode],
          )
        : Promise.resolve({ rows: [] }),
      input.modelCode
        ? database.query(
            `SELECT code, name, product_code FROM crm.catalog_models
             WHERE catalog_version_id = $1 AND code = $2`,
            [input.catalogVersionId, input.modelCode],
          )
        : Promise.resolve({ rows: [] }),
      input.materialCodes?.length
        ? database.query(
            `SELECT code, name FROM crm.catalog_materials
             WHERE catalog_version_id = $1 AND code = ANY($2::text[])`,
            [input.catalogVersionId, input.materialCodes],
          )
        : Promise.resolve({ rows: [] }),
      input.techniqueCode
        ? database.query(
            `SELECT code, name FROM crm.catalog_techniques
             WHERE catalog_version_id = $1 AND code = $2`,
            [input.catalogVersionId, input.techniqueCode],
          )
        : Promise.resolve({ rows: [] }),
    ]);
    if (
      (input.productCode && product.rows.length !== 1) ||
      (input.modelCode && model.rows.length !== 1) ||
      (input.materialCodes &&
        materials.rows.length !== new Set(input.materialCodes).size) ||
      (input.techniqueCode && technique.rows.length !== 1) ||
      (model.rows[0] && model.rows[0].product_code !== input.productCode)
    ) {
      throw invalidCatalog('catalog_entry_unresolved');
    }
    return Object.freeze({
      catalogVersionId: version.rows[0].id,
      catalogVersionNumber: Number(version.rows[0].number),
      materials: (input.materialCodes ?? []).map((/** @type {string} */ code) =>
        mapEntry(
          materials.rows.find((/** @type {any} */ row) => row.code === code),
        ),
      ),
      model: model.rows[0]
        ? {
            ...mapEntry(model.rows[0]),
            productCode: model.rows[0].product_code,
          }
        : null,
      product: product.rows[0] ? mapEntry(product.rows[0]) : null,
      technique: technique.rows[0] ? mapEntry(technique.rows[0]) : null,
    });
  }
}

/** @param {any} row */
function mapEntry(row) {
  return { code: row.code, name: row.name };
}

/** @param {string} reasonCode */
function invalidCatalog(reasonCode) {
  return Object.assign(
    new Error('Catalog reference is not published or does not exist'),
    {
      code: 'DEAL_INVALID',
      reasonCode,
      resolution: 'pending',
      statusCode: 422,
    },
  );
}

/** @param {any} value @returns {any} */
function requireQueryable(value) {
  if (!value || typeof value.query !== 'function') {
    throw new TypeError('context.transaction must implement query');
  }
  return value;
}
