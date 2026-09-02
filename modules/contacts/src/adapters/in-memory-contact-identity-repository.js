import {
  ContactIdentityConflictError,
  ContactIdentityNotFoundError,
} from '../domain/errors.js';
import { clone } from '../domain/identity.js';

export class InMemoryContactIdentityRepository {
  #contacts = new Map();
  #identities = new Map();
  #identitiesByScope = new Map();
  #links = new Map();
  #mergeCommands = new Map();
  #unmergeCommands = new Map();
  #tail = Promise.resolve();

  /** @param {{contactId: string, identity: Record<string, any>, identityId: string, now: string}} input */
  async resolveInboundIdentity(input) {
    return this.#exclusive(async () => {
      const scope = identityScope(input.identity);
      const existingId = this.#identitiesByScope.get(scope);
      if (existingId) return this.#resolved(existingId);

      const contact = {
        createdAt: input.now,
        id: input.contactId,
        provisional: true,
        updatedAt: input.now,
        version: 1,
      };
      const identity = {
        automaticMergeAllowed: false,
        channel: input.identity.channel,
        contactId: contact.id,
        createdAt: input.now,
        displayHandle: input.identity.displayHandle,
        id: input.identityId,
        identityKind: input.identity.identityKind,
        phoneStatus: input.identity.phoneStatus,
        provider: input.identity.provider,
        providerAccountId: input.identity.providerAccountId,
        updatedAt: input.now,
        version: 1,
      };
      this.#contacts.set(contact.id, contact);
      this.#identities.set(identity.id, identity);
      this.#identitiesByScope.set(scope, identity.id);
      return clone({ contact, identity });
    });
  }

  /** @param {Record<string, any>} command @param {{append: Function}} auditPort */
  async mergeIdentity(command, auditPort) {
    return this.#exclusive(async () => {
      const replay = this.#mergeCommands.get(command.idempotencyKey);
      if (replay) return commandReplay(replay, command.fingerprint);

      const identity = this.#identities.get(command.identityId);
      const target = this.#contacts.get(command.targetContactId);
      if (!identity || !target) throw new ContactIdentityNotFoundError();
      if (
        identity.version !== command.expectedVersion ||
        identity.contactId === target.id ||
        this.#activeLink(identity.id)
      ) {
        throw new ContactIdentityConflictError();
      }
      const source = this.#contacts.get(identity.contactId);
      if (!source) throw new ContactIdentityNotFoundError();

      source.version += 1;
      source.updatedAt = command.now;
      target.version += 1;
      target.updatedAt = command.now;
      identity.contactId = target.id;
      identity.updatedAt = command.now;
      identity.version += 1;
      const link = {
        id: command.linkId,
        identityId: identity.id,
        mergedAt: command.now,
        mergedBy: command.actor.id,
        sourceContactId: source.id,
        status: 'active',
        targetContactId: target.id,
      };
      this.#links.set(link.id, link);
      const result = clone({ contact: target, identity, link });
      await auditPort.append(auditEvent('merged', command, identity));
      this.#mergeCommands.set(command.idempotencyKey, {
        fingerprint: command.fingerprint,
        result,
      });
      return clone(result);
    });
  }

  /** @param {Record<string, any>} command @param {{append: Function}} auditPort */
  async unmergeIdentity(command, auditPort) {
    return this.#exclusive(async () => {
      const replay = this.#unmergeCommands.get(command.idempotencyKey);
      if (replay) return commandReplay(replay, command.fingerprint);

      const link = this.#links.get(command.linkId);
      if (!link) throw new ContactIdentityNotFoundError();
      const identity = this.#identities.get(link.identityId);
      const source = this.#contacts.get(link.sourceContactId);
      const target = this.#contacts.get(link.targetContactId);
      if (!identity || !source || !target) {
        throw new ContactIdentityNotFoundError();
      }
      if (
        link.status !== 'active' ||
        identity.contactId !== target.id ||
        identity.version !== command.expectedVersion
      ) {
        throw new ContactIdentityConflictError();
      }

      source.version += 1;
      source.updatedAt = command.now;
      target.version += 1;
      target.updatedAt = command.now;
      identity.contactId = source.id;
      identity.updatedAt = command.now;
      identity.version += 1;
      Object.assign(link, {
        revertedAt: command.now,
        revertedBy: command.actor.id,
        status: 'reverted',
      });
      const result = clone({ contact: source, identity, link });
      await auditPort.append(auditEvent('unmerged', command, identity));
      this.#unmergeCommands.set(command.idempotencyKey, {
        fingerprint: command.fingerprint,
        result,
      });
      return clone(result);
    });
  }

  /** @param {string} identityId */
  #activeLink(identityId) {
    return [...this.#links.values()].find(
      (link) => link.identityId === identityId && link.status === 'active',
    );
  }

  /** @param {string} identityId */
  #resolved(identityId) {
    const identity = this.#identities.get(identityId);
    const contact = identity && this.#contacts.get(identity.contactId);
    if (!identity || !contact) throw new ContactIdentityNotFoundError();
    return clone({ contact, identity });
  }

  /** @template T @param {() => Promise<T>} work */
  async #exclusive(work) {
    let release = () => {};
    const previous = this.#tail;
    this.#tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = this.#snapshot();
    try {
      return await work();
    } catch (error) {
      this.#restore(snapshot);
      throw error;
    } finally {
      release();
    }
  }

  #snapshot() {
    return clone({
      contacts: [...this.#contacts],
      identities: [...this.#identities],
      identitiesByScope: [...this.#identitiesByScope],
      links: [...this.#links],
      mergeCommands: [...this.#mergeCommands],
      unmergeCommands: [...this.#unmergeCommands],
    });
  }

  /** @param {any} snapshot */
  #restore(snapshot) {
    this.#contacts = new Map(snapshot.contacts);
    this.#identities = new Map(snapshot.identities);
    this.#identitiesByScope = new Map(snapshot.identitiesByScope);
    this.#links = new Map(snapshot.links);
    this.#mergeCommands = new Map(snapshot.mergeCommands);
    this.#unmergeCommands = new Map(snapshot.unmergeCommands);
  }
}

/** @param {Record<string, any>} identity */
function identityScope(identity) {
  return JSON.stringify([
    identity.provider,
    identity.providerAccountId,
    identity.channel,
    identity.externalIdentityId,
  ]);
}

/** @param {{fingerprint: string, result: unknown}} replay @param {string} fingerprint */
function commandReplay(replay, fingerprint) {
  if (replay.fingerprint !== fingerprint) {
    throw new ContactIdentityConflictError();
  }
  return clone(replay.result);
}

/** @param {'merged'|'unmerged'} change @param {Record<string, any>} command @param {Record<string, any>} identity */
function auditEvent(change, command, identity) {
  return {
    action: `contact.identity.${change}`,
    actor: command.actor.id,
    correlationId: command.correlationId,
    reason: command.reason,
    target: { id: identity.id, type: 'contact_identity' },
    version: identity.version,
  };
}
