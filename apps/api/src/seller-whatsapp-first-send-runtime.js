import { createHash, createHmac, randomUUID } from 'node:crypto';
import { PostgresAuditTrail } from '@crm-silmer/audit-privacy';
import {
  decryptContactDetails,
  normalizeContactPhone,
} from '@crm-silmer/contacts';
import { PostgresIdempotencyRecordStore } from '@crm-silmer/integration-reliability';
import {
  decryptJson,
  encryptJson,
  identityLookupHash,
  sellerWhatsAppSendConfiguration,
} from '@crm-silmer/n8n-integration';
import { sellerClientsConfiguration } from './operation-runtime.js';

export const FIRST_SEND_DISABLED = 'SELLER_WHATSAPP_FIRST_SEND_DISABLED';
const SCOPE = 'contact.whatsapp.first_send';
const PROVIDER = 'evolution';
const CHANNEL = 'whatsapp';

/** @param {number} statusCode @param {string} code */
const refusal = (statusCode, code) =>
  Object.assign(new Error(code), { statusCode, code });

/** WAP-E10: dedicated fail-closed guard, default off, explicit allowlist.
 * @param {Record<string, unknown>} environment */
export function sellerWhatsAppFirstSendConfiguration(environment) {
  const enabled = environment.SELLER_WHATSAPP_FIRST_SEND_ENABLED;
  const raw = environment.SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS;
  /** @type {unknown} */
  let ids = [];
  try {
    ids = typeof raw === 'string' ? JSON.parse(raw) : [];
  } catch {
    ids = null;
  }
  if (
    (enabled !== undefined && enabled !== 'false' && enabled !== 'true') ||
    (raw !== undefined && typeof raw !== 'string') ||
    !Array.isArray(ids) ||
    ids.some(
      (id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(id),
    ) ||
    new Set(ids).size !== ids.length ||
    (enabled === 'true' && !ids.length)
  )
    throw new TypeError(
      'Seller WhatsApp first send requires explicit seller IDs',
    );
  return Object.freeze({
    enabled: enabled === 'true',
    sellers: new Set(/** @type {string[]} */ (enabled === 'true' ? ids : [])),
  });
}

/** @param {unknown} value @param {string} name */
function readKey(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/_-]+={0,2}$/u.test(value))
    throw new Error(`${name} must use base64 or base64url`);
  const key = Buffer.from(
    value,
    value.includes('-') || value.includes('_') ? 'base64url' : 'base64',
  );
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

/** @param {string|null} value */
const mask = (value) => (value ? `••••${value.slice(-4)}` : null);

/**
 * WAP-E10 / WAP-T04-03 (WAP-22/23/24/32). A human composes the first message
 * on the titular's own personal line. One PostgreSQL transaction, no HTTP:
 * identity, conversation, message and n8n outbox commit or roll back together.
 * Lock order mirrors the personal inbound path (users -> line -> conversation
 * advisory -> identity advisory -> Contact -> identity -> link -> conversation).
 * @param {any} database
 * @param {{access:any,outbox:any,environment?:Record<string,string|undefined>,clock?:()=>Date}} options
 */
