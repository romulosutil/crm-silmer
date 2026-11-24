import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  PRICED_GROUP_ID,
  PRICED_LINE_M,
  confirmedOrder,
  eventStreamBody,
  mockOrders,
  ownConfirmedOrder,
  pricedPendingOrder,
} from './support/orders-mock.js';

const SELLER_MARINA = {
  id: 'seller-marina',
  name: 'Marina Aguiar',
  email: 'marina@example.test',
  functionName: 'Vendedor',
  capabilities: [],
};

const THEMES = ['light', 'dark'];
const MOBILE_VIEWPORTS = [
  { name: '320px', width: 320, height: 600 },
  { name: '390px', width: 390, height: 844 },
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {string | undefined} baseURL
 * @param {string} [token]
 */
async function setCsrf(page, baseURL, token = 't04-csrf') {
  const url = baseURL ?? 'http://127.0.0.1:4173';
  await page.context().addCookies([{ name: 'crm_csrf', value: token, url }]);
  return token;
}

/** @param {import('@playwright/test').Page} page */
function olistSection(page) {
  return page.locator('section.olist-preparation');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function expectCleanOrderScreen(page, label) {
  const overflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth <=
      globalThis.document.documentElement.clientWidth + 1,
  );
  expect(overflow, `${label}: horizontal overflow`).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations, `${label}: axe violations`).toEqual([]);
}

test('T04 pending order stays compact within mobile budget without generate button, preserving freight and Gerar pedido', async ({
  page,
}, testInfo) => {
  const user = { ...SELLER_MARINA, olistEnabled: true };
  const pendingWithFreight = {
    ...structuredClone(pricedPendingOrder),
    amounts: { freightCents: 0, piecesCents: 480000, totalCents: 480000 },
    freight: {
      cents: 0,
      pricingRule: 'pieces-v1',
      quoteId: null,
      quoteNotice: null,
      quotedCents: null,
      serviceId: null,
      setAt: null,
      setBy: null,
      source: null,
    },
  };
  await mockOrders(page, {
    user,
    orders: [pendingWithFreight],
  });
  await page.route(
    `**/api/v1/orders/${pendingWithFreight.id}/olist`,
    async (route) => {
      await route.fulfill({
        json: {
          orderId: pendingWithFreight.id,
          number: pendingWithFreight.number,
          status: 'pendente',
          creationEnabled: true,
          pendingFields: [],
          operation: null,
        },
      });
    },
  );
  await setCsrf(page, testInfo.project.use.baseURL);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/pedidos/${pendingWithFreight.id}`);

  const section = olistSection(page);
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute('data-pending', 'true');
  await expect(section).toContainText('Disponível após confirmar o pedido');
  await expect(
    section.getByRole('button', { name: /Gerar no Olist|Revisar envio/u }),
  ).toHaveCount(0);

  // PED-RD / ADR 080 preserved: responsible seller edits freight on pending order; Gerar pedido footer action remains.
  const closing = page.getByRole('region', { name: 'Fechamento e pagamento' });
  await expect(closing.getByRole('textbox', { name: 'Frete' })).toBeEditable();
  await expect(
    page.getByRole('button', { name: 'Gerar pedido' }),
  ).toBeVisible();

  const height = await page.evaluate(
    () => globalThis.document.documentElement.scrollHeight,
  );
  expect(height).toBeLessThanOrEqual(1800);
  await expectCleanOrderScreen(page, 'pending-mobile-390');
});

test('T04 incomplete buyer registration shows origin-named pending fields and keeps PDF available across 320px and 390px', async ({
  page,
}, testInfo) => {
  const user = { ...SELLER_MARINA, olistEnabled: true };
  await mockOrders(page, {
    user,
    orders: [structuredClone(ownConfirmedOrder)],
  });
  await page.route(
    `**/api/v1/orders/${ownConfirmedOrder.id}/olist`,
    async (route) => {
      // Mirrors apps/api/src/olist-runtime.js generic labels so UI translates code/field cleanly.
      await route.fulfill({
        json: {
          orderId: ownConfirmedOrder.id,
          number: ownConfirmedOrder.number,
          status: 'confirmado',
          creationEnabled: true,
          pendingFields: [
            {
              code: 'OLIST_CUSTOMER_INVALID',
              field: 'buyer.registration.cpfCnpj',
              label: 'Pendência para gerar no Olist.',
            },
            {
              code: 'OLIST_CUSTOMER_INVALID',
              field: 'buyer.registration.postalCode',
              label: 'Pendência para gerar no Olist.',
            },
            {
              code: 'OLIST_CUSTOMER_INVALID',
              field: 'buyer.registration.street',
              label: 'Pendência para gerar no Olist.',
            },
          ],
          operation: null,
        },
      });
    },
  );
  await setCsrf(page, testInfo.project.use.baseURL);

  for (const vp of MOBILE_VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/pedidos/${ownConfirmedOrder.id}`);
    const section = olistSection(page);
    await expect(section).toContainText(
      'Complete os dados para gerar no Olist',
    );
    await expect(section).toContainText('Cadastro do comprador: CPF ou CNPJ.');
    await expect(section).toContainText('Cadastro do comprador: CEP.');
    await expect(section).toContainText(
      'Cadastro do comprador: endereço (logradouro).',
    );
    await expect(section).toContainText(/Inbox/u);
    await expect(
      section.getByRole('button', { name: 'Gerar no Olist' }),
    ).toHaveCount(0);

    // ADR 080: freight in confirmed order stays read-only; PDF stays enabled.
    const closing = page.getByRole('region', {
      name: 'Fechamento e pagamento',
    });
    await expect(closing.getByRole('textbox', { name: 'Frete' })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: 'PDF para impressão' }).first(),
    ).toBeEnabled();

    await expectCleanOrderScreen(page, `incomplete-buyer-${vp.name}`);
  }
});

