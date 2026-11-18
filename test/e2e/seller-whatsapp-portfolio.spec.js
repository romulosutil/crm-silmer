import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installMocks } from './support/inbox-vez-mock.js';

// WAP-01: "Atenda com seu WhatsApp" only for a seller in the pilot without a
// connected line; "Agora não" is remembered for that user in this browser.
// An account without a portfolio (an administrator) reads why, without the
// creation form. Synthetic projections only; no provider or real account.
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

/** @param {import('@playwright/test').Page} page @param {Record<string, any>|null} whatsapp */
async function portfolio(page, whatsapp) {
  /** @type {string[]} */
  const reads = [];
  await page.route('**/api/v1/me/clients**', (route) =>
    route.fulfill({ json: { items: [], totalCount: 0, nextCursor: null } }),
  );
  await page.route('**/api/v1/me/whatsapp', (route) => {
    reads.push(route.request().method());
    return whatsapp
      ? route.fulfill({ json: whatsapp })
      : route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } });
  });
  return reads;
}

/** @param {import('@playwright/test').Page} page @param {string} theme */
async function appearance(page, theme) {
  await page.addInitScript((value) => {
    globalThis.localStorage.setItem('silmer-theme', value);
  }, theme);
}

const NOT_CONFIGURED = {
  line: {
    id: null,
    state: 'not_configured',
    version: 0,
    generation: 0,
    maskedNumber: null,
  },
  available: true,
};
const ONBOARDING = { name: 'Atenda com seu WhatsApp', exact: true };
const TITLE = { name: 'Meus clientes', level: 1, exact: true };

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1366]) {
    test(`Meus clientes oferece Meu WhatsApp sem linha e lembra "Agora não" em ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await appearance(page, theme);
      await installMocks(page, {}, { fixedClock: false });
      const reads = await portfolio(page, NOT_CONFIGURED);
      await page.goto('/meus-clientes');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const banner = page.getByRole('heading', ONBOARDING);
      await expect(banner).toBeVisible();
      expect(reads).toEqual(['GET']);
      await expect(
        page.getByRole('link', { name: 'Configurar Meu WhatsApp' }),
      ).toHaveAttribute('href', '/conta#my-whatsapp-title');
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.getByRole('button', { name: 'Agora não' }).focus();
      await page.keyboard.press('Enter');
      await expect(banner).toHaveCount(0);
      await expect(page.getByRole('heading', TITLE)).toBeFocused();
      await page.reload();
      await expect(page.getByRole('heading', TITLE)).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Novo cliente' }),
      ).toBeVisible();
      await expect.poll(() => reads.length).toBe(2);
      await expect(page.getByRole('heading', ONBOARDING)).toHaveCount(0);
    });

    test(`Meus clientes indisponível para administrador em ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await appearance(page, theme);
      await installMocks(page, {}, { fixedClock: false, admin: true });
      await page.route('**/api/v1/me/clients**', (route) =>
        route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }),
      );
      /** @type {string[]} */
      const reads = [];
      await page.route('**/api/v1/me/whatsapp', (route) => {
        reads.push(route.request().method());
        return route.fulfill({ json: NOT_CONFIGURED });
      });
      await page.goto('/meus-clientes');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(
        page.getByText('Meus clientes não está disponível para sua conta.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Novo cliente' }),
      ).toHaveCount(0);
      await expect(page.locator('#client-search')).toHaveCount(0);
      await expect(page.getByRole('heading', ONBOARDING)).toHaveCount(0);
      await expect(
        page.getByText('Não foi possível carregar os clientes.'),
      ).toHaveCount(0);
      expect(reads).toEqual([]);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }
}

for (const [scene, whatsapp] of /** @type {const} */ ([
  [
    'linha conectada',
    {
      line: {
        id: 'line-synthetic',
        state: 'connected',
        version: 3,
        generation: 1,
        maskedNumber: '••••0000',
      },
      available: true,
    },
  ],
  ['vendedor fora do piloto', { ...NOT_CONFIGURED, available: false }],
  ['leitura indisponível', null],
])) {
  test(`Meus clientes sem convite de Meu WhatsApp: ${scene}`, async ({
    page,
  }) => {
    await installMocks(page, {}, { fixedClock: false });
    const reads = await portfolio(page, whatsapp);
    await page.goto('/meus-clientes');
    await expect(
      page.getByRole('button', { name: 'Novo cliente' }),
    ).toBeVisible();
    await expect.poll(() => reads.length).toBe(1);
    await expect(page.getByRole('heading', ONBOARDING)).toHaveCount(0);
  });
}

test('"Agora não" vale só para quem dispensou', async ({ page }) => {
  await installMocks(page, {}, { fixedClock: false });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      'crm.portfolio-whatsapp-onboarding.dismissed:outro-usuario',
      'true',
    );
  });
  await portfolio(page, NOT_CONFIGURED);
  await page.goto('/meus-clientes');
  await expect(page.getByRole('heading', ONBOARDING)).toBeVisible();
});

test('armazenamento indisponível não impede dispensar o convite', async ({
  page,
}) => {
  await installMocks(page, {}, { fixedClock: false });
  await page.addInitScript(() => {
    const storage = globalThis.Storage.prototype;
    const get = storage.getItem;
    storage.getItem = function getItem(key) {
      if (String(key).startsWith('crm.portfolio-whatsapp-onboarding'))
        throw new Error('blocked');
      return get.call(this, key);
    };
    const set = storage.setItem;
    storage.setItem = function setItem(key, value) {
      if (String(key).startsWith('crm.portfolio-whatsapp-onboarding'))
        throw new Error('blocked');
      return set.call(this, key, value);
    };
  });
  await portfolio(page, NOT_CONFIGURED);
  await page.goto('/meus-clientes');
  await page.getByRole('button', { name: 'Agora não' }).click();
  await expect(page.getByRole('heading', ONBOARDING)).toHaveCount(0);
});
