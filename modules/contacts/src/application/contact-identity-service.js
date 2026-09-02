import { randomUUID } from 'node:crypto';

import {
  commandFingerprint,
  normalizeHumanCommand,
  normalizeInboundIdentity,
} from '../domain/identity.js';

/**
 * @param {{
 *   auditPort: {append: Function},
 *   clock?: () => Date,
 *   idFactory?: (kind: string) => string,
 *   repository: {resolveInboundIdentity: Function, mergeIdentity: Function, unmergeIdentity: Function}
 * }} options
 */
export function createContactIdentityService(options) {
  if (
    !options ||
    typeof options.auditPort?.append !== 'function' ||
    typeof options.repository?.resolveInboundIdentity !== 'function' ||
    typeof options.repository?.mergeIdentity !== 'function' ||
    typeof options.repository?.unmergeIdentity !== 'function'
  ) {
    throw new TypeError('Contact identity ports are required');
  }
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => randomUUID());

  return Object.freeze({
    /** @param {Record<string, unknown>} input */
    async resolveInboundIdentity(input) {
      const identity = normalizeInboundIdentity(input);
      return options.repository.resolveInboundIdentity({
        contactId: idFactory('contact'),
        identity,
        identityId: idFactory('identity'),
        now: validClock(clock),
      });
    },

    /** @param {Record<string, unknown>} input */
    async mergeIdentity(input) {
      const command = normalizeHumanCommand(input, 'merge');
      const fingerprint = commandFingerprint([
        'contact.identity.merge',
        command.actor.id,
        command.identityId,
        command.targetContactId,
        command.expectedVersion,
        command.reason,
        command.correlationId,
      ]);
      return options.repository.mergeIdentity(
        {
          ...command,
          fingerprint,
          linkId: idFactory('identity-link'),
          now: validClock(clock),
        },
        options.auditPort,
      );
    },

    /** @param {Record<string, unknown>} input */
    async unmergeIdentity(input) {
      const command = normalizeHumanCommand(input, 'unmerge');
      const fingerprint = commandFingerprint([
        'contact.identity.unmerge',
        command.actor.id,
        command.linkId,
        command.expectedVersion,
        command.reason,
        command.correlationId,
      ]);
      return options.repository.unmergeIdentity(
        { ...command, fingerprint, now: validClock(clock) },
        options.auditPort,
      );
    },
  });
}

/** @param {() => Date} clock */
function validClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('clock must return a valid Date');
  }
  return value.toISOString();
}