test('T04 legacy order without sizePricing routes authorized user to Complemento para o Olist and denies edit to non-owner without granting permission', async ({
  page,
}, testInfo) => {
  const legacyOrder = {
    ...structuredClone(confirmedOrder),
    id: 'order-legacy-t04',
    number: '44-CRM',
    seller: { id: SELLER_MARINA.id, name: SELLER_MARINA.name },
    confirmedBy: { id: SELLER_MARINA.id, name: SELLER_MARINA.name },
    finalAmountCents: 118000,
    ficha: {
      ...structuredClone(confirmedOrder.ficha),
      sizePricing: undefined,
    },
    pricing: undefined,
  };
  let breakdownInitialized = false;
  let breakdownDone = false;
  const sourceBase = {
    revision: 1,
    orderVersion: 1,
    origin: 'legacy',
    legacyRequired: true,
    expectedTotalCents: 118000,
    groups: [
      {
        id: 'legacy-group-1',
        itemNumbers: [1],
        product: 'Camiseta',
        lines: [
          {
            lineId: 'legacy-line-m',
            size: 'M',
            quantity: 10,
            subtotalCents: null,
          },
        ],
      },
    ],
    details: { deliveryOn: '2026-10-20', applications: [], registration: {} },
  };

  await mockOrders(page, {
    user: { ...SELLER_MARINA, olistEnabled: true },
    orders: [legacyOrder],
  });
  await page.route(
    `**/api/v1/orders/${legacyOrder.id}/price-breakdown`,
    async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            ...sourceBase,
            orderVersion: legacyOrder.version,
            sourceValid: breakdownInitialized || breakdownDone,
            pending: !breakdownDone,
            pricing: breakdownDone
              ? {
                  complete: true,
                  totalCents: 118000,
                  groups: [{ id: 'legacy-group-1', subtotalCents: 118000 }],
                }
              : null,
          },
        });
        return;
      }
      const payload = route.request().postDataJSON();
      if (payload?.value?.action === 'initialize') {
        breakdownInitialized = true;
        await route.fulfill({
          json: {
            ...sourceBase,
            orderVersion: legacyOrder.version,
            sourceValid: true,
            pending: true,
            pricing: null,
          },
        });
        return;
      }
      breakdownDone = true;
      legacyOrder.version += 1;
      await route.fulfill({
        json: {
          ...sourceBase,
          revision: 2,
          orderVersion: legacyOrder.version,
          sourceValid: true,
          pending: false,
          pricing: {
            complete: true,
            totalCents: 118000,
            groups: [{ id: 'legacy-group-1', subtotalCents: 118000 }],
          },
        },
      });
    },
  );
  await page.route(
    `**/api/v1/orders/${legacyOrder.id}/olist`,
    async (route) => {
      await route.fulfill({
        json: {
          orderId: legacyOrder.id,
          number: legacyOrder.number,
          status: 'confirmado',
          creationEnabled: true,
          pendingFields: breakdownDone
            ? []
            : [
                {
                  code: 'LEGACY_PRICE_BREAKDOWN_REQUIRED',
                  field: 'priceBreakdown',
                  label: 'Pendência para gerar no Olist.',
                },
              ],
          operation: null,
        },
      });
    },
  );
  await setCsrf(page, testInfo.project.use.baseURL);

  await page.goto(`/pedidos/${legacyOrder.id}`);
  const section = olistSection(page);
  await expect(section).toContainText('Complete os dados para gerar no Olist');
  await expect(section).toContainText(/Complemento para o Olist/u);
  await expect(
    section.getByRole('button', { name: 'Gerar no Olist' }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Preparar complemento' }).click();
  await page.getByRole('button', { name: 'Editar complemento' }).click();
  await page.getByLabel('Subtotal do item 1, tamanho M').fill('1180,00');
  await page.getByRole('button', { name: 'Salvar complemento' }).click();

  await expect(section).toContainText('Ainda não gerado no Olist');
  await expect(
    section.getByRole('button', { name: 'Gerar no Olist' }),
  ).toBeVisible();

  // Different seller with olistEnabled sees who must fix it and never gains Complemento edit permission.
  const browser = page.context().browser();
  if (!browser) throw new Error('missing browser');
  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await mockOrders(otherPage, {
      user: {
        id: 'seller-outro',
        name: 'Outro Vendedor',
        email: 'outro@example.test',
        functionName: 'Vendedor',
        capabilities: [],
        olistEnabled: true,
      },
      orders: [{ ...legacyOrder, version: 1 }],
    });
    await otherPage.route(
      `**/api/v1/orders/${legacyOrder.id}/price-breakdown`,
      async (route) => {
        await route.fulfill({
          json: {
            ...sourceBase,
            orderVersion: 1,
            sourceValid: false,
            pending: true,
            pricing: null,
          },
        });
      },
    );
    await otherPage.route(
      `**/api/v1/orders/${legacyOrder.id}/olist`,
      async (route) => {
        await route.fulfill({
          json: {
            orderId: legacyOrder.id,
            number: legacyOrder.number,
            status: 'confirmado',
            creationEnabled: true,
            pendingFields: [
              {
                code: 'LEGACY_PRICE_BREAKDOWN_REQUIRED',
                field: 'priceBreakdown',
                label: 'Pendência para gerar no Olist.',
              },
            ],
            operation: null,
          },
        });
      },
    );
    await otherPage.goto(
      `${testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173'}/pedidos/${legacyOrder.id}`,
    );
    await expect(olistSection(otherPage)).toContainText(
      'o vendedor responsável pelo pedido (ou um administrador) deve completar os subtotais em Complemento para o Olist',
    );
    await expect(
      otherPage.getByRole('button', {
        name: /Preparar complemento|Editar complemento/u,
      }),
    ).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
});

