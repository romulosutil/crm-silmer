import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** @type {import('vite').ViteDevServer} */ let server;
let origin = '';
const png = await readFile('test/fixtures/media-composer.png');
const audio = await readFile('test/fixtures/media-composer.m4a');
const video = await readFile('test/fixtures/media-composer.mp4');
test.beforeAll(async () => {
  server = await createServer({
    configFile: resolve('apps/edge-web/vite.config.js'),
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'silent',
    plugins: [
      {
        name: 'isolated-media-composer-fixture',
        configureServer(devServer) {
          devServer.middlewares.use(
            '/__media-composer',
            async (req, res, next) => {
              if (req.url?.includes('html-proxy')) return next();
              res.setHeader('Content-Type', 'text/html');
              res.end(
                await devServer.transformIndexHtml(
                  '/__media-composer',
                  (
                    await readFile('test/fixtures/media-composer.html', 'utf8')
                  ).replace(
                    '__FIXTURE_MODULE__',
                    resolve('test/fixtures/media-composer.js').replaceAll(
                      '\\',
                      '/',
                    ),
                  ),
                ),
              );
            },
          );
        },
      },
    ],
  });
  await server.listen();
  const address = /** @type {import('node:net').AddressInfo} */ (
    server.httpServer?.address()
  );
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
/** @param {import('@playwright/test').Page} page @param {any} [options] */
async function setup(page, options = {}) {
  const uploads = /** @type {import('@playwright/test').Request[]} */ ([]),
    sends = /** @type {import('@playwright/test').Request[]} */ ([]);
  let polls = 0;
  await page.route('**/api/v1/conversations/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && path.endsWith('/media')) {
      uploads.push(req);
      if (
        options.uploadDelay &&
        (!options.oldOnly || path.includes('conversation-1'))
      )
        await new Promise((resolve) =>
          setTimeout(resolve, options.uploadDelay),
        );
      if (options.uploadError && uploads.length === 1)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'SERVICE_UNAVAILABLE' } },
        });
      return route.fulfill({
        status: 202,
        json: {
          mediaId: path.includes('conversation-2') ? 'media-2' : 'media-1',
          state: 'processing',
        },
      });
    }
    if (req.method() === 'POST' && path.endsWith('/messages')) {
      sends.push(req);
      if (options.pendingSend && sends.length === 1) return;
      if (options.sendError && sends.length === 1) return route.abort('failed');
      return route.fulfill({
        status: 202,
        json: { id: 'message-1', status: 'pending' },
      });
    }
    polls++;
    if (options.pendingStatus) return;
    return route.fulfill({
      status: 200,
      json: {
        mediaId: path.includes('conversation-2') ? 'media-2' : 'media-1',
        kind: options.kind ?? 'image',
        state: options.rejected
          ? 'rejected'
          : options.processingForever
            ? 'processing'
            : options.processing && polls === 1
              ? 'processing'
              : 'ready',
        reason: options.rejected ? 'invalid_format' : undefined,
      },
    });
  });
  await page.goto(origin + '/__media-composer');
  return { uploads, sends };
}
/** @param {import('@playwright/test').Page} page @param {string} [name] @param {string} [mime] */
async function select(page, name = 'sample.png', mime = 'image/png') {
  await page.getByLabel('Arquivo para anexar').setInputFiles({
    name,
    mimeType: mime,
    buffer:
      name === 'renamed.png'
        ? Buffer.from('invalid bytes renamed as PNG')
        : name.endsWith('.m4a')
          ? audio
          : name.endsWith('.mp4')
            ? video
            : png,
  });
}
/** @param {import('@playwright/test').Page} page */
async function ready(page) {
  await page.getByRole('button', { name: 'Preparar arquivo' }).click();
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeEnabled();
}

for (const [kind, name, mime] of [
  ['image', 'sample.png', 'image/png'],
  ['audio', 'sample.m4a', 'audio/x-m4a'],
  ['audio', 'sample.m4a', 'audio/m4a'],
  ['video', 'sample.mp4', 'video/mp4'],
])
  test(`T18/MED-01/02/03: explicit ${kind} ${mime} review sends exactly one ready media with native multipart`, async ({
    page,
  }) => {
    const { uploads, sends } = await setup(page, { kind, processing: true });
    await select(page, name, mime);
    await expect(
      page.getByRole('button', { name: 'Enviar anexo', exact: true }),
    ).toBeDisabled();
    expect(uploads).toHaveLength(0);
    expect(sends).toHaveLength(0);
    await ready(page);
    if (kind === 'audio')
      await expect(page.getByLabel('Legenda')).toHaveCount(0);
    else await page.getByLabel('Legenda').fill('Revisão explícita');
    expect(sends).toHaveLength(0);
    await page
      .getByRole('button', { name: 'Enviar anexo', exact: true })
      .click();
    await expect(
      page.getByText('Mensagem enviada', { exact: true }),
    ).toBeVisible();
    expect(uploads).toHaveLength(1);
    expect(sends).toHaveLength(1);
    expect(uploads[0].headers()['content-type']).toContain(
      'multipart/form-data; boundary=',
    );
    expect(sends[0].postDataJSON()).toEqual({
      expectedVersion: 4,
      messageType: kind,
      content:
        kind === 'audio'
          ? { mediaId: 'media-1' }
          : { mediaId: 'media-1', caption: 'Revisão explícita' },
      reason: 'Envio humano de anexo',
    });
  });
