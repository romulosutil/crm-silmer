import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const EVOLUTION_BUNDLE_SHA256 =
  '71b49ea87b8d0d7b413b77d067e33a8720c2e95e136f632210c1424862ef6b44';
export const WAP_GENERATION_RUNTIME_PATH =
  '/evolution/silmer-wap-generation.cjs';
const METHOD_START =
  'async emit({instanceName:e,origin:t,event:o,data:i,serverUrl:n,dateTime:r,sender:a,apiKey:c,local:l,integration:u,extra:m}){';
const BODY =
  'C={...m??{},event:o,instance:e,data:i,destination:d?.url||`${h.GLOBAL.URL}/${w}`,date_time:r,sender:a,server_url:n,apikey:c};';
// Complete Prisma writeData function extracted from the pinned bundle. Other
// file/Redis adapters are intentionally outside this fixed PostgreSQL profile.
export const PRISMA_CREDENTIAL_WRITER =
  'async function o(c,l){let u=JSON.stringify(c,st.BufferJSON.replacer),m=E.get("CACHE");if(l!="creds"){if(m.REDIS.ENABLED)return await s.hSet(p,l,c);await vt.default.writeFile(t(l),u);return}await cu(p,u)}';

/** @returns {string} */
export function patchedPrismaCredentialWriter() {
  return PRISMA_CREDENTIAL_WRITER.replace(
    'JSON.stringify(c,st.BufferJSON.replacer)',
    `JSON.stringify(l==="creds"?require(${JSON.stringify(WAP_GENERATION_RUNTIME_PATH)}).persistableCredentials(c):c,st.BufferJSON.replacer)`,
  );
}

/** @param {string} bundle @returns {string} */
export function patchEvolutionGeneration(bundle) {
  if (
    createHash('sha256').update(bundle).digest('hex') !==
    EVOLUTION_BUNDLE_SHA256
  )
    throw new Error('WAP_EVOLUTION_BUNDLE_MISMATCH');
  const runtime = `require(${JSON.stringify(WAP_GENERATION_RUNTIME_PATH)})`;
  const replacements = [
    [PRISMA_CREDENTIAL_WRITER, patchedPrismaCredentialWriter()],
    [
      's.connectionStatus==="open"||s.connectionStatus==="connecting"?(this.logger.info(`Auto-connecting instance',
      `(s.connectionStatus==="open"||s.connectionStatus==="connecting")&&!${runtime}.deferUnpairedStartup(s.instanceName,s.connectionStatus,s.ownerJid)?(this.logger.info(\`Auto-connecting instance`,
    ],
    [
      'eventHandler(){this.client.ev.process(async e=>{',
      `eventHandler(){const silmerWapRuntime=${runtime},silmerWapSource=silmerWapRuntime.captureSocket(this.instanceName,this.client);const silmerWapProcess=cb=>this.client.ev.process(silmerWapRuntime.wrap(silmerWapSource,cb));silmerWapProcess(async e=>{`,
    ],
    [
      `${METHOD_START}if(u&&!u.includes("webhook"))return;`,
      `${METHOD_START}const silmerWapRuntime=${runtime};let silmerWapSource;try{silmerWapSource=silmerWapRuntime.current(e,o)}catch{this.logger.warn("WAP_GENERATION_EVENT_REJECTED");return;}if(u&&!u.includes("webhook"))return;`,
    ],
    [
      'g=d?.events,f={...d?.headers||{}};',
      'g=d?.events,f=silmerWapRuntime.headers(silmerWapSource,{...d?.headers||{}});',
    ],
    [
      BODY,
      `C;try{C=silmerWapRuntime.envelope(silmerWapSource,${BODY.slice(2, -1)});}catch{this.logger.warn("WAP_GENERATION_EVENT_REJECTED");return;}`,
    ],
  ];
  let patched = bundle;
  for (const [before, after] of replacements) {
    if (patched.split(before).length !== 2)
      throw new Error('WAP_EVOLUTION_ANCHOR_MISMATCH');
    patched = patched.replace(before, after);
  }
  return patched;
}

/** Extract complete real methods from the exact patched bundle for synthetic event
 * rehearsal. No server startup or WhatsApp protocol is evaluated.
 * @param {string} patched @returns {Record<string,string>}
 */
export function extractGenerationMethods(patched) {
  /** @type {Record<string,string>} */
  const snippets = {};
  for (const [name, start, end] of [
    [
      'eventHandler',
      'eventHandler(){const silmerWapRuntime=',
      'historySyncNotification(e){',
    ],
    [
      'connectionUpdate',
      'async connectionUpdate({qr:e,connection:t,lastDisconnect:o}){',
      'async getMessage(e,t=!1){',
    ],
    [
      'sendDataWebhook',
      'async sendDataWebhook(s,e,t=!0,o,i){',
      'formatMXOrARNumber(s){',
    ],
    [
      'emit',
      `${METHOD_START}const silmerWapRuntime=`,
      'async retryWebhookRequest(e,t,o,i,n,r,a){',
    ],
    [
      'retryWebhookRequest',
      'async retryWebhookRequest(e,t,o,i,n,r,a){',
      'generateJwtToken(e){',
    ],
  ]) {
    const begin = patched.indexOf(start);
    const finish = patched.indexOf(end, begin);
    if (begin < 0 || finish <= begin || patched.indexOf(start, begin + 1) >= 0)
      throw new Error('WAP_EVOLUTION_EXTRACTION_MISMATCH');
    snippets[name] = patched.slice(begin, finish);
  }
  return snippets;
}

/** @param {string} patched @returns {string} */
export function extractPrismaCredentialWriter(patched) {
  const method = patchedPrismaCredentialWriter();
  if (patched.split(method).length !== 2)
    throw new Error('WAP_EVOLUTION_CREDENTIAL_WRITER_MISMATCH');
  return method;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const filename = process.argv[2];
  if (!filename) throw new Error('WAP_EVOLUTION_BUNDLE_PATH_REQUIRED');
  const patched = patchEvolutionGeneration(await readFile(filename, 'utf8'));
  extractGenerationMethods(patched);
  extractPrismaCredentialWriter(patched);
  await writeFile(filename, patched);
  process.stdout.write('WAP_EVOLUTION_GENERATION_PATCHED\n');
}
