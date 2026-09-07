const ID = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
const INDEX = '(?:0|[1-9][0-9]{0,3})';
const COLORS = [
  'front',
  'back',
  'rightSleeve',
  'leftSleeve',
  'collarTrim',
  'sleeveTrim',
];

/** @typedef {{path: string, stage: string, order: number, requiredForGate: boolean, allowsExplicitNA: boolean, itemId?: string, itemPosition?: number, fieldPosition?: number, gradePosition?: number}} FieldDefinition */
/** @type {Map<string, [string, number, boolean, boolean]>} */
const STATIC = new Map([
  ['order.customer', ['produto', 10, true, false]],
  ['order.name', ['produto', 20, true, false]],
  ['order.commercialIntent', ['produto', 30, true, false]],
  ['items', ['produto', 40, true, false]],
  ['artwork', ['estampa', 5, true, true]],
  ['artwork.status', ['estampa', 10, true, false]],
  ['artwork.responsibility', ['estampa', 20, true, false]],
  ['artwork.technique', ['estampa', 30, true, false]],
  ['artwork.locations', ['estampa', 40, true, false]],
  ['artwork.files', ['estampa', 50, true, false]],
  ['artwork.colors', ['estampa', 60, true, true]],
  ['logistics.desiredDate', ['logistica', 10, true, false]],
  ['logistics.purpose', ['logistica', 20, true, false]],
  ['logistics.purchaseProfile', ['logistica', 30, true, false]],
  ['logistics.mode', ['logistica', 40, true, false]],
  ['logistics.city', ['logistica', 50, true, false]],
  ['logistics.address', ['logistica', 60, true, false]],
  ['logistics.pickupLocation', ['logistica', 70, true, false]],
]);

/** @type {Array<[RegExp, string, number, boolean, boolean, boolean]>} */
const DYNAMIC = [
  [
    new RegExp(`^items\\.(${ID})\\.product$`, 'u'),
    'produto',
    50,
    true,
    false,
    true,
  ],
  [
    new RegExp(`^items\\.(${ID})\\.model$`, 'u'),
    'produto',
    60,
    true,
    false,
    true,
  ],
  [
    new RegExp(`^items\\.(${ID})\\.estimatedQuantity$`, 'u'),
    'produto',
    70,
    true,
    false,
    true,
  ],
  [
    new RegExp(`^items\\.(${ID})\\.fabrics$`, 'u'),
    'especificacao',
    10,
    true,
    false,
    true,
  ],
  [
    new RegExp(`^items\\.(${ID})\\.colors\\.(${COLORS.join('|')})$`, 'u'),
    'especificacao',
    20,
    true,
    true,
    true,
  ],
  [
    new RegExp(`^items\\.(${ID})\\.grade\\.total$`, 'u'),
    'especificacao',
    60,
    true,
    false,
    true,
  ],
  [
    new RegExp(`^items\\.(${ID})\\.grade\\.(${INDEX})\\.(size|quantity)$`, 'u'),
    'especificacao',
    40,
    true,
    false,
    true,
  ],
  [
    new RegExp(
      `^items\\.(${ID})\\.grade\\.(${INDEX})\\.duplicateSizeReason$`,
      'u',
    ),
    'especificacao',
    50,
    true,
    false,
    true,
  ],
  [
    new RegExp(`^observations\\.(${INDEX})$`, 'u'),
    'logistica',
    90,
    false,
    false,
    false,
  ],
];

/** @param {unknown} path @returns {FieldDefinition | null} */
export function resolveFieldDefinition(path) {
  if (typeof path !== 'string' || path.length > 160) return null;
  const fixed = STATIC.get(path);
  if (fixed) return definition(path, fixed);
  for (const [
    pattern,
    stage,
    order,
    requiredForGate,
    allowsExplicitNA,
    hasItemId,
  ] of DYNAMIC) {
    const match = pattern.exec(path);
    if (match)
      return {
        allowsExplicitNA,
        ...(hasItemId ? { itemId: match[1] } : {}),
        order,
        path,
        requiredForGate,
        stage,
      };
  }
  return null;
}

/** @param {string} left @param {string} right @param {any=} state */
export function compareFieldPaths(left, right, state) {
  const a = resolveFieldDefinition(left);
  const b = resolveFieldDefinition(right);
  if (!a || !b) return left.localeCompare(right, 'en');
  const stageOrder = ['produto', 'especificacao', 'estampa', 'logistica'];
  const itemPosition = (/** @type {FieldDefinition} */ value) =>
    value.itemId
      ? Math.max(
          0,
          /** @type {any[]} */ (state?.items ?? []).findIndex(
            (item) => item.id === value.itemId,
          ),
        )
      : -1;
  const gradePosition = (/** @type {string} */ value) => {
    const match = /\.grade\.(\d+)\./u.exec(value);
    return match ? Number(match[1]) : -1;
  };
  return (
    stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage) ||
    itemPosition(a) - itemPosition(b) ||
    a.order - b.order ||
    gradePosition(left) - gradePosition(right) ||
    left.localeCompare(right, 'en')
  );
}

/** @param {FieldDefinition} definition @param {any} state */
export function isAssessmentApplicable(definition, state) {
  if (
    definition.itemId &&
    !state.items.some(
      (/** @type {any} */ item) => item.id === definition.itemId,
    )
  ) {
    return false;
  }
  if (definition.path === 'artwork')
    return state.artwork?.status === 'not_applicable';
  if (
    definition.path.startsWith('artwork.') &&
    definition.path !== 'artwork.status'
  ) {
    return state.artwork && state.artwork.status !== 'not_applicable';
  }
  if (
    definition.path === 'logistics.city' ||
    definition.path === 'logistics.address'
  ) {
    return state.logistics?.mode === 'delivery';
  }
  if (definition.path === 'logistics.pickupLocation') {
    return state.logistics?.mode === 'pickup';
  }
  return true;
}

/** @param {string} path @param {[string, number, boolean, boolean]} values @returns {FieldDefinition} */
function definition(path, [stage, order, requiredForGate, allowsExplicitNA]) {
  return { allowsExplicitNA, order, path, requiredForGate, stage };
}
