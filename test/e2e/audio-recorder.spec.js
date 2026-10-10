import { expect, test, chromium, firefox } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** @type {import('vite').ViteDevServer} */ let server;
let origin = '';
test.beforeAll(async () => {
  server = await createServer({
    configFile: resolve('apps/edge-web/vite.config.js'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'recorder-fixture',
        configureServer(s) {
          s.middlewares.use('/__recorder', async (req, res, next) => {
            if (req.url?.includes('html-proxy')) return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(
              await s.transformIndexHtml(
                '/__recorder',
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
          });
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
  await page.addInitScript((options) => {
    const evidence = /** @type {any} */ (
      /** @type {any} */ (globalThis).__capture = {
        requests: [],
        stops: 0,
        starts: 0,
        revoked: [],
        chunks: [],
        recorder: null,
        resolve: null,
      }
    );
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      evidence.revoked.push(url);
      revoke(url);
    };
    const stream = /** @type {MediaStream} */ (
      /** @type {unknown} */ ({
        getTracks: () => [{ stop: () => evidence.stops++ }],
      })
    );
    globalThis.navigator.mediaDevices.getUserMedia = (constraints) => {
      evidence.requests.push(constraints);
      if (options.captureError)
        return Promise.reject(
          new globalThis.DOMException(
            'PRIVATE_CAPTURE_ERROR',
            options.captureError,
          ),
        );
      if (options.denied)
        return Promise.reject(
          new globalThis.DOMException('Denied', 'NotAllowedError'),
        );
      if (options.late)
        return new Promise((resolve) => {
          evidence.resolve = () => resolve(stream);
        });
      return Promise.resolve(stream);
    };
    class FakeRecorder extends globalThis.EventTarget {
      /** @param {string} type */
      static isTypeSupported(type) {
        return type === (options.supported ?? 'audio/ogg;codecs=opus');
      }
      /** @param {MediaStream} _stream @param {{mimeType:string}} config */
      constructor(_stream, config) {
        super();
        this.mimeType = config.mimeType;
        this.state = 'inactive';
        evidence.recorder = this;
      }
      start() {
        if (options.encoderFailure)
          throw new globalThis.DOMException(
            'Encoder unavailable',
            'NotSupportedError',
          );
        this.state = 'recording';
        evidence.starts++;
      }
      stop() {
        this.state = 'inactive';
        globalThis.queueMicrotask(() => {
          if (!options.empty) this.chunk(options.bytes ?? 128);
          this.dispatchEvent(new globalThis.Event('stop'));
        });
      }
      /** @param {number} bytes */
      chunk(bytes) {
        this.dispatchEvent(
          new globalThis.MessageEvent('dataavailable', {
            data: new globalThis.Blob([new Uint8Array(bytes)], {
              type: this.mimeType,
            }),
          }),
        );
      }
    }
    /** @type {any} */ (globalThis).MediaRecorder = options.unavailable
      ? undefined
      : FakeRecorder;
  }, options);
  const uploads = /** @type {import('@playwright/test').Request[]} */ ([]),
    sends = /** @type {import('@playwright/test').Request[]} */ ([]);
  await page.route('**/api/v1/conversations/**', (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.url().endsWith('/messages')) {
      sends.push(req);
      return route.fulfill({ status: 202, json: { id: 'message-1' } });
    }
    if (req.method() === 'POST') {
      uploads.push(req);
      return route.fulfill({
        status: 202,
        json: { mediaId: 'recording-1', state: 'processing' },
      });
    }
    return route.fulfill({
      status: 200,
      json: { mediaId: 'recording-1', state: 'ready' },
    });
  });
  await page.goto(origin + '/__recorder?recorder');
  return { uploads, sends };
}
/** @param {import('@playwright/test').Page} page */
async function record(page) {
  await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Parar gravação' }),
  ).toBeVisible();
}
/** @param {import('@playwright/test').Page} page */
async function stop(page) {
  await page.getByRole('button', { name: 'Parar gravação' }).click();
  await expect(page.getByLabel('Prévia do áudio')).toBeVisible();
}

test('T19/T25/MED-09/10/25/30: explicit keyboard recording asks permission, stop validates automatically and send remains explicit', async ({
  page,
}) => {
  const { uploads, sends } = await setup(page);
  expect(
    await page.evaluate(
      () => /** @type {any} */ (globalThis).__capture.requests,
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Gravar áudio', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Parar gravação' }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => /** @type {any} */ (globalThis).__capture.requests,
    ),
  ).toEqual([{ audio: true }]);
  await stop(page);
  expect(
    await page.evaluate(() => /** @type {any} */ (globalThis).__capture.stops),
  ).toBe(1);
  await expect.poll(() => uploads.length).toBe(1);
  expect(sends).toHaveLength(0);
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeEnabled();
  expect(sends).toHaveLength(0);
  await page.getByRole('button', { name: 'Enviar anexo', exact: true }).click();
  await expect(
    page.getByText('Mensagem enviada', { exact: true }),
  ).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(sends).toHaveLength(1);
  expect(uploads[0].postData()).toContain('name="origin"\r\n\r\nrecording');
  expect(uploads[0].postData()).toContain('Content-Type: audio/ogg');
  expect(sends[0].postDataJSON().content).toEqual({ mediaId: 'recording-1' });
});
for (const [captureError, message] of [
  [
    'NotFoundError',
    'Nenhum microfone foi encontrado. Conecte um microfone e confira o dispositivo de entrada do sistema.',
  ],
  [
    'NotReadableError',
    'Não foi possível acessar o microfone. Confira o dispositivo de entrada e o acesso ao microfone nas configurações do sistema.',
  ],
  [
    'SecurityError',
    'Este navegador bloqueou o acesso ao microfone. Permita o microfone ou abra o chat no Chrome ou Edge.',
  ],
  [
    'AbortError',
    'A abertura do microfone foi interrompida. Tente gravar novamente.',
  ],
  [
    'UnknownError',
    'Não foi possível iniciar a gravação. Você pode anexar um arquivo de áudio.',
  ],
])
  test(`T27/MED-11: ${captureError} explains recovery without private details`, async ({
    page,
  }) => {
    const { uploads, sends } = await setup(page, { captureError });
    await page
      .getByRole('button', { name: 'Gravar áudio', exact: true })
      .click();
    await expect(page.getByRole('alert')).toHaveText(message);
    await expect(
      page.getByRole('button', { name: 'Gravar áudio', exact: true }),
    ).toBeFocused();
    await expect(page.getByLabel('Arquivo para anexar')).toBeEnabled();
    expect(uploads).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });

for (const mode of ['denied', 'unavailable', 'encoderFailure'])
  test(`T19/MED-11: ${mode} leaves audio attachments usable`, async ({
    page,
  }) => {
    await setup(page, { [mode]: true });
    await page
      .getByRole('button', { name: 'Gravar áudio', exact: true })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('Arquivo para anexar')).toBeEnabled();
    if (mode === 'encoderFailure') {
      await expect(page.getByRole('alert')).toHaveText(
        'Este navegador não conseguiu iniciar o gravador de áudio. Abra o chat no Chrome ou Edge ou anexe um áudio.',
      );
      expect(
        await page.evaluate(
          () => /** @type {any} */ (globalThis).__capture.stops,
        ),
      ).toBe(1);
    }
  });
for (const action of [
  'Descartar gravação',
  'Trocar conversa',
  'Fechar composer',
])
  test(`T19/MED-13: ${action} closes active capture without upload`, async ({
    page,
  }) => {
    const { uploads, sends } = await setup(page);
    await record(page);
    await page.getByRole('button', { name: action }).click();
    expect(
      await page.evaluate(
        () => /** @type {any} */ (globalThis).__capture.stops,
      ),
    ).toBe(1);
    expect(uploads).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });
for (const action of [
  'Descartar gravação',
  'Trocar conversa',
  'Fechar composer',
])
  test(`T19/MED-13: late permission after ${action} closes new tracks without starting`, async ({
    page,
  }) => {
    await setup(page, { late: true });
    await page
      .getByRole('button', { name: 'Gravar áudio', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () => /** @type {any} */ (globalThis).__capture.requests.length,
        ),
      )
      .toBe(1);
    await page.getByRole('button', { name: action }).click();
    await page.evaluate(() =>
      /** @type {any} */ (globalThis).__capture.resolve(),
    );
    await expect
      .poll(() =>
        page.evaluate(() => /** @type {any} */ (globalThis).__capture.stops),
      )
      .toBe(1);
    expect(
      await page.evaluate(
        () => /** @type {any} */ (globalThis).__capture.starts,
      ),
    ).toBe(0);
  });
test('T19/MED-12: monotonic 300-second limit stops tracks and offers review', async ({
  page,
}) => {
  await page.clock.install();
  await setup(page);
  await record(page);
  await page.clock.fastForward(300000);
  await expect(page.getByLabel('Prévia do áudio')).toBeVisible();
  expect(
    await page.evaluate(() => /** @type {any} */ (globalThis).__capture.stops),
  ).toBe(1);
});
test('T19/MED-12: oversized chunk stops tracks and prevents invalid draft', async ({
  page,
}) => {
  const { uploads } = await setup(page);
  await record(page);
  await page.evaluate(() =>
    /** @type {any} */ (globalThis).__capture.recorder.chunk(
      16 * 1024 * 1024 + 1,
    ),
  );
  await expect(page.getByRole('alert')).toContainText('16 MiB');
  expect(
    await page.evaluate(() => /** @type {any} */ (globalThis).__capture.stops),
  ).toBe(1);
  await expect(page.getByLabel('Prévia do áudio')).toHaveCount(0);
  expect(uploads).toHaveLength(0);
});
test('T19/MED-10/13/25: empty capture cannot send and discard revokes review URL with keyboard focus', async ({
  page,
}) => {
  await setup(page, { empty: true });
  await record(page);
  await page.getByRole('button', { name: 'Parar gravação' }).click();
  await expect(page.getByRole('alert')).toContainText('vazia');
  await expect(page.getByLabel('Prévia do áudio')).toHaveCount(0);
  await page.reload();
  await record(page);
});
test('T19/MED-13/25: review discard releases URL, restores focus and passes axe', async ({
  page,
}) => {
  await setup(page);
  await record(page);
  await stop(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Descartar gravação' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Gravar áudio', exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => /** @type {any} */ (globalThis).__capture.revoked.length,
    ),
  ).toBe(1);
  await expect(page.getByLabel('Prévia do áudio')).toHaveCount(0);
});

test('T19/MED-06/10: pending send cannot be discarded or replaced by a new capture', async ({
  page,
}) => {
  const { uploads, sends } = await setup(page);
  /** @type {() => void} */ let release = () => {};
  await page.route('**/api/v1/conversations/**/messages', async (route) => {
    sends.push(route.request());
    await new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    await route.fulfill({ status: 202, json: { id: 'message-1' } });
  });
  await record(page);
  await stop(page);
  await expect(
    page.getByRole('button', { name: 'Enviar anexo', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Enviar anexo', exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  try {
    await expect(
      page.getByRole('button', { name: 'Gravar áudio', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Descartar gravação' }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Prévia do áudio')).toBeVisible();
    expect(
      await page.evaluate(
        () => /** @type {any} */ (globalThis).__capture.requests.length,
      ),
    ).toBe(1);
  } finally {
    release();
  }
  await expect(
    page.getByText('Mensagem enviada', { exact: true }),
  ).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(sends).toHaveLength(1);
});

test('T19/T25/MED-12/30: exact 16-MiB capture stops tracks and validates without sending automatically', async ({
  page,
}) => {
  const { uploads, sends } = await setup(page, { empty: true });
  await record(page);
  await page.evaluate(() =>
    /** @type {any} */ (globalThis).__capture.recorder.chunk(16 * 1024 * 1024),
  );
  await expect(page.getByLabel('Prévia do áudio')).toBeVisible();
  expect(
    await page.evaluate(() => /** @type {any} */ (globalThis).__capture.stops),
  ).toBe(1);
  await expect.poll(() => uploads.length).toBe(1);
  expect(sends).toHaveLength(0);
});

for (const name of ['chromium', 'firefox'])
  test(`T19/MED-09/10: actual ${name} synthetic device negotiates playable recording`, async () => {
    const endpoint = name === 'firefox' && process.env.PW_FIREFOX_WS_ENDPOINT;
    if (endpoint && new URL(endpoint).hostname !== '127.0.0.1')
      throw new Error('Firefox test endpoint must be local loopback');
    const browser = endpoint
      ? await firefox.connect(endpoint, {
          exposeNetwork: '<loopback>',
          headers: {
            'x-playwright-launch-options': JSON.stringify({
              firefoxUserPrefs: {
                'media.navigator.streams.fake': true,
                'media.navigator.permission.disabled': true,
              },
            }),
          },
        })
      : await (name === 'chromium' ? chromium : firefox).launch(
          name === 'chromium'
            ? {
                args: [
                  '--use-fake-ui-for-media-stream',
                  '--use-fake-device-for-media-stream',
                ],
              }
            : {
                firefoxUserPrefs: {
                  'media.navigator.streams.fake': true,
                  'media.navigator.permission.disabled': true,
                },
              },
        );
    try {
      const page = await browser.newPage();
      await page.goto(origin + '/__recorder?recorder');
      await record(page);
      await page.waitForTimeout(1400);
      await stop(page);
      const encoded = await page
        .getByLabel('Prévia do áudio')
        .evaluate(async (element) => {
          const audio = /** @type {HTMLAudioElement} */ (element);
          const blob = await globalThis
            .fetch(audio.src)
            .then((response) => response.blob());
          return {
            mime: blob.type,
            bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
          };
        });
      await mkdir(resolve('var'), { recursive: true });
      const extension = encoded.mime.startsWith('audio/ogg')
        ? 'ogg'
        : encoded.mime.startsWith('audio/mp4')
          ? 'm4a'
          : 'webm';
      await writeFile(
        resolve(`var/chat-media-${name}-synthetic.${extension}`),
        Buffer.from(encoded.bytes),
      );
      const playback = await page
        .getByLabel('Prévia do áudio')
        .evaluate(async (element) => {
          const audio = /** @type {HTMLAudioElement} */ (element);
          await audio.play();
          return {
            mime: (await globalThis.fetch(audio.src).then((r) => r.blob()))
              .type,
            paused: audio.paused,
            error: audio.error?.code ?? null,
            errorMessage: audio.error?.message ?? null,
          };
        });
      expect(playback.mime).toMatch(/^audio\/(webm|ogg|mp4)/u);
      expect(playback.paused).toBe(false);
      expect(playback.error, JSON.stringify(playback)).toBeNull();
      await page.getByRole('button', { name: 'Descartar gravação' }).click();
      await expect(page.getByLabel('Prévia do áudio')).toHaveCount(0);
    } finally {
      await browser.close();
    }
  });
