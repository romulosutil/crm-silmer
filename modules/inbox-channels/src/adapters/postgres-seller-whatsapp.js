import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { contactPhoneHash } from '@crm-silmer/contacts';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

/** Safe domain errors never carry provider payloads, numbers or credentials. */
export class SellerWhatsAppError extends Error {
  /** @param {string} code @param {number} [statusCode] */
  constructor(code, statusCode = 409) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** @param {string} code @param {number} [status] */
const fail = (code, status) => {
  throw new SellerWhatsAppError(code, status);
};
/** @param {any} value */
const id = (value) => {
  if (typeof value !== 'string' || !UUID.test(value))
    fail('INVALID_REQUEST', 400);
  return value.toLowerCase();
};
/** @param {any} value */
const positive = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_REQUEST', 400);
  return value;
};
/** @param {any} value */
function phone(value) {
  if (typeof value !== 'string' || !/^\+?[1-9][0-9]{7,14}$/u.test(value))
    fail('INVALID_REQUEST', 400);
  return value.replace(/^\+/u, '');
}
/** @param {any} value */
const sha = (value) => createHash('sha256').update(value).digest('hex');
/** @param {any} value @param {string} context @param {Buffer} key */
function encrypt(value, context, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return {
    algorithm: 'AES-256-GCM',
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    keyVersion: 1,
    tag: cipher.getAuthTag().toString('base64url'),
    version: 1,
  };
}
/** @param {any} raw @param {string} context @param {Buffer} key */
function decrypt(raw, context, key) {
  try {
    const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
      envelope.algorithm !== 'AES-256-GCM' ||
      envelope.version !== 1 ||
      envelope.keyVersion !== 1
    )
      throw new Error();
    const cipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64url'),
    );
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return JSON.parse(
      Buffer.concat([
        cipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        cipher.final(),
      ]).toString(),
    );
  } catch {
    return fail('WHATSAPP_PRIVATE_DATA_UNAVAILABLE', 503);
  }
}

/** WAP-E02. The repository owns the effect fences and the metadata-only ledger.
 * No network calls occur inside its transactions.
 */
export class PostgresSellerWhatsAppRepository {
  /** @type {any} */
  #database;
  /** @type {any} */
  #options;
  /** @type {Buffer} */
  #key;
  /** @type {Buffer} */
  #lookup;
  /** @type {()=>Date} */
  #clock;
  /** @type {Set<string>} */
  #sellers;

  /** @param {any} database @param {{envelopeKey:Buffer,lookupKey:Buffer,enabled?:boolean,sellerAllowlist?:string[],generalNumberDigest?:string,clock?:()=>Date,challengeTtlMs?:number}} options */
  constructor(database, options) {
    if (
      !Buffer.isBuffer(options.envelopeKey) ||
      options.envelopeKey.length !== 32 ||
      !Buffer.isBuffer(options.lookupKey) ||
      options.lookupKey.length !== 32
    )
      throw new TypeError('WhatsApp envelope and lookup keys must be 32 bytes');
    if (
      options.enabled === true &&
      !/^[a-f0-9]{64}$/u.test(options.generalNumberDigest ?? '')
    )
      throw new TypeError(
        'Enabled WhatsApp control requires the general number digest',
      );
    if (
      !Array.isArray(options.sellerAllowlist ?? []) ||
      (options.sellerAllowlist ?? []).some(
        (v) => typeof v !== 'string' || !v || v.length > 128,
      )
    )
      throw new TypeError('WhatsApp control seller allowlist is invalid');
    const ttl = options.challengeTtlMs ?? 60_000;
    if (!Number.isSafeInteger(ttl) || ttl < 1000 || ttl > 120_000)
      throw new TypeError('WhatsApp challenge TTL must be 1000..120000 ms');
    this.#database = database;
    this.#options = { ...options, challengeTtlMs: ttl };
    this.#key = options.envelopeKey;
    this.#lookup = options.lookupKey;
    this.#clock = options.clock ?? (() => new Date());
    this.#sellers = new Set(options.sellerAllowlist ?? []);
  }

  /** @param {string} value */
  #digest(value) {
    return contactPhoneHash(phone(value), this.#lookup);
  }