test('T04 inexact size subtotal and unavailable integration render exact spec copy without create button', async ({
  page,
}, testInfo) => {
  const pricedConfirmed = {
    ...structuredClone(ownConfirmedOrder),
    id: 'order-inexact-t04',
    number: '45-CRM',
    ficha: structuredClone(pricedPendingOrder.ficha),
    pricing: structuredClone(pricedPendingOrder.pricing),
  };
  let mode = 'inexact';
  await mockOrders(page, {
    user: { ...SELLER_MARINA, olistEnabled: true },
    orders: [pricedConfirmed],
  });
  await page.route(
    `**/api/v1/orders/${pricedConfirmed.id}/olist`,
    async (route) => {
      if (mode === 'inexact') {
        await route.fulfill({
          json: {
            orderId: pricedConfirmed.id,
            number: pricedConfirmed.number,
            status: 'confirmado',
            creationEnabled: true,
            pendingFields: [
              {
                code: 'OLIST_FRACTIONAL_CENT_UNIT',
                field: `sizePricing.${PRICED_GROUP_ID}.${PRICED_LINE_M}`,
                label: 'Pendência para gerar no Olist.',
              },
            ],
            operation: null,
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          orderId: pricedConfirmed.id,
          number: pricedConfirmed.number,
          status: 'confirmado',
          creationEnabled: false,
          pendingFields: [
            {
              code: 'OLIST_NOT_CONFIGURED',
              field: 'integration',
              label: 'Geração Olist ainda indisponível.',
            },
          ],
          operation: null,
        },
      });
    },
  );
  await setCsrf(page, testInfo.project.use.baseURL);

  await page.goto(`/pedidos/${pricedConfirmed.id}`);
  const section = olistSection(page);
  await expect(section).toContainText(
    'Valor do tamanho não representável no Olist',
  );
  await expect(section).toContainText(/Item 1, tamanho M/u);
  await expect(
    section.getByRole('button', { name: 'Gerar no Olist' }),
  ).toHaveCount(0);

  mode = 'disabled';
  await page.reload();
  await expect(section).toContainText('Integração Olist indisponível');
  await expect(
    section.getByRole('button', { name: 'Gerar no Olist' }),
  ).toHaveCount(0);
});

test('T04 direct export validates per_order due date, prevents double-click, polls stages via keyboard, persists across reload, and passes Axe in light/dark themes', async ({
  page,
}, testInfo) => {
  const csrf = await setCsrf(page, testInfo.project.use.baseURL);
  const order = structuredClone(ownConfirmedOrder);
  /** @type {any[]} */
  const exports = [];
  /** @type {any} */
  let operation = null;
  let readsAfterExport = 0;

  await mockOrders(page, {
    user: { ...SELLER_MARINA, olistEnabled: true },
    orders: [order],
  });
  await page.route(`**/api/v1/orders/${order.id}/olist`, async (route) => {
    if (operation && operation.state !== 'confirmed') {
      readsAfterExport += 1;
      if (readsAfterExport === 1) {
        operation = {
          state: 'resolving',
          stage: 'customer',
          number: null,
          errorCode: null,
        };
      } else if (readsAfterExport === 2) {
        operation = {
          state: 'resolving',
          stage: 'products',
          number: null,
          errorCode: null,
        };
      } else if (readsAfterExport === 3) {
        operation = {
          state: 'reserved',
          stage: 'sale',
          number: null,
          errorCode: null,
        };
      } else {
        operation = {
          state: 'confirmed',
          stage: 'sale',
          number: '98765',
          errorCode: null,
        };
      }
    }
    await route.fulfill({
      json: {
        orderId: order.id,
        number: order.number,
        status: 'confirmado',
        creationEnabled: true,
        paymentDuePolicy: 'per_order',
        pendingFields: [],
        operation,
      },
    });
  });
  await page.route(
    `**/api/v1/orders/${order.id}/olist/export`,
    async (route) => {
      const req = route.request();
      exports.push({
        body: req.postDataJSON(),
        csrf: req.headers()['x-csrf-token'],
        idempotencyKey: req.headers()['idempotency-key'],
      });
      await new Promise((resolve) => globalThis.setTimeout(resolve, 120));
      operation = {
        state: 'queued',
        stage: 'customer',
        number: null,
        errorCode: null,
      };
      await route.fulfill({
        status: 202,
        json: {
          orderId: order.id,
          number: order.number,
          operationId: 'op-t04-1',
          state: 'queued',
          stage: 'customer',
        },
      });
    },
  );

  await page.clock.install();
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/pedidos/${order.id}`);

  const section = olistSection(page);
  await expect(section).toContainText('Ainda não gerado no Olist');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const dueInput = section.getByLabel('Vencimento deste pedido');
  const generateBtn = section.getByRole('button', { name: 'Gerar no Olist' });
  await expect(dueInput).toBeVisible();
  await expect(generateBtn).toBeVisible();

  // Keyboard attempt without date moves focus to invalid date input without calling API.
  await generateBtn.focus();
  await page.keyboard.press('Enter');
  await expect(dueInput).toBeFocused();
  await expect(dueInput).toHaveAttribute('aria-invalid', 'true');
  expect(exports).toHaveLength(0);

  await dueInput.fill('2026-12-05');
  // Double-click must send only one POST /export with Idempotency-Key & CSRF token.
  await generateBtn.dblclick();

  await expect(section).toContainText('Aguardando processamento');
  expect(exports).toHaveLength(1);
  expect(exports[0].body).toEqual({ paymentDueOn: '2026-12-05' });
  expect(exports[0].csrf).toBe(csrf);
  expect(exports[0].idempotencyKey).toBeTruthy();

  // Bounded automatic polling advances through all stages cleanly.
  for (const expectedText of [
    'Processando… Cliente',
    'Processando… Produtos e tamanhos',
    'Processando… Venda',
    'Gerado no Olist · Venda nº 98765',
  ]) {
    const polled = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/orders/${order.id}/olist`),
    );
    await page.clock.fastForward(2100);
    await polled;
    await expect(section).toContainText(expectedText);
  }

  const numbers = section.locator('.olist-progress-numbers');
  await expect(numbers).toContainText(order.number);
  await expect(numbers).toContainText('98765');
  await expect(
    section.getByRole('button', { name: 'Gerar no Olist' }),
  ).toHaveCount(0);

  // Local reopen/cancel remains locked when Olist operation is active/confirmed.
  await page
    .getByRole('button', { name: 'Mais ações do pedido', exact: true })
    .click();
  await expect(page.getByRole('menuitem', { name: /Reabrir/u })).toHaveCount(0);
  await page.keyboard.press('Escape');

  for (const theme of THEMES) {
    await page.evaluate(
      (value) =>
        globalThis.document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    await expectCleanOrderScreen(page, `confirmed-desktop-${theme}`);
  }

  // Reload persists completed state without generate button.
  await page.reload();
  await expect(section).toContainText('Gerado no Olist · Venda nº 98765');
  await expect(
    section.getByRole('button', { name: 'Gerar no Olist' }),
  ).toHaveCount(0);
});

