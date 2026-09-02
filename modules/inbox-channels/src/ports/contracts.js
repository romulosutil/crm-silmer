import { ChannelContractError } from '../domain/channel-envelope.js';

/**
 * Verifies the pure boundary implemented later by each provider adapter. It
 * intentionally says nothing about HTTP, credentials, persistence or retries.
 *
 * @param {unknown} adapter
 */
export function assertChannelAdapterContract(adapter) {
  if (adapter === null || typeof adapter !== 'object') {
    throw new ChannelContractError('channel adapter is required');
  }
  const candidate = /** @type {Record<string, unknown>} */ (adapter);
  if (
    typeof candidate.provider !== 'string' ||
    candidate.provider.trim() === '' ||
    candidate.provider !== candidate.provider.toLowerCase()
  ) {
    throw new ChannelContractError(
      'channel adapter provider must be a lowercase canonical id',
    );
  }
  if (
    typeof candidate.channel !== 'string' ||
    !['instagram', 'whatsapp'].includes(candidate.channel)
  ) {
    throw new ChannelContractError(
      'channel adapter channel must be instagram or whatsapp',
    );
  }
  if (typeof candidate.normalizeInbound !== 'function') {
    throw new ChannelContractError(
      'channel adapter must implement normalizeInbound',
    );
  }
  if (typeof candidate.prepareOutbound !== 'function') {
    throw new ChannelContractError(
      'channel adapter must implement prepareOutbound',
    );
  }
}