export function createSellerWhatsAppFirstSendRuntime(database, options) {
  const environment = options.environment ?? process.env;
  const configuration = sellerWhatsAppFirstSendConfiguration(environment);
  const sendSellers = sellerWhatsAppSendConfiguration(environment);
  const clients = sellerClientsConfiguration(environment);
  if (
    !options.access ||
    typeof options.access.authorizeRead !== 'function' ||
    typeof options.access.authorizeWrite !== 'function' ||
    typeof options.outbox?.enqueueChannelMessage !== 'function'
  )
    throw new TypeError(
      'Seller WhatsApp first send requires operational access and the n8n outbox',
    );
  const contactKey = readKey(
    environment.CONTACT_IDENTITY_ENVELOPE_KEY,
    'CONTACT_IDENTITY_ENVELOPE_KEY',
  );
  const lookupKey = readKey(
    environment.CONTACT_IDENTITY_LOOKUP_KEY,
    'CONTACT_IDENTITY_LOOKUP_KEY',
  );
  const messageKey = readKey(
    environment.INBOX_MESSAGE_ENVELOPE_KEY,
    'INBOX_MESSAGE_ENVELOPE_KEY',
  );
  const idempotency = new PostgresIdempotencyRecordStore({
    database,
    envelopeKey: readKey(
      environment.IDEMPOTENCY_ENVELOPE_KEY,
      'IDEMPOTENCY_ENVELOPE_KEY',
    ),
  });
  const audit = new PostgresAuditTrail(database);
  const clock = options.clock ?? (() => new Date());
  const { access, outbox } = options;

  /** Feature flag is checked before the session; allowlists after it.
   * @param {string} [actorId] */
  function guard(actorId) {
    if (!configuration.enabled) throw refusal(503, FIRST_SEND_DISABLED);
    if (actorId === undefined) return;
    if (!configuration.sellers.has(actorId)) throw refusal(403, 'FORBIDDEN');
    if (!clients.enabled) throw refusal(503, FIRST_SEND_DISABLED);
    if (!clients.sellerIds.includes(actorId)) throw refusal(403, 'FORBIDDEN');
    if (!sendSellers.has(actorId)) throw refusal(503, FIRST_SEND_DISABLED);
  }

  /** @param {any} auth @param {boolean} write */
  async function authorize(auth, write) {
    guard();
    const { actor } = await (write
      ? access.authorizeWrite({
          ...auth,
          action: 'contact.whatsapp.first_send',
        })
      : access.authorizeRead({ ...auth, action: 'contact.read' }));
    if (actor?.kind !== 'human' || typeof actor.id !== 'string')
      throw refusal(403, 'FORBIDDEN');
    guard(actor.id);
    return actor;
  }

  /** Current account authority, then the titular's single line.
   * @param {any} client @param {string} actorId @param {boolean} lock */
  async function titular(client, actorId, lock) {
    const share = lock ? 'FOR SHARE' : '';
    const user = (
      await client.query(
        `SELECT id,disabled_at FROM crm.users WHERE id=$1 ${share}`,
        [actorId],
      )
    ).rows[0];
    const role = (
      await client.query(
        `SELECT function_name FROM crm.user_functions WHERE user_id=$1 ${share}`,
        [actorId],
      )
    ).rows[0];
    if (!user || user.disabled_at || role?.function_name !== 'Vendedor')
      throw refusal(403, 'FORBIDDEN');
    return (
      (
        await client.query(
          `SELECT l.id,l.account_id::text AS account_id,l.state,l.version,l.generation,
              l.verified_at,l.confirmed_number_envelope,b.id AS binding_id
           FROM crm.seller_whatsapp_lines l
           LEFT JOIN crm.seller_whatsapp_bindings b ON b.line_id=l.id
             AND b.generation=l.generation AND b.revoked_at IS NULL
           WHERE l.seller_id=$1 ${lock ? 'FOR SHARE OF l' : ''}`,
          [actorId],
        )
      ).rows[0] ?? null
    );
  }

  /** The seller's own active link is the only access path (never the
   * shared registration ACL), so another seller's relationship stays hidden.
   * @param {any} client @param {string} actorId @param {string} contactId */
  async function linkedContact(client, actorId, contactId) {
    const row = (
      await client.query(
        `SELECT contact.id,contact.display_name,contact.version,contact.contact_details_envelope,
            link.id AS link_id,link.version AS link_version
         FROM crm.contacts contact
         JOIN crm.seller_client_links link ON link.contact_id=contact.id
           AND link.seller_id=$2 AND link.status='active'
         WHERE contact.id=$1`,
        [contactId, actorId],
      )
    ).rows[0];
    if (!row) throw refusal(404, 'NOT_FOUND');
    return row;
  }

  /** Server-derived +E164 destination; typed numbers are never accepted.
   * @param {any} contact */
  function destination(contact) {
    const phone = normalizeContactPhone(
      decryptContactDetails(contact.contact_details_envelope, contactKey).phone,
    );
    return phone ? `+${phone}` : null;
  }

  /** @param {any} line */
  const lineUsable = (line) =>
    line.state === 'connected' &&
    Boolean(line.verified_at) &&
    Boolean(line.binding_id);

  /** @param {any} line @param {string} to */
  const lookupHashFor = (line, to) =>
    identityLookupHash(
      {
        provider: PROVIDER,
        providerAccountId: line.account_id,
        channel: CHANNEL,
        externalIdentityId: to,
      },
      lookupKey,
    );

  /** @param {any} client @param {any} line @param {string} hash @param {boolean} lock */
  async function identityFor(client, line, hash, lock) {
    return (
      (
        await client.query(
          `SELECT id,current_contact_id FROM crm.contact_identities
           WHERE provider=$1 AND provider_account_id=$2 AND channel=$3
             AND external_identity_lookup_hash=$4 ${lock ? 'FOR UPDATE' : ''}`,
          [PROVIDER, line.account_id, CHANNEL, hash],
        )
      ).rows[0] ?? null
    );
  }

  /** @param {any} client @param {any} line @param {string} to @param {boolean} lock */
  async function activeConversation(client, line, to, lock) {
    return (
      (
        await client.query(
          `SELECT * FROM crm.conversations
           WHERE provider=$1 AND provider_account_id=$2
             AND external_conversation_id=$3 AND terminal_at IS NULL
           ${lock ? 'FOR UPDATE' : ''}`,
          [PROVIDER, line.account_id, to],
        )
      ).rows[0] ?? null
    );
  }

  /** @param {any} conversation @param {any} identity @param {string} actorId */
  const reusable = (conversation, identity, actorId) =>
    conversation.contact_identity_id === identity?.id &&
    conversation.assigned_user_id === actorId &&
    conversation.automation_state === 'human';

  /** The titular's confirmed number as +E164, or null. @param {any} line */
  function ownNumber(line) {
    if (!line?.confirmed_number_envelope) return null;
    const { number } = decryptJson(
      line.confirmed_number_envelope,
      `seller-whatsapp-confirmed:${line.id}`,
      contactKey,
    );
    return typeof number === 'string' && /^[1-9][0-9]{7,14}$/u.test(number)
      ? `+${number}`
      : null;
  }

  /** A send to the seller's own line is never a customer destination.
   * @param {any} line @param {string|null} to */
  const validDestination = (line, to) => Boolean(to) && to !== ownNumber(line);

  /** @param {any} expected @param {any} conversation */
  const sameConversation = (expected, conversation) =>
    expected === null
      ? !conversation
      : Boolean(conversation) &&
        conversation.id === expected.id &&
        Number(conversation.version) === expected.version;

  /** @param {any} client @param {string} key */
  const advisory = (client, key) =>
    client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);

  /** @param {any} client */
  async function bounds(client) {
    await client.query("SET LOCAL lock_timeout = '1500ms'");
    await client.query("SET LOCAL statement_timeout = '5s'");
  }

  /** @param {any} client @param {any} input @param {any} state */
  async function effect(client, input, state) {
    const { line, to } = state;
    const actorId = input.actor.id;
    if (!lineUsable(line)) throw refusal(503, 'WHATSAPP_SEND_UNAVAILABLE');
    if (
      Number(line.version) !== input.expectedLineVersion ||
      Number(line.generation) !== input.expectedGeneration
    )
      throw refusal(409, 'WHATSAPP_GENERATION_STALE');
    if (!to || !validDestination(line, to))
      throw refusal(422, 'WHATSAPP_DESTINATION_INVALID');
    const hash = lookupHashFor(line, to);
    await advisory(client, `identity:${hash}`);
    let identity = await identityFor(client, line, hash, false);
    if (identity && identity.current_contact_id !== input.contactId)
      throw refusal(409, 'WHATSAPP_IDENTITY_CONFLICT');
    const contact = (
      await client.query('SELECT * FROM crm.contacts WHERE id=$1 FOR UPDATE', [
        input.contactId,
      ])
    ).rows[0];
    if (!contact) throw refusal(404, 'NOT_FOUND');
    if (identity) {
      identity = await identityFor(client, line, hash, true);
      if (identity?.current_contact_id !== input.contactId)
        throw refusal(409, 'WHATSAPP_IDENTITY_CONFLICT');
    }
    if (
      Number(contact.version) !== input.expectedContactVersion ||
      destination(contact) !== to
    )
      throw refusal(409, 'CONTACT_VERSION_CONFLICT');
    const link = (
      await client.query(
        'SELECT id,status,version FROM crm.seller_client_links WHERE seller_id=$1 AND contact_id=$2 FOR UPDATE',
        [actorId, input.contactId],
      )
    ).rows[0];
    if (link?.status !== 'active') throw refusal(404, 'NOT_FOUND');
    if (Number(link.version) !== input.expectedLinkVersion)
      throw refusal(409, 'CONTACT_VERSION_CONFLICT');
    let conversation = await activeConversation(client, line, to, true);
    if (conversation && !reusable(conversation, identity, actorId))
      throw refusal(409, 'CONVERSATION_UNAVAILABLE');
    // Checked under the conversation lock: another tab or an inbound reply
    // that opened/changed the conversation since the preview wins.
    if (!sameConversation(input.expectedConversation, conversation))
      throw refusal(409, 'CONVERSATION_VERSION_CONFLICT');
    const now = clock();
    if (!identity) {
      const id = `identity-${randomUUID()}`;
      // The schema admits only 'confirmed' for WhatsApp phone identities. The
      // phone lookup index is left to a proven inbound (no WhatsApp claim).
      await client.query(
        `INSERT INTO crm.contact_identities
           (id,current_contact_id,provider,provider_account_id,channel,
            external_identity_lookup_hash,identity_kind,phone_status,
            identity_envelope,key_version,version,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'phone','confirmed',$7::jsonb,1,1,$8,$8)`,
        [
          id,
          input.contactId,
          PROVIDER,
          line.account_id,
          CHANNEL,
          hash,
          JSON.stringify(
            encryptJson(
              { displayHandle: null, externalIdentityId: to },
              JSON.stringify(['crm.contact_identities', 1, hash]),
              contactKey,
            ),
          ),
          now,
        ],
      );
      identity = { id, current_contact_id: input.contactId };
    }
    const reused = Boolean(conversation);
    if (!conversation) {
      // A closed cycle stays closed; the next cycle only points back to it.
      const previous = (
        await client.query(
          `SELECT id,cycle_number FROM crm.conversations
           WHERE provider=$1 AND provider_account_id=$2 AND external_conversation_id=$3
           ORDER BY cycle_number DESC LIMIT 1`,
          [PROVIDER, line.account_id, to],
        )
      ).rows[0];
      conversation = (
        await client.query(
          `INSERT INTO crm.conversations
             (id,contact_identity_id,provider,provider_account_id,external_conversation_id,
              cycle_number,previous_conversation_id,state,automation_state,automation_epoch,
              version,opened_at,last_message_at,terminal_at,inbound_revision,claimed_revision,
              briefing_version,last_inbound_event_id,assigned_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,'em_atendimento','human',0,1,$8,$8,NULL,0,0,0,NULL,$9)
           RETURNING *`,
          [
            `conversation-${randomUUID()}`,
            identity.id,
            PROVIDER,
            line.account_id,
            to,
            Number(previous?.cycle_number ?? 0) + 1,
            previous?.id ?? null,
            now,
            actorId,
          ],
        )
      ).rows[0];
    }
    const messageId = `message-${randomUUID()}`;
    await client.query(
      `INSERT INTO crm.messages
         (id,conversation_id,provider,provider_account_id,command_id,direction,
          author_kind,author_id,message_type,content_envelope,key_version,status,
          occurred_at,created_at,automation_epoch)
       VALUES($1,$2,$3,$4,$5,'outbound','human',$6,'text',$7::jsonb,1,'queued',$8,$8,$9)`,
      [
        messageId,
        conversation.id,
        PROVIDER,
        line.account_id,
        state.commandId,
        actorId,
        JSON.stringify(
          encryptJson({ text: input.text }, `message:${messageId}`, messageKey),
        ),
        now,
        Number(conversation.automation_epoch),
      ],
    );
    // The outbox re-reads the personal target and refuses a stale line/link.
    await outbox.enqueueChannelMessage(
      {
        id: `job-${randomUUID()}`,
        idempotencyKey: state.commandId,
        messageId,
        availableAt: now,
      },
      { transaction: client },
    );
    const updated = (
      await client.query(
        `UPDATE crm.conversations SET version=version+1,
           last_message_at=GREATEST(last_message_at,$2)
         WHERE id=$1 RETURNING version,cycle_number`,
        [conversation.id, now],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO crm.domain_events
         (id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,correlation_id,occurred_at)
       SELECT $1,'conversation',$2,
         COALESCE((SELECT max(e.aggregate_version) FROM crm.domain_events e
           WHERE e.aggregate_type='conversation' AND e.aggregate_id=$2
             AND e.event_type='conversation.message_queued'),0)+1,
         'conversation.message_queued',$3::jsonb,$4,$5`,
      [
        `event-${randomUUID()}`,
        conversation.id,
        JSON.stringify({ conversationId: conversation.id }),
        input.correlationId,
        now,
      ],
    );
    await audit.append(
      {
        action: 'conversation.first_message_queued',
        actor: actorId,
        correlationId: input.correlationId,
        reason: reused ? 'SELLER_FIRST_MESSAGE_REUSED' : 'SELLER_FIRST_MESSAGE',
        target: { id: conversation.id, type: 'conversation' },
        version: Number(updated.version),
      },
      { transaction: client },
    );
    return {
      conversation: {
        id: conversation.id,
        version: Number(updated.version),
        reused,
        cycleNumber: Number(updated.cycle_number),
      },
      message: { id: messageId, status: 'queued' },
    };
  }

  return Object.freeze({
    authorize,

    /** Side-effect free: no identity, conversation, message or outbox.
     * @param {{actor:{id:string},contactId:string}} input */
    async preview(input) {
      guard(input.actor?.id);
      return database.transaction(async (/** @type {any} */ client) => {
        await client.query('SET TRANSACTION READ ONLY');
        await bounds(client);
        const actorId = input.actor.id;
        const line = await titular(client, actorId, false);
        const contact = await linkedContact(client, actorId, input.contactId);
        const to = destination(contact);
        /** @type {string|null} */
        let restriction = null;
        /** @type {any} */
        let conversation = null;
        if (!line) restriction = 'line_not_configured';
        else if (!lineUsable(line)) restriction = 'line_unavailable';
        else if (!to || !validDestination(line, to))
          restriction = 'destination_invalid';
        if (line && to && validDestination(line, to)) {
          const identity = await identityFor(
            client,
            line,
            lookupHashFor(line, to),
            false,
          );
          const active = await activeConversation(client, line, to, false);
          if (identity && identity.current_contact_id !== contact.id)
            restriction ??= 'identity_conflict';
          else if (active && !reusable(active, identity, actorId))
            restriction ??= 'conversation_unavailable';
          else if (active) conversation = active;
        }
        return {
          preview: {
            contact: {
              id: contact.id,
              name: contact.display_name ?? null,
              version: Number(contact.version),
            },
            link: {
              id: contact.link_id,
              version: Number(contact.link_version),
            },
            line: line
              ? {
                  id: line.id,
                  version: Number(line.version),
                  generation: Number(line.generation),
                  state: line.state,
                  maskedNumber: mask(ownNumber(line)),
                }
              : null,
            recipient: to ? { maskedNumber: mask(to) } : null,
            conversation: conversation
              ? { id: conversation.id, version: Number(conversation.version) }
              : null,
            available: restriction === null,
            restriction,
          },
        };
      });
    },

    /** @param {{actor:{id:string},contactId:string,text:string,expectedContactVersion:number,expectedLinkVersion:number,expectedLineVersion:number,expectedGeneration:number,expectedConversation:null|{id:string,version:number},idempotencyKey:string,correlationId:string}} input */
    async send(input) {
      guard(input.actor?.id);
      const actorId = input.actor.id;
      // The receipt key is global; namespace it with the actor.
      const key = createHash('sha256')
        .update(JSON.stringify([actorId, input.idempotencyKey]))
        .digest('hex');
      const commandId = `first-send:${key}`;
      const fingerprint = createHmac('sha256', lookupKey)
        .update(
          JSON.stringify([
            SCOPE,
            actorId,
            input.contactId,
            input.text,
            input.expectedContactVersion,
            input.expectedLinkVersion,
            input.expectedLineVersion,
            input.expectedGeneration,
            input.expectedConversation,
          ]),
        )
        .digest('hex');
      let created = false;
      /** @type {any} */
      let state;
      const result = await idempotency.execute(
        {
          scope: SCOPE,
          key,
          fingerprint,
          actor: actorId,
          action: SCOPE,
          target: { type: 'contact', id: input.contactId },
          version: input.expectedContactVersion,
          reason: 'SELLER_FIRST_MESSAGE',
          correlationId: input.correlationId,
        },
        async (/** @type {any} */ client) => {
          created = true;
          return effect(client, input, state);
        },
        // Runs for new commands and replays alike: a replay is returned only
        // to a current active titular whose own link is still active.
        async (/** @type {any} */ client) => {
          await bounds(client);
          const line = await titular(client, actorId, true);
          if (!line) throw refusal(403, 'FORBIDDEN');
          const contact = await linkedContact(client, actorId, input.contactId);
          const to = destination(contact);
          // Same key as inbound/external sends: serializes tabs and replies.
          if (to)
            await advisory(
              client,
              `n8n-conversation:${PROVIDER}:${line.account_id}:${to}`,
            );
          state = { line, to, commandId };
        },
      );
      return { created, body: result };
    },
  });
}