test('T04 failed_safe gates Retomar geração on retrySafe === true, ambiguous 500 stops creation, and outcome_unknown requires conference', async ({
  page,
}, testInfo) => {
  await setCsrf(page, testInfo.project.use.baseURL);
  const order = structuredClone(ownConfirmedOrder);
  let scenario = 'retry_true';
  let postCount = 0;

  await mockOrders(page, {
    user: {
      ...SELLER_MARINA,
      olistEnabled: true,
      capabilities: ['COMMERCIAL_ADMIN'],
    },
    orders: [order],
  });
  await page.route(
    `**/api/v1/orders/${order.id}/olist/administration`,
    async (route) => {
      await route.fulfill({
        json: {
          orderId: order.id,
          operation:
            scenario === 'uncertain'
              ? {
                  state: 'uncertain',
                  stage: 'sale',
                  version: 1,
                  errorCode: 'OLIST_AMBIGUOUS',
                }
              : null,
          resources: [],
          requests: [],
          attempts: [],
        },
      });
    },
  );
  await page.route(`**/api/v1/orders/${order.id}/olist`, async (route) => {
    /** @type {Record<string, any>} */
    const operations = {
      retry_true: {
        state: 'failed_safe',
        stage: 'customer',
        number: null,
        errorCode: 'OLIST_UNAVAILABLE',
        retrySafe: true,
      },
      retry_false: {
        state: 'failed_safe',
        stage: 'products',
        number: null,
        errorCode: 'OLIST_UNAVAILABLE',
        retrySafe: false,
      },
      uncertain: {
        state: 'outcome_unknown',
        stage: 'sale',
        number: null,
        errorCode: 'OLIST_AMBIGUOUS',
        retrySafe: false,
      },
      succeeded: {
        state: 'succeeded',
        stage: 'sale',
        number: '77123',
        errorCode: null,
      },
    };
    await route.fulfill({
      json: {
        orderId: order.id,
        number: order.number,
        status: 'confirmado',
        creationEnabled: true,
        pendingFields: [],
        operation: operations[scenario],
      },
    });
  });
  await page.route(
    `**/api/v1/orders/${order.id}/olist/export`,
    async (route) => {
      postCount += 1;
      if (scenario === 'retry_true' && postCount === 1) {
        // Ambiguous 500 during resume must immediately lock into Conferência necessária!
        await route.fulfill({
          status: 500,
          json: { code: 'INTERNAL_ERROR', message: 'raw-olist-stack-leak' },
        });
        return;
      }
      scenario = 'succeeded';
      await route.fulfill({
        status: 202,
        json: {
          orderId: order.id,
          number: order.number,
          operationId: 'op-t04-resume',
          state: 'queued',
          stage: 'customer',
        },
      });
    },
  );

  await page.goto(`/pedidos/${order.id}`);
  const section = olistSection(page);
  await expect(section).toContainText('Não foi possível concluir esta etapa');
  const resumeBtn = section.getByRole('button', { name: 'Retomar geração' });
  await expect(resumeBtn).toBeVisible();

  // Ambiguous 500 on resume hides Retomar geração and shows Conferência necessária without leaking raw server error.
  await resumeBtn.click();
  await expect(section).toContainText('Conferência necessária');
  await expect(section).not.toContainText('raw-olist-stack-leak');
  await expect(
    section.getByRole('button', { name: /Gerar no Olist|Retomar geração/u }),
  ).toHaveCount(0);

  // Reload with retrySafe: false must NOT show Retomar geração.
  scenario = 'retry_false';
  await page.reload();
  await expect(section).toContainText('Não foi possível concluir esta etapa');
  await expect(
    section.getByRole('button', { name: /Gerar no Olist|Retomar geração/u }),
  ).toHaveCount(0);

  // outcome_unknown shows Conferência necessária + admin recovery controls, never create/retry.
  scenario = 'uncertain';
  await page.reload();
  await expect(section).toContainText('Conferência necessária');
  await expect(
    section.getByRole('button', { name: /Gerar no Olist|Retomar geração/u }),
  ).toHaveCount(0);
  await expect(
    section.getByRole('button', { name: /Conferir no Olist/u }).first(),
  ).toBeVisible();

  // Clean failed_safe resume when POST succeeds transitions through polling to succeeded.
  scenario = 'retry_true';
  await page.reload();
  await section.getByRole('button', { name: 'Retomar geração' }).click();
  await section.getByRole('button', { name: 'Atualizar situação' }).click();
  await expect(section).toContainText('Gerado no Olist · Venda nº 77123');
});

