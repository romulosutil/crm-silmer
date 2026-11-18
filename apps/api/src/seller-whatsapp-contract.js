// WAP-E02 / WAP-T01-03: strict, separate human and technical control DTOs.
export const WAP_WORKFLOW_KEY = 'seller-whatsapp-control';
export const WAP_WORKFLOW_VERSION = '1.0';

/** @param {string} [code] @param {number} [statusCode] */
export function whatsappControlError(
  code = 'INVALID_REQUEST',
  statusCode = 400,
) {
  return Object.assign(new Error(code), { code, statusCode });
}

/** @param {any} value @param {string[]} allowed @param {string[]} [required] */
export function controlObject(value, allowed, required = allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => value[key] === undefined)
  )
    throw whatsappControlError();
  return value;
}

/** @param {unknown} value */
export function controlId(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw whatsappControlError();
  return value.toLowerCase();
}

/** @param {unknown} value @param {number} [minimum] */
export function controlVersion(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw whatsappControlError();
  return Number(value);
}

/** @param {any} value @param {string[]} choices */
export function controlEnum(value, choices) {
  if (!choices.includes(value)) throw whatsappControlError();
  return value;
}

export const CHALLENGE_STATES = /** @type {const} */ ([
  'reserved',
  'dispatching',
  'delivered',
  'unknown',
  'resolved',
  'revoked',
]);

/** WAP-03: the holder's GET carries only id/state/expiry of the latest
 * challenge, so a reloaded tab can renew. Anything else (bytes, reference,
 * mode) is dropped; a malformed value fails closed as a server fault.
 * @param {any} value */
export function challengeMetadata(value) {
  if (value === null || value === undefined) return null;
  const expiresAt =
    typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
  if (
    typeof value.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value.id,
    ) ||
    !CHALLENGE_STATES.includes(value.state) ||
    !Number.isFinite(expiresAt)
  )
    throw new Error('Invalid challenge metadata');
  return {
    id: value.id,
    state: value.state,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/** @param {any} body @param {'connect'|'disconnect'|'challenge'} action */
export function readHumanControl(body, action) {
  if (action === 'connect') {
    controlObject(body, ['expectedNumber', 'expectedVersion']);
    if (
      typeof body.expectedNumber !== 'string' ||
      !/^\+?[1-9][0-9]{7,14}$/u.test(body.expectedNumber)
    )
      throw whatsappControlError();
    return {
      expectedNumber: body.expectedNumber,
      expectedVersion: controlVersion(body.expectedVersion),
    };
  }
  if (action === 'disconnect') {
    controlObject(body, ['expectedVersion', 'expectedGeneration']);
    return {
      expectedVersion: controlVersion(body.expectedVersion, 1),
      expectedGeneration: controlVersion(body.expectedGeneration, 1),
    };
  }
  controlObject(
    body,
    [
      'operationId',
      'expectedVersion',
      'generation',
      'mode',
      'renewChallengeId',
    ],
    ['operationId', 'expectedVersion', 'generation', 'mode'],
  );
  return {
    operationId: controlId(body.operationId),
    expectedVersion: controlVersion(body.expectedVersion, 1),
    generation: controlVersion(body.generation, 1),
    mode: controlEnum(body.mode, ['qr', 'code']),
    ...(body.renewChallengeId === undefined
      ? {}
      : { renewChallengeId: controlId(body.renewChallengeId) }),
  };
}

/** @param {any} body */
export function readControlEnvelope(body) {
  controlObject(body, ['kind', 'envelope']);
  const kind = controlEnum(body.kind, ['control', 'challenge']);
  const fields =
    kind === 'control'
      ? ['operationId', 'lineId', 'generation', 'action', 'reference']
      : [
          'operationId',
          'lineId',
          'generation',
          'challengeId',
          'mode',
          'reference',
        ];
  const envelope = controlObject(body.envelope, fields);
  controlId(envelope.operationId);
  controlId(envelope.lineId);
  controlId(envelope.reference);
  controlVersion(envelope.generation, 1);
  if (kind === 'control')
    controlEnum(envelope.action, ['connect', 'reconcile', 'disconnect']);
  else {
    controlId(envelope.challengeId);
    controlEnum(envelope.mode, ['qr', 'code']);
  }
  return { kind, envelope };
}

/** @param {any} body */
export function readControlResult(body) {
  controlObject(
    body,
    [
      'operationId',
      'lineId',
      'generation',
      'resultId',
      'effect',
      'outcome',
      'confirmedNumber',
      'webhookVerified',
      'bindingVerified',
      'providerState',
    ],
    ['operationId', 'lineId', 'generation', 'resultId', 'effect', 'outcome'],
  );
  for (const key of ['operationId', 'lineId', 'resultId']) controlId(body[key]);
  controlVersion(body.generation, 1);
  controlEnum(body.effect, ['connect', 'disconnect', 'reconcile']);
  controlEnum(body.outcome, [
    'succeeded',
    'failed_before_effect',
    'unknown',
    'reconciled',
  ]);
  if (
    body.confirmedNumber !== undefined &&
    (typeof body.confirmedNumber !== 'string' ||
      !/^\+?[1-9][0-9]{7,14}$/u.test(body.confirmedNumber))
  )
    throw whatsappControlError();
  if (
    body.webhookVerified !== undefined &&
    typeof body.webhookVerified !== 'boolean'
  )
    throw whatsappControlError();
  if (
    body.bindingVerified !== undefined &&
    typeof body.bindingVerified !== 'boolean'
  )
    throw whatsappControlError();
  if (body.providerState !== undefined)
    controlEnum(body.providerState, ['open', 'connecting', 'close', 'absent']);
  return body;
}