test('T18/MED-04: empty MIME is a hint and renamed invalid bytes are rejected by processing', async ({
  page,
}) => {
  const { uploads, sends } = await setup(page, { rejected: true });
  await select(page, 'renamed.png', '');
  await page.getByRole('button', { name: 'Preparar arquivo' }).click();
  await expect(page.getByRole('alert')).toContainText('Formato inválido');
  await expect(
    page.getByRole('img', { name: 'Prévia do anexo' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeDisabled();
  expect(uploads).toHaveLength(1);
  expect(sends).toHaveLength(0);
});
test('T18/MED-01/04: approved empty-MIME file can complete byte validation and send', async ({
  page,
}) => {
  const { sends } = await setup(page);
  await select(page, 'sample.png', '');
  await ready(page);
  await page.getByRole('button', { name: 'Enviar anexo', exact: true }).click();
  await expect(
    page.getByText('Mensagem enviada', { exact: true }),
  ).toBeVisible();
  expect(sends).toHaveLength(1);
});
test('T18/MED-04: caption counts Unicode code points including 1024 emoji', async ({
  page,
}) => {
  const { sends } = await setup(page);
  await select(page);
  await ready(page);
  const caption = page.getByLabel('Legenda');
  await caption.fill('😀'.repeat(1025));
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeDisabled();
  await caption.fill('😀'.repeat(1024));
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Enviar anexo', exact: true }).click();
  await expect(
    page.getByText('Mensagem enviada', { exact: true }),
  ).toBeVisible();
  expect([...sends[0].postDataJSON().content.caption]).toHaveLength(1024);
});
test('T18/MED-06: retry preserves original upload key, file and version after network error', async ({
  page,
}) => {
  const { uploads } = await setup(page, { uploadError: true });
  await select(page);
  await page.getByRole('button', { name: 'Preparar arquivo' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Prévia do anexo' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Tentar preparar novamente' }).click();
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeEnabled();
  expect(uploads).toHaveLength(2);
  expect(uploads[0].headers()['idempotency-key']).toEqual(
    uploads[1].headers()['idempotency-key'],
  );
  expect(uploads[0].postData()).toContain('sample.png');
  expect(uploads[1].postData()).toContain('name="expectedVersion"\r\n\r\n4');
});
test('T18/MED-06: uncertain send preserves preview, payload and original send key', async ({
  page,
}) => {
  const { sends } = await setup(page, { sendError: true });
  await select(page);
  await ready(page);
  await page.getByLabel('Legenda').fill('Original');
  await page.getByRole('button', { name: 'Enviar anexo', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Prévia do anexo' }),
  ).toBeVisible();
  await expect(page.getByLabel('Legenda')).toBeDisabled();
  await page.getByRole('button', { name: 'Tentar enviar novamente' }).click();
  await expect(
    page.getByText('Mensagem enviada', { exact: true }),
  ).toBeVisible();
  expect(sends).toHaveLength(2);
  expect(sends[0].headers()['idempotency-key']).toEqual(
    sends[1].headers()['idempotency-key'],
  );
  expect(sends[0].postDataJSON()).toEqual(sends[1].postDataJSON());
});
test('T18/MED-06/25: reenable after pending send retries the immutable original attempt explicitly', async ({
  page,
}) => {
  const { uploads, sends } = await setup(page, { pendingSend: true });
  await select(page);
  await ready(page);
  await page.getByLabel('Legenda').fill('Original');
  await page.getByRole('button', { name: 'Enviar anexo', exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  await page.getByRole('button', { name: 'Bloquear envio' }).click();
  const retry = page.getByRole('button', { name: 'Tentar enviar novamente' });
  await expect(retry).toBeDisabled();
  await expect(page.getByLabel('Legenda')).toBeDisabled();
  await page.getByRole('button', { name: 'Reabilitar envio' }).click();
  await expect(retry).toBeEnabled();
  expect(sends).toHaveLength(1);
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Mensagem enviada', { exact: true }),
  ).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(sends).toHaveLength(2);
  expect(sends[0].headers()['idempotency-key']).toEqual(
    sends[1].headers()['idempotency-key'],
  );
  expect(sends[0].postDataJSON()).toEqual(sends[1].postDataJSON());
  expect(new URL(sends[1].url()).pathname).toBe(
    '/api/v1/conversations/conversation-1/messages',
  );
  expect(sends[1].postDataJSON()).toEqual({
    expectedVersion: 4,
    messageType: 'image',
    content: { mediaId: 'media-1', caption: 'Original' },
    reason: 'Envio humano de anexo',
  });
});

test('T18/MED-25: remove and reselect by keyboard restores focus and clears the previous draft', async ({
  page,
}) => {
  await setup(page);
  await select(page);
  const remove = page.getByRole('button', { name: 'Remover anexo' });
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Arquivo para anexar')).toBeFocused();
  await expect(page.getByRole('img', { name: 'Prévia do anexo' })).toHaveCount(
    0,
  );
  await select(page);
  await page.getByRole('button', { name: 'Preparar arquivo' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeFocused();
});
test('T18/MED-07/08: switch or unmount cancels stale upload and cannot send it in another conversation', async ({
  page,
}) => {
  const { sends } = await setup(page, { uploadDelay: 250 });
  await select(page);
  await page.getByRole('button', { name: 'Preparar arquivo' }).click();
  await page.getByRole('button', { name: 'Trocar conversa' }).click();
  await expect(page.getByRole('img', { name: 'Prévia do anexo' })).toHaveCount(
    0,
  );
  await page.waitForTimeout(350);
  expect(sends).toHaveLength(0);
  await select(page);
  await page.getByRole('button', { name: 'Preparar arquivo' }).click();
  await page.getByRole('button', { name: 'Fechar composer' }).click();
  await page.waitForTimeout(350);
  expect(sends).toHaveLength(0);
});
test('T18/MED-08/25: blocked composer has no upload action and passes axe with a ready draft', async ({
  page,
}) => {
  const { uploads, sends } = await setup(page);
  await select(page);
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Bloquear envio' }).click();
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeDisabled();
  expect(uploads).toHaveLength(1);
  expect(sends).toHaveLength(0);
});
test('T18/MED-07/08: delayed original upload cannot replace the new conversation draft', async ({
  page,
}) => {
  const { uploads, sends } = await setup(page, {
    uploadDelay: 250,
    oldOnly: true,
  });
  await select(page);
  await page.getByRole('button', { name: 'Preparar arquivo' }).click();
  await page.getByRole('button', { name: 'Trocar conversa' }).click();
  await select(page);
  await ready(page);
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Enviar anexo', exact: true }).click();
  await expect(
    page.getByText('Mensagem enviada', { exact: true }),
  ).toBeVisible();
  expect(uploads).toHaveLength(2);
  expect(sends).toHaveLength(1);
  expect(new URL(sends[0].url()).pathname).toBe(
    '/api/v1/conversations/conversation-2/messages',
  );
  expect(sends[0].postDataJSON().content.mediaId).toBe('media-2');
});
test('T18/MED-04: valid local pipeline beyond 340 seconds remains eligible before polling budget expires', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-06T00:00:00Z') });
  await setup(page, { processing: true });
  await select(page);
  await page.getByRole('button', { name: 'Preparar arquivo' }).click();
  await expect(page.getByRole('status')).toContainText('Validando arquivo');
  await page.clock.fastForward(350000);
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('T18/MED-04/06: polling timeout preserves media ID and a status retry can observe the eventual ready state', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-06T00:00:00Z') });
  const options = { processingForever: true };
  const { uploads } = await setup(page, options);
  await select(page);
  await page.getByRole('button', { name: 'Preparar arquivo' }).click();
  await expect(page.getByRole('status')).toContainText('Validando arquivo');
  const secondPoll = page.waitForResponse('**/media/media-1');
  await page.clock.fastForward(599000);
  await (await secondPoll).finished();
  await page.clock.runFor(1000);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Prévia do anexo' }),
  ).toBeVisible();
  options.processingForever = false;
  await page.getByRole('button', { name: 'Atualizar validação' }).click();
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeEnabled();
  expect(uploads).toHaveLength(1);
});

test('T18/MED-04/06: polling budget aborts a pending status GET without losing the draft', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-06T00:00:00Z') });
  const { uploads } = await setup(page, { pendingStatus: true });
  await select(page);
  const pending = page.waitForRequest('**/media/media-1');
  await page.getByRole('button', { name: 'Preparar arquivo' }).click();
  await pending;
  await page.clock.fastForward(600000);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Prévia do anexo' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Atualizar validação' }),
  ).toBeEnabled();
  expect(uploads).toHaveLength(1);
});
