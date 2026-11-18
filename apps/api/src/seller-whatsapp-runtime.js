import {
  PostgresSellerWhatsAppRepository,
  sellerWhatsAppConfiguration,
} from '@crm-silmer/inbox-channels';
import { createWhatsAppControlClient } from '@crm-silmer/integration-reliability';
import {
  WAP_WORKFLOW_KEY,
  WAP_WORKFLOW_VERSION,
  whatsappControlError as error,
  challengeMetadata,
  controlObject,
} from './seller-whatsapp-contract.js';

/** @param {Record<string,string|undefined>} env */
export function sellerWhatsAppClientOptions(env) {
  return {
    controlEndpoint: env.N8N_WAP_CONTROL_URL ?? '',
    challengeEndpoint: env.N8N_WAP_CHALLENGE_URL ?? '',
    clientId: env.N8N_COMMAND_CLIENT_ID ?? '',
    clientSecret: env.N8N_COMMAND_CLIENT_SECRET ?? '',
  };
}

/** WAP-E02. HTTP is deliberately outside PostgreSQL transactions.
 * @param {any} database
 * @param {{access:any,environment?:Record<string,string|undefined>,repository?:any,client?:any,clock?:()=>Date}} options */
export function createSellerWhatsAppRuntime(database, options) {
  const env = options.environment ?? process.env;
  const configuration = sellerWhatsAppConfiguration(env);
  const repository =
    options.repository ??
    new PostgresSellerWhatsAppRepository(database, configuration);
  const webhookUrl = env.SELLER_WHATSAPP_WEBHOOK_URL;
  if (configuration.enabled) {
    if (!options.client)
      createWhatsAppControlClient({
        ...sellerWhatsAppClientOptions(env),
        enabled: true,
        allowlist: [],
      });
    const url = new URL(webhookUrl ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith('/webhook/silmer/seller-whatsapp/')
    )
      throw new Error(
        'Seller WhatsApp requires private configured n8n webhook',
      );
    if (!options.access)
      throw new Error('Seller WhatsApp requires operational access');
  }
  const clock = options.clock ?? (() => new Date());
  /** @param {any} technical */
  function authorizeTechnical(technical) {
    if (!configuration.enabled) throw error('WHATSAPP_CONTROL_DISABLED', 503);
    if (
      technical.actor?.id !== 'AUTOMATION_EXECUTOR' ||
      technical.workflowKey !== WAP_WORKFLOW_KEY ||
      technical.workflowVersion !== WAP_WORKFLOW_VERSION
    )
      throw error('FORBIDDEN', 403);
  }
  /** @param {any} envelope @param {any} technical @param {string} key */
  function correlation(envelope, technical, key) {
    authorizeTechnical(technical);
    if (
      technical.correlationId !== envelope.operationId ||
      technical.idempotencyKey !== envelope[key]
    )
      throw error('FORBIDDEN', 403);
  }
  return {
    enabled: configuration.enabled,
    authorizeRead: (/** @type {any} */ auth) =>
      options.access.authorizeRead(auth),
    authorizeWrite: (/** @type {any} */ auth) =>
      options.access.authorizeWrite(auth),
    authorizeTechnical,
    /** @param {any} input */
    async get(input) {
      const state = await repository.get(input);
      return { ...state, challenge: challengeMetadata(state?.challenge) };
    },
    submit: (/** @type {any} */ input) => repository.submit(input),
    /** @param {any} input */
    async challenge(input) {
      if (!configuration.enabled) throw error('WHATSAPP_CONTROL_DISABLED', 503);
      const { auth, ...command } = input;
      const pending = await repository.beginChallenge(command);
      const envelope = {
        operationId: pending.operationId,
        lineId: pending.lineId,
        generation: pending.generation,
        challengeId: pending.challengeId,
        mode: pending.mode,
        reference: pending.reference,
      };
      try {
        const client =
          options.client ??
          createWhatsAppControlClient({
            ...sellerWhatsAppClientOptions(env),
            enabled: true,
            allowlist: [pending.lineId],
          });
        const response = controlObject(await client.challenge(envelope), [
          'challengeId',
          'operationId',
          'generation',
          'mode',
          'expiresAt',
          'value',
        ]);
        if (
          response.challengeId !== pending.challengeId ||
          response.operationId !== pending.operationId ||
          response.generation !== pending.generation ||
          response.mode !== pending.mode ||
          !Number.isFinite(Date.parse(response.expiresAt)) ||
          Date.parse(response.expiresAt) > Date.parse(pending.expiresAt) ||
          Date.parse(response.expiresAt) <= clock().getTime() ||
          typeof response.value !== 'string' ||
          !response.value.length ||
          response.value.length > 512_000
        )
          throw error('WHATSAPP_OPERATION_UNCERTAIN', 409);
        // Session/capability can have changed while n8n was answering.
        const { actor } = await options.access.authorizeWrite(auth);
        if (actor.id !== input.actorId) throw error('FORBIDDEN', 403);
        const finished = await repository.finishChallenge({
          ...envelope,
          delivered: true,
        });
        if (!finished.deliverable)
          throw error('WHATSAPP_GENERATION_STALE', 409);
        return { ...response, version: finished.version };
      } catch {
        await repository.finishChallenge({
          ...envelope,
          delivered: false,
          uncertain: true,
        });
        throw error('WHATSAPP_OPERATION_UNCERTAIN', 409);
      }
    },
    /** @param {any} input @param {any} technical */
    async verifyEnvelope(input, technical) {
      correlation(
        input.envelope,
        technical,
        input.kind === 'challenge' ? 'challengeId' : 'operationId',
      );
      return {
        kind: input.kind,
        envelope: await repository.verifyEnvelope(input),
      };
    },
    /** @param {any} input @param {any} technical */
    async reserve(input, technical) {
      correlation(
        input.envelope,
        technical,
        input.kind === 'challenge' ? 'challengeId' : 'operationId',
      );
      const result =
        input.kind === 'challenge'
          ? await repository.reserveChallenge({
              ...input.envelope,
              executionId: technical.executionId,
            })
          : await repository.reserveControl({
              ...input.envelope,
              executionId: technical.executionId,
            });
      return {
        ...result,
        allowed: true,
        instance: result.instanceName,
        webhookUrl,
        ...(input.kind === 'challenge'
          ? {
              challenge: {
                operationId: input.envelope.operationId,
                challengeId: input.envelope.challengeId,
                mode: input.envelope.mode,
                expiresAt: result.expiresAt,
              },
            }
          : {}),
      };
    },
    /** @param {any} input @param {any} technical */
    async result(input, technical) {
      correlation(input, technical, 'resultId');
      return repository.result({
        ...input,
        executionId: technical.executionId,
        correlationId: technical.correlationId,
      });
    },
    /** @param {any} input */
    async verifyIngress(input) {
      if (!configuration.enabled) throw error('WHATSAPP_CONTROL_DISABLED', 503);
      return repository.verifyIngress(input);
    },
  };
}
