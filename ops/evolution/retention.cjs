'use strict';

const RETENTION_SECONDS = 7 * 24 * 60 * 60;
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function invalid() {
  throw new Error('EVOLUTION_RETENTION_CONFIGURATION_INVALID');
}

// WAP-E12: the general transport plus every personal instance the generation
// allowlist names. Listed instances stay covered after a rollback to
// generation off, so their rows still age out. Mirrors the generation runtime:
// literal flag, IDs only, no duplicates, enabled requires a list.
function retentionInstances(env) {
  const flag = env.SILMER_WAP_GENERATION_ENABLED;
  const raw = env.SILMER_WAP_GENERATION_INSTANCES ?? '';
  const personal = raw === '' ? [] : raw.split(',');
  const instances = [env.SILMER_EVOLUTION_INSTANCE, ...personal];
  if (
    (flag !== undefined && !['true', 'false'].includes(flag)) ||
    (flag === 'true' && !personal.length) ||
    instances.some((name) => typeof name !== 'string' || !ID.test(name)) ||
    new Set(instances).size !== instances.length
  )
    invalid();
  return instances;
}

async function purgeExpiredMessages(prisma, { instances, now = Date.now() }) {
  if (
    !Array.isArray(instances) ||
    !instances.length ||
    instances.some((name) => typeof name !== 'string' || !ID.test(name)) ||
    new Set(instances).size !== instances.length ||
    !Number.isFinite(now) ||
    now <= RETENTION_SECONDS * 1000
  )
    invalid();
  // Only the dedicated transport's Message rows are eligible. Official schema
  // cascades MessageUpdate and Media; Instance/Session are never mutation targets.
  // One parameterised Prisma statement; names are bound values, never SQL text.
  return prisma.message.deleteMany({
    where: {
      Instance: { is: { name: { in: [...instances] } } },
      messageTimestamp: { lt: Math.floor(now / 1000) - RETENTION_SECONDS },
    },
  });
}

function scheduleRetention(
  prisma,
  { instances, report, schedule = setInterval },
) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await purgeExpiredMessages(prisma, { instances });
      report('EVOLUTION_RETENTION_COMPLETED');
    } catch {
      report('EVOLUTION_RETENTION_FAILED');
    } finally {
      running = false;
    }
  };
  const timer = schedule(tick, RETENTION_INTERVAL_MS);
  timer.unref?.();
  return { timer, tick };
}

module.exports = {
  RETENTION_SECONDS,
  RETENTION_INTERVAL_MS,
  retentionInstances,
  purgeExpiredMessages,
  scheduleRetention,
};

if (require.main === module) {
  (async () => {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ log: [] });
    try {
      await purgeExpiredMessages(prisma, {
        instances: retentionInstances(process.env),
      });
      process.stdout.write('EVOLUTION_RETENTION_COMPLETED\n');
    } catch {
      process.stderr.write('EVOLUTION_RETENTION_FAILED\n');
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  })().catch(() => {
    process.stderr.write('EVOLUTION_RETENTION_FAILED\n');
    process.exitCode = 1;
  });
}