test('T04 handles read failure safely, clears actions on concurrent 403 revocation, and blocks generation on cancelled orders', async ({
  page,
}, testInfo) => {
  await setCsrf(page, testInfo.project.use.baseURL);
  const order = structuredClone(ownConfirmedOrder);
  const cancelledOrder = {
    ...structuredClone(ownConfirmedOrder),
    id: 'order-cancelled-t04',
    cancelledAt: '2026-11-10T12:00:00.000Z',
    cancellationReason: 'Cancelado pelo cliente',
  };
  let mode = 'read_error';
  let sseSent = false;
  /** @type {(body: string) => void} */
  let sendSse = () => {};

  await mockOrders(page, {
    user: { ...SELLER_MARINA, olistEnabled: true },
    orders: [order, cancelledOrder],
  });
  await page.route('**/api/v1/events*', async (route) => {
    if (sseSent) {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      });
      return;
    }
    const body = await new Promise((resolve) => {
      sendSse = resolve;
    });
    sseSent = true;
    await route.fulfill({ contentType: 'text/event-stream', body });
  });
  await page.route(`**/api/v1/orders/${order.id}/olist`, async (route) => {
    if (mode === 'read_error') {
      await route.fulfill({
        status: 500,
        json: { code: 'INTERNAL_ERROR', message: 'secret-provider-stack' },
      });
      return;
    }
    if (mode === 'revoked') {
      await route.fulfill({
        status: 403,
        json: { code: 'FORBIDDEN' },
      });
      return;
    }
    await route.fulfill({
      json: {
        orderId: order.id,
        number: order.number,
        status: 'confirmado',
        creationEnabled: true,
        pendingFields: [],
        operation: null,
      },
    });
  });

  await page.goto(`/pedidos/${order.id}`);
  const section = olistSection(page);
  await expect(section).toContainText(
    'Não foi possível consultar a integração',
  );
  await expect(section).not.toContainText('secret-provider-stack');
  await expect(
    section.getByRole('button', { name: 'Gerar no Olist' }),
  ).toHaveCount(0);

  // Read-only refresh recovers eligible state.
  mode = 'ready';
  await section.getByRole('button', { name: 'Atualizar situação' }).click();
  await expect(section).toContainText('Ainda não gerado no Olist');
  await expect(
    section.getByRole('button', { name: 'Gerar no Olist' }),
  ).toBeVisible();

  // Concurrent permission revocation via SSE removes Gerar no Olist and shows alert.
  mode = 'revoked';
  sendSse(
    eventStreamBody({
      type: 'identity.user.changed',
      userId: SELLER_MARINA.id,
    }),
  );
  await expect(section.getByRole('alert')).toContainText('Seu acesso mudou');
  await expect(
    section.getByRole('button', { name: 'Gerar no Olist' }),
  ).toHaveCount(0);

  // Cancelled order locally blocks generation without calling Olist creation.
  await page.route(
    `**/api/v1/orders/${cancelledOrder.id}/olist`,
    async (route) => {
      await route.fulfill({
        json: {
          orderId: cancelledOrder.id,
          number: cancelledOrder.number,
          status: 'confirmado',
          creationEnabled: true,
          pendingFields: [],
          operation: null,
        },
      });
    },
  );
  await page.goto(`/pedidos/${cancelledOrder.id}`);
  await expect(olistSection(page)).toContainText(
    'Pedido cancelado. A geração está bloqueada.',
  );
  await expect(
    olistSection(page).getByRole('button', { name: 'Gerar no Olist' }),
  ).toHaveCount(0);
});