  /** @param {(client:any)=>Promise<any>} work */
  async #transaction(work) {
    try {
      return await this.#database.transaction(work);
    } catch (error) {
      if (/** @type {any} */ (error).code === '23505')
        fail('WHATSAPP_LINE_CONFLICT');
      throw error;
    }
  }

  /** Lock order: user, line, operation/challenge, outbox. Role/revocation writes
   * hold the user lock in the identity repository and revoke at SQL boundary.
   * @param {any} client @param {string} actorId @param {boolean} [write] */
  async #owner(client, actorId, write = true, allowInactive = false) {
    const user = (
      await client.query('SELECT * FROM crm.users WHERE id=$1 FOR UPDATE', [
        actorId,
      ])
    ).rows[0];
    const role = (
      await client.query(
        'SELECT function_name FROM crm.user_functions WHERE user_id=$1',
        [actorId],
      )
    ).rows[0];
    if (
      !user ||
      (!allowInactive &&
        (user.disabled_at || role?.function_name !== 'Vendedor'))
    )
      fail('FORBIDDEN', 403);
    if (
      write &&
      (this.#options.enabled !== true || !this.#sellers.has(actorId))
    )
      fail('WHATSAPP_CONTROL_DISABLED', 503);
    return user;
  }

  /** @param {any} client @param {string} sellerId */
  async #line(client, sellerId) {
    return (
      await client.query(
        'SELECT * FROM crm.seller_whatsapp_lines WHERE seller_id=$1 FOR UPDATE',
        [sellerId],
      )
    ).rows[0];
  }

  /** @param {any} client @param {any} line @param {any} [operation] */
  async #present(client, line, operation) {
    if (!line)
      return {
        line: {
          id: null,
          state: 'not_configured',
          version: 0,
          generation: 0,
          maskedNumber: null,
        },
        challenge: null,
        available: this.#options.enabled === true,
      };
    const number = decrypt(
      line.number_envelope,
      `seller-whatsapp-number:${line.id}`,
      this.#key,
    ).number;
    const current =
      operation ??
      (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_operations WHERE line_id=$1 ORDER BY generation DESC,created_at DESC,id DESC LIMIT 1',
          [line.id],
        )
      ).rows[0];
    const projected = current ? this.#operation(current) : null;
    const revocation = (
      await client.query(
        'SELECT id,state FROM crm.seller_whatsapp_revocations WHERE line_id=$1 ORDER BY generation DESC,created_at DESC,id DESC LIMIT 1',
        [line.id],
      )
    ).rows[0];
    // Metadata of the latest challenge of the current generation only, so a
    // reloaded tab can present renewChallengeId. The bytes are never stored.
    const challenge = (
      await client.query(
        'SELECT id,state,expires_at FROM crm.seller_whatsapp_challenges WHERE line_id=$1 AND generation=$2 ORDER BY sequence DESC LIMIT 1',
        [line.id, line.generation],
      )
    ).rows[0];
    return {
      line: {
        id: line.id,
        state: line.state,
        version: Number(line.version),
        generation: Number(line.generation),
        maskedNumber: `••••${number.slice(-4)}`,
        operation: projected,
      },
      operation: projected,
      challenge: challenge
        ? {
            id: challenge.id,
            state: challenge.state,
            expiresAt: new Date(challenge.expires_at).toISOString(),
          }
        : null,
      ...(revocation
        ? { revocation: { id: revocation.id, state: revocation.state } }
        : {}),
      available:
        this.#options.enabled === true && this.#sellers.has(line.seller_id),
    };
  }

  /** @param {any} row @param {string} [action] */
  #operation(row, action = row.action) {
    return {
      id: row.id,
      operationId: row.id,
      lineId: row.line_id,
      generation: Number(row.generation),
      action,
      state: row.state,
      reference: row.reference,
    };
  }

  /** @param {any} client @param {any} line @param {any} op @param {string} reason */
  async #audit(client, line, op, reason) {
    await client.query(
      `INSERT INTO crm.audit_events(id,actor_id,action,target_type,target_id,version,reason,correlation_id,occurred_at)
      VALUES($1,$2,'whatsapp.control','whatsapp-line',$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        op.actor_id,
        line.id,
        String(line.version),
        reason,
        op.correlation_id,
        this.#clock(),
      ],
    );
  }

  /** @param {any} client @param {any} op @param {string} action @param {string} suffix */
  async #enqueue(client, op, action, suffix) {
    const reconcile = action === 'reconcile';
    await client.query(
      `INSERT INTO crm.outbox_jobs(id,job_type,idempotency_key,status,queue,available_at,created_at,updated_at,effect_policy,max_attempts,whatsapp_operation_id,whatsapp_action)
      VALUES($1,$2,$3,'pending','whatsapp_control',$4,$4,$4,$5,$6,$7,$8) ON CONFLICT(job_type,idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        reconcile ? 'whatsapp.control.reconcile' : 'whatsapp.control.deliver',
        `${op.id}${suffix}`,
        this.#clock(),
        reconcile ? 'queryable' : 'manual',
        reconcile ? 8 : 1,
        op.id,
        action,
      ],
    );
  }

  /** @param {any} client @param {any} op */
  async #reconcile(client, op) {
    const next = Number(op.reconcile_sequence) + 1;
    await client.query(
      'UPDATE crm.seller_whatsapp_operations SET reconcile_sequence=$2,updated_at=$3 WHERE id=$1',
      [op.id, next, this.#clock()],
    );
    await this.#enqueue(client, op, 'reconcile', `:${next}`);
  }

  /** @param {{actorId:string}} input */
  async get(input) {
    return this.#transaction(async (client) => {
      await this.#owner(client, input.actorId, false);
      return {
        ...(await this.#present(
          client,
          await this.#line(client, input.actorId),
        )),
        available:
          this.#options.enabled === true && this.#sellers.has(input.actorId),
      };
    });
  }

  /** @param {any} input */
  async submit(input) {
    if (
      !['connect', 'disconnect'].includes(input.action) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    )
      fail('INVALID_REQUEST', 400);
    const key = id(input.idempotencyKey);
    const expectedNumber =
      input.action === 'connect' ? phone(input.expectedNumber) : null;
    const fingerprint = sha(
      JSON.stringify({
        action: input.action,
        numberDigest: expectedNumber ? this.#digest(expectedNumber) : null,
        expectedVersion: input.expectedVersion,
        expectedGeneration: input.expectedGeneration ?? null,
      }),
    );
    return this.#transaction(async (client) => {
      await this.#owner(client, input.actorId);
      let line = await this.#line(client, input.actorId);
      const revokedReplay = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_revocations WHERE actor_id=$1 AND idempotency_key=$2',
          [input.actorId, key],
        )
      ).rows[0];
      if (revokedReplay) {
        if (revokedReplay.fingerprint !== fingerprint)
          fail('IDEMPOTENCY_KEY_REUSED');
        return this.#present(client, line);
      }
      const replay = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_operations WHERE actor_id=$1 AND idempotency_key=$2',
          [input.actorId, key],
        )
      ).rows[0];
      if (replay) {
        if (replay.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED');
        return this.#present(client, line, replay);
      }
      if (Number(line?.version ?? 0) !== input.expectedVersion)
        fail('VERSION_CONFLICT');
      if (
        input.expectedGeneration !== undefined &&
        Number(line?.generation ?? 0) !== input.expectedGeneration
      )
        fail('WHATSAPP_GENERATION_STALE');
      if (line) {
        if (
          expectedNumber &&
          line.number_digest !== this.#digest(expectedNumber)
        )
          fail('WHATSAPP_LINE_CONFLICT');
        let unresolved = (
          await client.query(
            "SELECT * FROM crm.seller_whatsapp_operations WHERE line_id=$1 AND state IN ('pending','dispatching','unknown') FOR UPDATE",
            [line.id],
          )
        ).rows[0];
        if (!unresolved && input.action === 'disconnect') {
          unresolved = (
            await client.query(
              `SELECT o.* FROM crm.seller_whatsapp_operations o
            WHERE o.line_id=$1 AND o.generation=$2 AND o.action='connect'
              AND EXISTS(SELECT 1 FROM crm.seller_whatsapp_challenges c WHERE c.operation_id=o.id AND c.state IN ('dispatching','unknown'))
            FOR UPDATE OF o`,
              [line.id, line.generation],
            )
          ).rows[0];
        }
        if (unresolved) {
          if (input.action === 'disconnect' && unresolved.state === 'pending')
            await client.query(
              "UPDATE crm.seller_whatsapp_operations SET state='failed_before_effect',updated_at=$2 WHERE id=$1",
              [unresolved.id, this.#clock()],
            );
          else if (input.action === 'disconnect') {
            const waiting = (
              await client.query(
                "SELECT id FROM crm.seller_whatsapp_revocations WHERE line_id=$1 AND state IN ('waiting_reconciliation','queued')",
                [line.id],
              )
            ).rows[0];
            if (waiting) fail('WHATSAPP_OPERATION_UNCERTAIN');
            const at = this.#clock();
            await client.query(
              'UPDATE crm.seller_whatsapp_bindings SET revoked_at=$2 WHERE line_id=$1 AND revoked_at IS NULL',
              [line.id, at],
            );
            await client.query(
              "UPDATE crm.seller_whatsapp_challenges SET state='revoked',updated_at=$2 WHERE line_id=$1 AND state<>'revoked'",
              [line.id, at],
            );
            line = (
              await client.query(
                "UPDATE crm.seller_whatsapp_lines SET state='disconnecting',generation=generation+1,version=version+1,verified_at=NULL,updated_at=$2 WHERE id=$1 RETURNING *",
                [line.id, at],
              )
            ).rows[0];
            await client.query(
              "UPDATE crm.seller_whatsapp_operations SET state='unknown',updated_at=$2 WHERE id=$1",
              [unresolved.id, at],
            );
            await client.query(
              `INSERT INTO crm.seller_whatsapp_revocations(id,line_id,generation,previous_operation_id,actor_id,idempotency_key,fingerprint,correlation_id,state,created_at,updated_at)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,'waiting_reconciliation',$9,$9)`,
              [
                randomUUID(),
                line.id,
                line.generation,
                unresolved.id,
                input.actorId,
                key,
                fingerprint,
                input.correlationId,
                at,
              ],
            );
            await this.#reconcile(client, unresolved);
            await this.#audit(
              client,
              line,
              { ...unresolved, correlation_id: input.correlationId },
              'WHATSAPP_LOCALLY_REVOKED',
            );
            return this.#present(client, line);
          } else fail('WHATSAPP_OPERATION_UNCERTAIN');
        }
        if (input.action === 'connect' && line.state !== 'disconnected')
          fail('WHATSAPP_LINE_CONFLICT');
        if (input.action === 'disconnect' && line.state === 'disconnected')
          fail('WHATSAPP_LINE_CONFLICT');
      } else if (input.action !== 'connect')
        fail('WHATSAPP_LINE_NOT_FOUND', 404);
      // General reservation is installed under the same unique key as personal
      // reservations. Existing personal ownership never wins against the general.
      const general = (
        await client.query(
          'SELECT kind FROM crm.whatsapp_number_reservations WHERE number_digest=$1',
          [this.#options.generalNumberDigest],
        )
      ).rows[0];
      if (general && general.kind !== 'general') fail('WHATSAPP_LINE_CONFLICT');
      await client.query(
        "INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,created_at) VALUES($1,'general',$2) ON CONFLICT DO NOTHING",
        [this.#options.generalNumberDigest, this.#clock()],
      );
      const at = this.#clock();
      if (!line) {
        const lineId = randomUUID();
        const digest = this.#digest(expectedNumber);
        const reserved = (
          await client.query(
            'SELECT kind FROM crm.whatsapp_number_reservations WHERE number_digest=$1',
            [digest],
          )
        ).rows[0];
        if (reserved) fail('WHATSAPP_LINE_CONFLICT');
        line = (
          await client.query(
            `INSERT INTO crm.seller_whatsapp_lines(id,seller_id,account_id,instance_name,number_digest,number_envelope,state,generation,version,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,'preparing',1,1,$7,$7) RETURNING *`,
            [
              lineId,
              input.actorId,
              randomUUID(),
              `wap_${randomUUID().replaceAll('-', '')}`,
              digest,
              JSON.stringify(
                encrypt(
                  { number: expectedNumber },
                  `seller-whatsapp-number:${lineId}`,
                  this.#key,
                ),
              ),
              at,
            ],
          )
        ).rows[0];
        await client.query(
          "INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,line_id,created_at) VALUES($1,'personal',$2,$3)",
          [digest, line.id, at],
        );
      } else {
        await client.query(
          'UPDATE crm.seller_whatsapp_bindings SET revoked_at=$2 WHERE line_id=$1 AND revoked_at IS NULL',
          [line.id, at],
        );
        await client.query(
          "UPDATE crm.seller_whatsapp_challenges SET state='revoked',updated_at=$2 WHERE line_id=$1 AND state<>'revoked'",
          [line.id, at],
        );
        line = (
          await client.query(
            'UPDATE crm.seller_whatsapp_lines SET generation=generation+1,version=version+1,state=$2,updated_at=$3,verified_at=NULL WHERE id=$1 RETURNING *',
            [
              line.id,
              input.action === 'connect' ? 'preparing' : 'disconnecting',
              at,
            ],
          )
        ).rows[0];
      }
      if (input.action === 'connect') {
        const binding = randomUUID();
        const token = randomBytes(32).toString('base64url');
        await client.query(
          `INSERT INTO crm.seller_whatsapp_bindings(id,line_id,account_id,instance_name,generation,token_hash,token_envelope,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
          [
            binding,
            line.id,
            line.account_id,
            line.instance_name,
            line.generation,
            sha(token),
            JSON.stringify(
              encrypt(
                { token },
                `seller-whatsapp-binding:${binding}`,
                this.#key,
              ),
            ),
            at,
          ],
        );
      }
      const op = (
        await client.query(
          `INSERT INTO crm.seller_whatsapp_operations(id,line_id,generation,action,actor_id,idempotency_key,fingerprint,reference,correlation_id,state,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$10) RETURNING *`,
          [
            randomUUID(),
            line.id,
            line.generation,
            input.action,
            input.actorId,
            key,
            fingerprint,
            randomUUID(),
            input.correlationId,
            at,
          ],
        )
      ).rows[0];
      await this.#enqueue(client, op, op.action, '');
      await this.#audit(
        client,
        line,
        op,
        input.action === 'connect'
          ? 'WHATSAPP_CONNECT_REQUESTED'
          : 'WHATSAPP_DISCONNECT_REQUESTED',
      );
      return this.#present(client, line, op);
    });
  }

  /** Locate without locks, then re-read in canonical user→line→operation order.
   * @param {any} client @param {string} operationId @param {boolean} [write] */
  async #operationContext(
    client,
    operationId,
    write = true,
    allowRevokedRead = false,
  ) {
    const initial = (
      await client.query(
        'SELECT * FROM crm.seller_whatsapp_operations WHERE id=$1',
        [id(operationId)],
      )
    ).rows[0];
    if (!initial) fail('WHATSAPP_OPERATION_NOT_FOUND', 404);
    const revocation = allowRevokedRead
      ? (
          await client.query(
            "SELECT id FROM crm.seller_whatsapp_revocations WHERE previous_operation_id=$1 AND state='waiting_reconciliation'",
            [initial.id],
          )
        ).rows[0]
      : null;
    await this.#owner(client, initial.actor_id, write, Boolean(revocation));
    const line = await this.#line(client, initial.actor_id);
    const op = (
      await client.query(
        'SELECT * FROM crm.seller_whatsapp_operations WHERE id=$1 FOR UPDATE',
        [initial.id],
      )
    ).rows[0];
    return { line, op };
  }

  /** @param {any} client @param {any} line @param {any} op @param {any} envelope */
  async #assertEnvelope(client, line, op, envelope) {
    const revocation =
      envelope.action === 'reconcile'
        ? (
            await client.query(
              "SELECT id FROM crm.seller_whatsapp_revocations WHERE previous_operation_id=$1 AND line_id=$2 AND state='waiting_reconciliation'",
              [op.id, line.id],
            )
          ).rows[0]
        : null;
    if (
      line.id !== id(envelope.lineId) ||
      Number(op.generation) !== positive(envelope.generation) ||
      (Number(line.generation) !== envelope.generation && !revocation) ||
      op.reference !== id(envelope.reference)
    )
      fail('WHATSAPP_GENERATION_STALE');
    if (
      (line.state === 'blocked' && !revocation) ||
      (envelope.action !== 'reconcile' && envelope.action !== op.action)
    )
      fail('WHATSAPP_LINE_CONFLICT');
  }

  /** @param {any} client @param {any} line @param {any} op @param {string} action */
  async #privateControl(client, line, op, action) {
    const binding = (
      await client.query(
        'SELECT * FROM crm.seller_whatsapp_bindings WHERE line_id=$1 AND generation=$2 AND revoked_at IS NULL',
        [line.id, line.generation],
      )
    ).rows[0];
    const result = {
      operationId: op.id,
      lineId: line.id,
      generation: Number(op.generation),
      action,
      reference: op.reference,
      instanceName: line.instance_name,
      expectedNumber: decrypt(
        line.number_envelope,
        `seller-whatsapp-number:${line.id}`,
        this.#key,
      ).number,
      source: binding
        ? {
            bindingId: binding.id,
            lineId: line.id,
            accountId: line.account_id,
            generation: Number(binding.generation),
          }
        : null,
      generationToken: binding
        ? decrypt(
            binding.token_envelope,
            `seller-whatsapp-binding:${binding.id}`,
            this.#key,
          ).token
        : null,
    };
    if (action === 'connect' && !binding) fail('WHATSAPP_GENERATION_STALE');
    return result;
  }

  /** Worker transport envelope; contains no phone, QR, code or generation token.
   * @param {string} operationId @param {{action?:string}} [options] */
  async loadDelivery(operationId, options = {}) {
    return this.#transaction(async (client) => {
      const { line, op } = await this.#operationContext(
        client,
        operationId,
        true,
        options.action === 'reconcile',
      );
      const action =
        options.action ?? (op.state === 'unknown' ? 'reconcile' : op.action);
      if (!['connect', 'disconnect', 'reconcile'].includes(action))
        fail('INVALID_REQUEST', 400);
      await this.#assertEnvelope(client, line, op, {
        lineId: line.id,
        generation: Number(op.generation),
        reference: op.reference,
        action,
      });
      if (action !== 'reconcile' && op.state !== 'pending')
        fail('WHATSAPP_OPERATION_UNCERTAIN');
      return {
        operationId: op.id,
        lineId: line.id,
        generation: Number(op.generation),
        action,
        reference: op.reference,
      };
    });
  }

  /** Before n8n's first persistence, validate identifiers against authoritative
   * metadata without reserving the external effect or returning private data.
   * @param {{kind:string,envelope:any}} input */
  async verifyEnvelope(input) {
    const envelope = input.envelope;
    return this.#transaction(async (client) => {
      const { line, op } = await this.#operationContext(
        client,
        envelope.operationId,
        true,
        input.kind === 'control' && envelope.action === 'reconcile',
      );
      if (input.kind === 'control') {
        await this.#assertEnvelope(client, line, op, envelope);
        if (envelope.action !== 'reconcile' && op.state !== 'pending')
          fail('WHATSAPP_OPERATION_UNCERTAIN');
        return {
          operationId: op.id,
          lineId: line.id,
          generation: Number(op.generation),
          action: envelope.action,
          reference: op.reference,
        };
      }
      if (input.kind !== 'challenge') fail('INVALID_REQUEST', 400);
      const challenge = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_challenges WHERE id=$1',
          [id(envelope.challengeId)],
        )
      ).rows[0];
      this.#assertChallenge(line, op, challenge, envelope);
      return {
        operationId: op.id,
        lineId: line.id,
        generation: Number(op.generation),
        challengeId: challenge.id,
        mode: challenge.mode,
        reference: challenge.reference,
      };
    });
  }

  /** n8n is the sole caller reserving one external mutating action. A duplicate
   * POST cannot call create/logout a second time, even after a lost HTTP reply.
   * @param {any} input */
  async reserveControl(input) {
    if (
      typeof input.executionId !== 'string' ||
      !input.executionId ||
      input.executionId.length > 128
    )
      fail('INVALID_REQUEST', 400);
    return this.#transaction(async (client) => {
      const { line, op } = await this.#operationContext(
        client,
        input.operationId,
        true,
        input.action === 'reconcile',
      );
      await this.#assertEnvelope(client, line, op, input);
      if (input.action !== 'reconcile') {
        if (op.state !== 'pending') fail('WHATSAPP_OPERATION_UNCERTAIN');
        await client.query(
          "UPDATE crm.seller_whatsapp_operations SET state='dispatching',updated_at=$2 WHERE id=$1",
          [op.id, this.#clock()],
        );
      }
      const resultId = randomUUID();
      await client.query(
        'INSERT INTO crm.seller_whatsapp_dispatches(id,operation_id,generation,action,execution_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [
          resultId,
          op.id,
          op.generation,
          input.action,
          input.executionId,
          this.#clock(),
        ],
      );
      return {
        ...(await this.#privateControl(client, line, op, input.action)),
        resultId,
      };
    });
  }

  /** @param {string} operationId */
  async markUnknown(operationId) {
    return this.#transaction(async (client) => {
      const initial = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_operations WHERE id=$1',
          [id(operationId)],
        )
      ).rows[0];
      if (!initial) return { recorded: false };
      // Record an in-flight uncertain effect even after user revocation, while
      // preserving its old generation and never reopening access.
      await client.query('SELECT id FROM crm.users WHERE id=$1 FOR UPDATE', [
        initial.actor_id,
      ]);
      const line = await this.#line(client, initial.actor_id);
      const op = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_operations WHERE id=$1 FOR UPDATE',
          [initial.id],
        )
      ).rows[0];
      if (!['pending', 'dispatching'].includes(op.state))
        return { recorded: false };
      await client.query(
        "UPDATE crm.seller_whatsapp_operations SET state='unknown',updated_at=$2 WHERE id=$1",
        [op.id, this.#clock()],
      );
      if (
        Number(line.generation) === Number(op.generation) &&
        line.state !== 'blocked'
      )
        await client.query(
          "UPDATE crm.seller_whatsapp_lines SET state='unknown',version=version+1,updated_at=$2 WHERE id=$1",
          [line.id, this.#clock()],
        );
      await this.#reconcile(client, op);
      return { recorded: true };
    });
  }

  /** Callback receipts contain only metadata. Number proof is validated and
   * encrypted into the line, never persisted in this receipt or audit event.
   * @param {any} input */
  async result(input) {
    const resultId = id(input.resultId);
    if (
      !['connect', 'disconnect', 'reconcile'].includes(input.effect) ||
      !['succeeded', 'failed_before_effect', 'unknown', 'reconciled'].includes(
        input.outcome,
      ) ||
      !['open', 'connecting', 'close', 'absent', undefined].includes(
        input.providerState,
      )
    )
      fail('INVALID_REQUEST', 400);
    if (input.outcome === 'reconciled' && input.effect !== 'reconcile')
      fail('INVALID_REQUEST', 400);
    if (
      input.effect === 'reconcile' &&
      input.outcome === 'failed_before_effect'
    )
      fail('INVALID_REQUEST', 400);
    const confirmed =
      input.confirmedNumber === undefined ? null : phone(input.confirmedNumber);
    const fingerprint = sha(
      JSON.stringify({
        operationId: id(input.operationId),
        lineId: id(input.lineId),
        generation: positive(input.generation),
        effect: input.effect,
        outcome: input.outcome,
        confirmed: confirmed ? this.#digest(confirmed) : null,
        webhookVerified: input.webhookVerified ?? false,
        bindingVerified: input.bindingVerified ?? false,
        providerState: input.providerState ?? null,
      }),
    );
    return this.#transaction(async (client) => {
      const initial = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_operations WHERE id=$1',
          [input.operationId],
        )
      ).rows[0];
      if (
        !initial ||
        initial.line_id !== input.lineId ||
        Number(initial.generation) !== input.generation
      )
        fail('WHATSAPP_OPERATION_NOT_FOUND', 404);
      const user = (
        await client.query('SELECT * FROM crm.users WHERE id=$1 FOR UPDATE', [
          initial.actor_id,
        ])
      ).rows[0];
      const role = (
        await client.query(
          'SELECT function_name FROM crm.user_functions WHERE user_id=$1',
          [initial.actor_id],
        )
      ).rows[0];
      const line = await this.#line(client, initial.actor_id);
      const op = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_operations WHERE id=$1 FOR UPDATE',
          [initial.id],
        )
      ).rows[0];
      if (input.effect !== 'reconcile' && input.effect !== op.action)
        fail('WHATSAPP_LINE_CONFLICT');
      const dispatch = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_dispatches WHERE id=$1',
          [resultId],
        )
      ).rows[0];
      if (
        !dispatch ||
        dispatch.operation_id !== op.id ||
        Number(dispatch.generation) !== input.generation ||
        dispatch.action !== input.effect ||
        dispatch.execution_id !== input.executionId
      )
        fail('FORBIDDEN', 403);
      const replay = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_results WHERE id=$1',
          [resultId],
        )
      ).rows[0];
      if (replay) {
        if (replay.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED');
        return { accepted: true, duplicate: true, stale: replay.stale };
      }
      const revocation = (
        await client.query(
          "SELECT * FROM crm.seller_whatsapp_revocations WHERE previous_operation_id=$1 AND state='waiting_reconciliation' FOR UPDATE",
          [op.id],
        )
      ).rows[0];
      const latestDispatch = (
        await client.query(
          'SELECT max(sequence) AS sequence FROM crm.seller_whatsapp_dispatches WHERE operation_id=$1',
          [op.id],
        )
      ).rows[0];
      const stale =
        Number(dispatch.sequence) < Number(latestDispatch.sequence) ||
        Number(line.generation) !== input.generation ||
        Boolean(user?.disabled_at) ||
        role?.function_name !== 'Vendedor' ||
        line.state === 'blocked';
      await client.query(
        `INSERT INTO crm.seller_whatsapp_results(id,operation_id,generation,effect,outcome,fingerprint,stale,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          resultId,
          op.id,
          input.generation,
          input.effect,
          input.outcome,
          fingerprint,
          stale,
          this.#clock(),
        ],
      );
      if (
        revocation &&
        input.effect === 'reconcile' &&
        ['succeeded', 'reconciled'].includes(input.outcome) &&
        ['open', 'connecting', 'close', 'absent'].includes(
          input.providerState,
        ) &&
        Number(dispatch.sequence) === Number(latestDispatch.sequence)
      ) {
        await this.#completeRevocation(client, line, op, revocation, {
          providerState: input.providerState,
          active: !user.disabled_at && role?.function_name === 'Vendedor',
        });
        return { accepted: true, duplicate: false, stale: true };
      }
      if (stale) return { accepted: true, duplicate: false, stale: true };
      // Only the effect reservation may be completed. A forged callback before
      // dispatch and a late uncertainty after a conclusive result are no-ops.
      if (
        input.effect !== 'reconcile' &&
        op.state !== 'dispatching' &&
        op.state !== 'unknown'
      )
        return { accepted: true, duplicate: false, stale: false };
      if (input.effect === 'reconcile' && op.state === 'pending')
        fail('WHATSAPP_OPERATION_UNCERTAIN');
      const conclusive =
        input.outcome === 'succeeded' || input.outcome === 'reconciled';
      let state = line.state;
      let operationState = input.outcome;
      if (input.outcome === 'unknown') {
        state = 'unknown';
      } else if (input.outcome === 'failed_before_effect') {
        state = op.action === 'disconnect' ? 'unknown' : 'disconnected';
      } else if (conclusive) {
        operationState =
          input.effect === 'reconcile' ? 'reconciled' : 'succeeded';
        if (
          input.effect === 'reconcile' &&
          op.action === 'disconnect' &&
          ['open', 'connecting'].includes(input.providerState)
        ) {
          state = 'disconnecting';
          operationState = 'unknown';
        } else if (input.providerState === 'open') {
          const currentBinding = (
            await client.query(
              'SELECT id FROM crm.seller_whatsapp_bindings WHERE line_id=$1 AND generation=$2 AND revoked_at IS NULL',
              [line.id, line.generation],
            )
          ).rows[0];
          const attemptedChallenge = (
            await client.query(
              "SELECT id FROM crm.seller_whatsapp_challenges WHERE line_id=$1 AND generation=$2 AND state IN ('dispatching','delivered','resolved') LIMIT 1",
              [line.id, line.generation],
            )
          ).rows[0];
          if (
            !confirmed ||
            this.#digest(confirmed) !== line.number_digest ||
            input.webhookVerified !== true ||
            input.bindingVerified !== true ||
            !currentBinding ||
            !attemptedChallenge ||
            op.action === 'disconnect'
          )
            state = 'blocked';
          else state = 'connected';
        } else if (
          input.effect === 'connect' &&
          input.providerState === 'close' &&
          input.webhookVerified === true
        )
          state = 'awaiting_pairing';
        else if (
          input.providerState === 'connecting' &&
          op.action === 'connect'
        )
          state = 'awaiting_pairing';
        else if (['close', 'absent'].includes(input.providerState))
          state = 'disconnected';
        else {
          state = 'unknown';
          operationState = 'unknown';
        }
      }
      await client.query(
        'UPDATE crm.seller_whatsapp_operations SET state=$2,updated_at=$3 WHERE id=$1',
        [op.id, operationState, this.#clock()],
      );
      // A read that observes the line exactly as it is (e.g. still pairing) is
      // not a change: bumping the version would make clients drop a challenge
      // that is still valid. Connected always refreshes its proof and bumps.
      const unchanged =
        state === line.state && state !== 'connected' && !line.verified_at;
      const updated = unchanged
        ? line
        : (
            await client.query(
              `UPDATE crm.seller_whatsapp_lines SET state=$2,version=version+1,updated_at=$3,
        confirmed_number_envelope=CASE WHEN $4::jsonb IS NULL THEN confirmed_number_envelope ELSE $4::jsonb END,
        verified_at=CASE WHEN $2::text='connected' THEN $3::timestamptz ELSE NULL END WHERE id=$1 RETURNING *`,
              [
                line.id,
                state,
                this.#clock(),
                state === 'connected'
                  ? JSON.stringify(
                      encrypt(
                        { number: confirmed },
                        `seller-whatsapp-confirmed:${line.id}`,
                        this.#key,
                      ),
                    )
                  : null,
              ],
            )
          ).rows[0];
      if (input.effect === 'reconcile' && operationState !== 'unknown')
        await client.query(
          "UPDATE crm.seller_whatsapp_challenges SET state='resolved',updated_at=$2 WHERE line_id=$1 AND generation=$3 AND state IN ('delivered','unknown')",
          [line.id, this.#clock(), input.generation],
        );
      if (state === 'blocked' || state === 'disconnected') {
        await client.query(
          'UPDATE crm.seller_whatsapp_bindings SET revoked_at=$2 WHERE line_id=$1 AND revoked_at IS NULL',
          [line.id, this.#clock()],
        );
        await client.query(
          "UPDATE crm.seller_whatsapp_challenges SET state='revoked',updated_at=$2 WHERE line_id=$1 AND state<>'revoked'",
          [line.id, this.#clock()],
        );
      }
      if (operationState === 'unknown' && input.effect !== 'reconcile')
        await this.#reconcile(client, op);
      if (
        state === 'disconnected' &&
        ['succeeded', 'reconciled'].includes(operationState)
      )
        await client.query(
          "UPDATE crm.seller_whatsapp_revocations SET state='completed',updated_at=$2 WHERE current_operation_id=$1 AND state='queued'",
          [op.id, this.#clock()],
        );
      await this.#audit(client, updated, op, `WHATSAPP_${state.toUpperCase()}`);
      return { accepted: true, duplicate: false, stale: false };
    });
  }

  /** Finish an older effect only after a read. Local revocation always wins:
   * observed open can only prepare logout, never restore the old generation.
   * @param {any} client @param {any} line @param {any} op @param {any} revocation @param {{providerState:string,active:boolean}} proof */
  async #completeRevocation(client, line, op, revocation, proof) {
    const absent = ['close', 'absent'].includes(proof.providerState);
    if (!absent && !proof.active) return;
    await client.query(
      "UPDATE crm.seller_whatsapp_operations SET state='reconciled',updated_at=$2 WHERE id=$1",
      [op.id, this.#clock()],
    );
    if (absent) {
      await client.query(
        "UPDATE crm.seller_whatsapp_revocations SET state='completed',updated_at=$2 WHERE id=$1",
        [revocation.id, this.#clock()],
      );
      await client.query(
        'UPDATE crm.seller_whatsapp_lines SET state=$2,version=version+1,verified_at=NULL,updated_at=$3 WHERE id=$1',
        [line.id, proof.active ? 'disconnected' : 'blocked', this.#clock()],
      );
      return;
    }
    const next = (
      await client.query(
        `INSERT INTO crm.seller_whatsapp_operations(id,line_id,generation,action,actor_id,idempotency_key,fingerprint,reference,correlation_id,state,created_at,updated_at)
      VALUES($1,$2,$3,'disconnect',$4,$5,$6,$7,$8,'pending',$9,$9) RETURNING *`,
        [
          randomUUID(),
          line.id,
          line.generation,
          revocation.actor_id,
          revocation.idempotency_key,
          revocation.fingerprint,
          randomUUID(),
          revocation.correlation_id,
          this.#clock(),
        ],
      )
    ).rows[0];
    await client.query(
      "UPDATE crm.seller_whatsapp_revocations SET state='queued',current_operation_id=$2,updated_at=$3 WHERE id=$1",
      [revocation.id, next.id, this.#clock()],
    );
    await client.query(
      "UPDATE crm.seller_whatsapp_lines SET state='disconnecting',version=version+1,updated_at=$2 WHERE id=$1",
      [line.id, this.#clock()],
    );
    await this.#enqueue(client, next, 'disconnect', '');
    await this.#audit(client, line, next, 'WHATSAPP_REVOKED_LOGOUT_PREPARED');
  }

  /** @param {any} input */
  async beginChallenge(input) {
    if (!['qr', 'code'].includes(input.mode)) fail('INVALID_REQUEST', 400);
    const key = id(input.idempotencyKey);
    const fingerprint = sha(
      JSON.stringify({
        operationId: id(input.operationId),
        expectedVersion: positive(input.expectedVersion),
        generation: positive(input.generation),
        mode: input.mode,
        renewChallengeId: input.renewChallengeId
          ? id(input.renewChallengeId)
          : null,
      }),
    );
    return this.#transaction(async (client) => {
      await this.#owner(client, input.actorId);
      const line = await this.#line(client, input.actorId);
      if (!line) fail('WHATSAPP_LINE_NOT_FOUND', 404);
      const replay = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_challenges WHERE actor_id=$1 AND idempotency_key=$2',
          [input.actorId, key],
        )
      ).rows[0];
      if (replay) {
        if (replay.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED');
        fail('WHATSAPP_CHALLENGE_REPLAY');
      }
      if (Number(line.version) !== input.expectedVersion)
        fail('VERSION_CONFLICT');
      if (Number(line.generation) !== input.generation)
        fail('WHATSAPP_GENERATION_STALE');
      const op = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_operations WHERE id=$1 AND line_id=$2 FOR UPDATE',
          [input.operationId, line.id],
        )
      ).rows[0];
      if (
        !op ||
        op.action !== 'connect' ||
        Number(op.generation) !== input.generation
      )
        fail('WHATSAPP_OPERATION_NOT_FOUND', 404);
      if (
        !['succeeded', 'reconciled'].includes(op.state) ||
        line.state !== 'awaiting_pairing'
      )
        fail('WHATSAPP_OPERATION_UNCERTAIN');
      const previous = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_challenges WHERE line_id=$1 AND generation=$2 ORDER BY sequence DESC LIMIT 1 FOR UPDATE',
          [line.id, input.generation],
        )
      ).rows[0];
      if (previous) {
        if (
          input.renewChallengeId !== previous.id ||
          previous.state !== 'resolved'
        )
          fail('WHATSAPP_OPERATION_UNCERTAIN');
        await client.query(
          "UPDATE crm.seller_whatsapp_challenges SET state='revoked',updated_at=$2 WHERE id=$1",
          [previous.id, this.#clock()],
        );
      } else if (input.renewChallengeId) fail('WHATSAPP_CHALLENGE_REPLAY');
      const challengeId = randomUUID();
      const reference = randomUUID();
      const at = this.#clock();
      const expiresAt = new Date(at.getTime() + this.#options.challengeTtlMs);
      await client.query(
        `INSERT INTO crm.seller_whatsapp_challenges(id,operation_id,line_id,generation,actor_id,mode,idempotency_key,fingerprint,reference,state,expires_at,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved',$10,$11,$11)`,
        [
          challengeId,
          op.id,
          line.id,
          input.generation,
          input.actorId,
          input.mode,
          key,
          fingerprint,
          reference,
          expiresAt,
          at,
        ],
      );
      const updated = (
        await client.query(
          'UPDATE crm.seller_whatsapp_lines SET version=version+1,updated_at=$2 WHERE id=$1 RETURNING *',
          [line.id, at],
        )
      ).rows[0];
      await this.#audit(client, updated, op, 'WHATSAPP_CHALLENGE_REQUESTED');
      return {
        challengeId,
        operationId: op.id,
        lineId: line.id,
        generation: input.generation,
        mode: input.mode,
        expiresAt: expiresAt.toISOString(),
        reference,
        version: Number(updated.version),
      };
    });
  }

  /** @param {any} line @param {any} op @param {any} challenge @param {any} envelope */
  #assertChallenge(line, op, challenge, envelope) {
    if (
      !challenge ||
      challenge.operation_id !== op.id ||
      challenge.line_id !== line.id ||
      challenge.id !== envelope.challengeId ||
      Number(challenge.generation) !== envelope.generation ||
      Number(line.generation) !== envelope.generation ||
      challenge.reference !== envelope.reference ||
      challenge.mode !== envelope.mode
    )
      fail('WHATSAPP_GENERATION_STALE');
    if (
      challenge.state !== 'reserved' ||
      new Date(challenge.expires_at) <= this.#clock() ||
      !['succeeded', 'reconciled'].includes(op.state) ||
      line.state !== 'awaiting_pairing'
    )
      fail('WHATSAPP_OPERATION_UNCERTAIN');
  }

  /** @param {any} input */
  async reserveChallenge(input) {
    return this.#transaction(async (client) => {
      const { line, op } = await this.#operationContext(
        client,
        input.operationId,
      );
      const challenge = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_challenges WHERE id=$1 FOR UPDATE',
          [id(input.challengeId)],
        )
      ).rows[0];
      this.#assertChallenge(line, op, challenge, input);
      await client.query(
        "UPDATE crm.seller_whatsapp_challenges SET state='dispatching',updated_at=$2 WHERE id=$1",
        [challenge.id, this.#clock()],
      );
      const previous =
        (
          await client.query(
            'SELECT id FROM crm.seller_whatsapp_challenges WHERE line_id=$1 AND generation=$2 AND id<>$3',
            [line.id, line.generation, challenge.id],
          )
        ).rows.length > 0;
      return {
        ...(await this.#privateControl(client, line, op, 'connect')),
        challengeId: challenge.id,
        mode: challenge.mode,
        expiresAt: new Date(challenge.expires_at).toISOString(),
        reference: challenge.reference,
        renewal: previous,
      };
    });
  }

  /** The caller must discard bytes unless deliverable=true. This final fence
   * runs after the synchronous network call, so revocation/expiry wins.
   * @param {any} input */
  async finishChallenge(input) {
    return this.#transaction(async (client) => {
      const initial = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_operations WHERE id=$1',
          [id(input.operationId)],
        )
      ).rows[0];
      if (!initial) return { deliverable: false };
      const user = (
        await client.query('SELECT * FROM crm.users WHERE id=$1 FOR UPDATE', [
          initial.actor_id,
        ])
      ).rows[0];
      const role = (
        await client.query(
          'SELECT function_name FROM crm.user_functions WHERE user_id=$1',
          [initial.actor_id],
        )
      ).rows[0];
      const line = await this.#line(client, initial.actor_id);
      const op = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_operations WHERE id=$1 FOR UPDATE',
          [initial.id],
        )
      ).rows[0];
      const challenge = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_challenges WHERE id=$1 FOR UPDATE',
          [id(input.challengeId)],
        )
      ).rows[0];
      if (
        !challenge ||
        challenge.operation_id !== op.id ||
        Number(challenge.generation) !== input.generation
      )
        fail('WHATSAPP_GENERATION_STALE');
      if (!['reserved', 'dispatching'].includes(challenge.state))
        return {
          deliverable: false,
          state: challenge.state,
          version: Number(line.version),
        };
      const current =
        !user.disabled_at &&
        role?.function_name === 'Vendedor' &&
        this.#options.enabled === true &&
        this.#sellers.has(initial.actor_id) &&
        Number(line.generation) === input.generation &&
        ['awaiting_pairing', 'unknown'].includes(line.state);
      const deliverable =
        current &&
        challenge.state === 'dispatching' &&
        new Date(challenge.expires_at) > this.#clock() &&
        input.delivered === true &&
        input.uncertain !== true;
      const challengeState = current
        ? deliverable
          ? 'delivered'
          : 'unknown'
        : 'revoked';
      await client.query(
        'UPDATE crm.seller_whatsapp_challenges SET state=$2,updated_at=$3 WHERE id=$1',
        [challenge.id, challengeState, this.#clock()],
      );
      if (current && !deliverable && op.state !== 'unknown') {
        await client.query(
          "UPDATE crm.seller_whatsapp_operations SET state='unknown',updated_at=$2 WHERE id=$1",
          [op.id, this.#clock()],
        );
        await client.query(
          "UPDATE crm.seller_whatsapp_lines SET state='unknown',version=version+1,updated_at=$2 WHERE id=$1",
          [line.id, this.#clock()],
        );
      }
      if (current) await this.#reconcile(client, op);
      return {
        deliverable,
        state: challengeState,
        version: Number(line.version) + (current && !deliverable ? 1 : 0),
      };
    });
  }

  /** @param {{source:any,instance:string,token:string,sender?:string}} input */
  async verifyIngress(input) {
    const source = input.source;
    id(source.bindingId);
    id(source.lineId);
    id(source.accountId);
    positive(source.generation);
    return this.#transaction(async (client) => {
      const initial = (
        await client.query(
          'SELECT seller_id FROM crm.seller_whatsapp_lines WHERE id=$1',
          [source.lineId],
        )
      ).rows[0];
      if (!initial) fail('FORBIDDEN', 403);
      const owner = await this.#owner(client, initial.seller_id, true, true);
      const line = await this.#line(client, initial.seller_id);
      const role = (
        await client.query(
          'SELECT function_name FROM crm.user_functions WHERE user_id=$1',
          [initial.seller_id],
        )
      ).rows[0];
      const inactive = Boolean(
        owner.disabled_at || role?.function_name !== 'Vendedor',
      );
      const binding = (
        await client.query(
          'SELECT * FROM crm.seller_whatsapp_bindings WHERE id=$1',
          [source.bindingId],
        )
      ).rows[0];
      const tokenHash =
        typeof input.token === 'string' &&
        /^[A-Za-z0-9_-]{32,128}$/u.test(input.token)
          ? sha(input.token)
          : '0'.repeat(64);
      if (
        !binding ||
        (!inactive && binding.revoked_at) ||
        binding.line_id !== line.id ||
        binding.account_id !== source.accountId ||
        line.account_id !== source.accountId ||
        Number(binding.generation) !== source.generation ||
        (inactive
          ? !(
              line.state === 'blocked' &&
              line.verified_at &&
              line.confirmed_number_envelope &&
              Number(line.generation) === source.generation + 1
            )
          : Number(line.generation) !== source.generation) ||
        binding.instance_name !== input.instance ||
        line.instance_name !== input.instance ||
        (input.sender !== undefined &&
          this.#digest(input.sender.split('@')[0]) !== line.number_digest) ||
        !timingSafeEqual(
          Buffer.from(binding.token_hash, 'hex'),
          Buffer.from(tokenHash, 'hex'),
        ) ||
        (!(inactive && line.state === 'blocked') &&
          ![
            'preparing',
            'awaiting_pairing',
            'validating',
            'connected',
            'unknown',
          ].includes(line.state))
      )
        fail('FORBIDDEN', 403);
      return {
        source: {
          bindingId: binding.id,
          lineId: line.id,
          accountId: line.account_id,
          generation: source.generation,
        },
        instance: line.instance_name,
      };
    });
  }

  /** Crash recovery schedules reads only. A process lost after its effect fence
   * never makes the original mutating job eligible to run again.
   * @param {{staleAfterMs?:number}} [options] */
  async scheduleReconciliations(options = {}) {
    if (this.#options.enabled !== true) return { scheduled: 0 };
    const staleAfterMs = options.staleAfterMs ?? 30_000;
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1000)
      fail('INVALID_REQUEST', 400);
    const cutoff = new Date(this.#clock().getTime() - staleAfterMs);
    const candidates = (
      await this.#database.query(
        `SELECT DISTINCT o.id FROM crm.seller_whatsapp_operations o
      JOIN crm.seller_whatsapp_lines l ON l.id=o.line_id
      WHERE ((o.generation=l.generation AND l.state<>'blocked') OR EXISTS(
        SELECT 1 FROM crm.seller_whatsapp_revocations r WHERE r.previous_operation_id=o.id AND r.state='waiting_reconciliation'))
      AND o.updated_at<$1
      AND (o.state IN ('dispatching','unknown') OR (o.state='pending' AND EXISTS(
        SELECT 1 FROM crm.outbox_jobs j WHERE j.whatsapp_operation_id=o.id
          AND j.job_type='whatsapp.control.deliver' AND j.status IN ('dead_letter','outcome_unknown','completed')))
        OR EXISTS(SELECT 1 FROM crm.seller_whatsapp_challenges c
        WHERE c.operation_id=o.id AND (c.state IN ('reserved','dispatching','delivered','unknown')
          OR (c.state='resolved' AND l.state='awaiting_pairing')) AND c.updated_at<$1))
      ORDER BY o.id LIMIT 50`,
        [cutoff],
      )
    ).rows;
    let scheduled = 0;
    for (const candidate of candidates) {
      const changed = await this.#transaction(async (client) => {
        let context;
        try {
          context = await this.#operationContext(
            client,
            candidate.id,
            true,
            true,
          );
        } catch (error) {
          if (
            error instanceof SellerWhatsAppError &&
            ['FORBIDDEN', 'WHATSAPP_CONTROL_DISABLED'].includes(error.code)
          )
            return false;
          throw error;
        }
        const { line, op } = context;
        if (new Date(op.updated_at) >= cutoff) return false;
        const queued = (
          await client.query(
            "SELECT id FROM crm.outbox_jobs WHERE whatsapp_operation_id=$1 AND whatsapp_action='reconcile' AND status IN ('pending','processing','retry')",
            [op.id],
          )
        ).rows[0];
        if (queued) return false;
        if (op.state === 'dispatching' || op.state === 'pending') {
          await client.query(
            "UPDATE crm.seller_whatsapp_operations SET state='unknown',updated_at=$2 WHERE id=$1",
            [op.id, this.#clock()],
          );
          if (
            Number(line.generation) === Number(op.generation) &&
            line.state !== 'blocked'
          )
            await client.query(
              "UPDATE crm.seller_whatsapp_lines SET state='unknown',version=version+1,updated_at=$2 WHERE id=$1",
              [line.id, this.#clock()],
            );
        }
        const lostChallenges = await client.query(
          "UPDATE crm.seller_whatsapp_challenges SET state='unknown',updated_at=$2 WHERE operation_id=$1 AND state IN ('reserved','dispatching') AND updated_at<$3 RETURNING id",
          [op.id, this.#clock(), cutoff],
        );
        if (
          lostChallenges.rows.length &&
          ['succeeded', 'reconciled'].includes(op.state)
        ) {
          await client.query(
            "UPDATE crm.seller_whatsapp_operations SET state='unknown',updated_at=$2 WHERE id=$1",
            [op.id, this.#clock()],
          );
          await client.query(
            "UPDATE crm.seller_whatsapp_lines SET state='unknown',version=version+1,updated_at=$2 WHERE id=$1",
            [line.id, this.#clock()],
          );
        }
        await this.#reconcile(client, op);
        return true;
      });
      if (changed) scheduled += 1;
    }
    return { scheduled };
  }
}
