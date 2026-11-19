import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = new URL('./', import.meta.url);

/** Render the self-contained Dockerfile pasted into the EasyPanel n8n source.
 * Same base and steps as wap-ingress-Dockerfile; sources are embedded verbatim.
 * @returns {Promise<string>} */
export async function renderWapIngressDockerfile() {
  const recipe = await readFile(
    new URL('wap-ingress-Dockerfile', root),
    'utf8',
  );
  const base = recipe.split('\n').filter((line) => line.startsWith('FROM '));
  if (base.length !== 1) throw new Error('WAP_N8N_BASE_MISMATCH');
  const runtime = await readFile(
    new URL('wap-ingress-runtime.cjs', root),
    'utf8',
  );
  const patch = await readFile(new URL('wap-ingress-patch.mjs', root), 'utf8');
  for (const [source, marker] of [
    [runtime, 'SILMER_WAP_INGRESS_RUNTIME_EOF'],
    [patch, 'SILMER_WAP_INGRESS_PATCH_EOF'],
  ])
    if (!source.endsWith('\n') || source.includes(marker))
      throw new Error('WAP_N8N_INLINE_SOURCE_INVALID');
  return `# syntax=docker/dockerfile:1.7
# WAP-E01/E12. Inline render of ops/n8n/wap-ingress-Dockerfile for EasyPanel;
# all personal ingress remains default off.
${base[0]}
USER root
COPY <<'SILMER_WAP_INGRESS_RUNTIME_EOF' /opt/silmer/wap-ingress-runtime.cjs
${runtime}SILMER_WAP_INGRESS_RUNTIME_EOF
COPY <<'SILMER_WAP_INGRESS_PATCH_EOF' /opt/silmer/wap-ingress-patch.mjs
${patch}SILMER_WAP_INGRESS_PATCH_EOF
RUN node /opt/silmer/wap-ingress-patch.mjs /usr/local/lib/node_modules/n8n
USER node
`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await writeFile(
    new URL('wap-ingress-Dockerfile.inline', root),
    await renderWapIngressDockerfile(),
  );
}