test('T04 failed_safe resume blocks actionable gaps and forwards paymentDueOn when paymentDuePolicy is per_order', async ({
  page,
}, testInfo) => {
  await setCsrf(page, testInfo.project.use.baseURL);
  const order = structuredClone(ownConfirmedOrder);
  let hasGap = true;
  /** @type {any[]} */
  const posted = [];

  await mockOrders(page, {
    user: { ...SELLER_MARINA, olistEnabled: true },
    orders: [order],
  });
  await page.route(`**/api/v1/orders/${order.id}/olist`, async (route) => {
    await route.fulfill({
      json: {
        orderId: order.id,
        number: order.number,
        status: 'confirmado',
        creationEnabled: true,
        paymentDuePolicy: 'per_order',
        pendingFields: hasGap
          ? [
              {
                code: 'OLIST_CUSTOMER_INVALID',
                field: 'buyer.registration.postalCode',
                label: 'Pendência para gerar no Olist.',
              },
            ]
          : [],
        operation: {
          state: 'failed_safe',
          stage: 'customer',
          number: null,
          errorCode: 'OLIST_UNAVAILABLE',
          retrySafe: true,
        },
      },
    });
  });
  await page.route(
    `**/api/v1/orders/${order.id}/olist/export`,
    async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({
        status: 202,
        json: {
          orderId: order.id,
          number: order.number,
          operationId: 'op-t04-resume-due',
          state: 'queued',
          stage: 'customer',
        },
      });
    },
  );

  await page.goto(`/pedidos/${order.id}`);
  const section = olistSection(page);
  await expect(section).toContainText('Cadastro do comprador: CEP.');
  await expect(
    section.getByRole('button', { name: 'Retomar geração' }),
  ).toHaveCount(0);

  hasGap = false;
  await section.getByRole('button', { name: 'Atualizar situação' }).click();
  await expect(section.getByLabel('Vencimento deste pedido')).toBeVisible();
  await section.getByLabel('Vencimento deste pedido').fill('2026-12-20');
  await section.getByRole('button', { name: 'Retomar geração' }).click();
  expect(posted).toEqual([{ paymentDueOn: '2026-12-20' }]);
});
