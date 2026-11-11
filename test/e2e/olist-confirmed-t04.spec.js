import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  confirmedOrder,
  mockOrders,
  pendingOrder,
} from './support/orders-mock.js';

// OLC-T04: Botão e estados no detalhe do Pedido (/pedidos/:id).
// Todos os dados e endpoints são sintéticos.

/** @param {import('@playwright/test').Page} page */
async function expectNoAxeViolations(page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

/** @param {import('@playwright/test').Page} page */
async function expectNoHorizontalOverflow(page) {
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
}

const sellerUser = {
  id: 'seller-marina',
  name: 'Marina Aguiar',
  functionName: 'Vendedor',
  capabilities: [],
  olistEnabled: true,
  olistAuthorizationVersion: 2,
};

const otherSellerUser = {
  id: 'seller-ricardo',
  name: 'Ricardo Lima',
  functionName: 'Vendedor',
  capabilities: [],
  olistEnabled: true,
  olistAuthorizationVersion: 2,
};

test.describe('OLC-T04: Detalhe do Pedido - Olist e Frete', () => {
  test('Pendente: mostra "Disponível após confirmar o pedido", vendedor edita frete e aplica cotação', async ({
    page,
  }) => {
    let currentFreightCents = 0;
    let currentOrigin = 'manual';

    const testPending = {
      ...pendingOrder,
      id: 'order-pend-t04',
      number: '07-CRM',
      seller: { id: 'seller-marina', name: 'Marina Aguiar' },
      amounts: {
        piecesCents: 450000,
        freightCents: currentFreightCents,
        freightOrigin: currentOrigin,
        totalCents: 450000,
        divergentQuote: false,
        staleQuote: false,
      },
      pricing: {
        complete: true,
        totalCents: 450000,
        groups: [{ id: '99999999-9999-4999-8999-999999999901', subtotalCents: 450000 }],
        issues: [],
      },
      ficha: {
        ...pendingOrder.ficha,
        sizePricing: [
          {
            id: '99999999-9999-4999-8999-999999999901',
            lines: [
              {
                id: '99999999-9999-4999-8999-999999999902',
                size: 'M',
                quantity: 100,
                subtotalCents: 450000,
                subtotalReviewed: true,
              },
            ],
          },
        ],
      },
    };

    let freightPosts = [];

    await mockOrders(page, {
      user: sellerUser,
      orders: [testPending],
    });

    await page.route('**/api/v1/orders/order-pend-t04/olist', (route) => {
      route.fulfill({
        json: {
          orderId: 'order-pend-t04',
          number: '07-CRM',
          status: 'pendente',
          creationEnabled: true,
          operation: null,
          pendingFields: [],
        },
      });
    });

    await page.route('**/api/v1/orders/order-pend-t04/shipping-quote', (route) => {
      route.fulfill({
        json: {
          quote: {
            id: 'quote-42',
            service: 'SEDEX',
            carrier: 'Correios',
            amountCents: 3500,
            validUntil: new Date(Date.now() + 86400000).toISOString(),
          },
        },
      });
    });

    await page.route('**/api/v1/orders/order-pend-t04/freight', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        freightPosts.push(body);
        if (body.origin === 'quote') {
          currentFreightCents = 3500;
          currentOrigin = 'quote';
        } else {
          currentFreightCents = body.freightCents;
          currentOrigin = 'manual';
        }
        testPending.amounts.freightCents = currentFreightCents;
        testPending.amounts.freightOrigin = currentOrigin;
        testPending.amounts.totalCents = testPending.amounts.piecesCents + currentFreightCents;
        testPending.version += 1;
        return route.fulfill({
          json: {
            order: testPending,
          },
        });
      }
      return route.fallback();
    });

    await page.goto('/pedidos/order-pend-t04');
    await page.waitForLoadState('networkidle');

    // Olist block: should show pending message, no export button
    const olistSection = page.locator('.olist-preparation');
    await expect(olistSection).toBeVisible();
    await expect(olistSection.getByText('Disponível após confirmar o pedido')).toBeVisible();
    await expect(olistSection.getByRole('button', { name: 'Gerar no Olist' })).toHaveCount(0);

    // Calculated amounts visible: Peças, Frete, Total
    const amountsSection = page.locator('.op-amounts');
    await expect(amountsSection).toBeVisible();
    await expect(amountsSection.getByText('Peças')).toBeVisible();
    await expect(amountsSection.getByText('Frete', { exact: true })).toBeVisible();
    await expect(amountsSection.getByText('Total do pedido')).toBeVisible();

    // Seller can edit freight inline
    const informFreightBtn = page.getByRole('button', { name: 'Informar frete' });
    await expect(informFreightBtn).toBeVisible();
    await informFreightBtn.click();

    const freightInput = page.getByLabel('Frete do pedido (R$)');
    await expect(freightInput).toBeVisible();
    await freightInput.fill('25,00');
    await page.getByRole('button', { name: 'Salvar frete' }).click();

    expect(freightPosts).toHaveLength(1);
    expect(freightPosts[0]).toEqual({ expectedVersion: testPending.version - 1, freightCents: 2500 });

    // Shipping quote: can apply quote to freight
    const quoteButton = page.getByRole('button', { name: 'Usar cotação no frete' });
    if (await quoteButton.isVisible()) {
      await quoteButton.click();
      expect(freightPosts).toHaveLength(2);
      expect(freightPosts[1]).toEqual({ expectedVersion: testPending.version - 1, origin: 'quote' });
    }

    // Gerar pedido dialog also displays pieces, freight, total
    const confirmTrigger = page.getByRole('button', { name: 'Gerar pedido' });
    await expect(confirmTrigger).toBeVisible();
    await confirmTrigger.click();

    const dialog = page.getByRole('dialog', { name: /Gerar o pedido 07-CRM\?/u });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Peças', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Frete', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Total calculado do pedido/u)).toBeVisible();

    // Cancel dialog
    await dialog.getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // A11y & layout
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);
  });

  test('Pendente: outro vendedor vê frete somente leitura sem botões de edição', async ({
    page,
  }) => {
    const testPending = {
      ...pendingOrder,
      id: 'order-pend-other',
      seller: { id: 'seller-marina', name: 'Marina Aguiar' }, // Marina is owner
      amounts: {
        piecesCents: 450000,
        freightCents: 2000,
        freightOrigin: 'manual',
        totalCents: 452000,
        divergentQuote: false,
        staleQuote: false,
      },
      ficha: {
        ...pendingOrder.ficha,
        sizePricing: [
          {
            id: '99999999-9999-4999-8999-999999999901',
            lines: [
              {
                id: '99999999-9999-4999-8999-999999999902',
                size: 'M',
                quantity: 100,
                subtotalCents: 450000,
                subtotalReviewed: true,
              },
            ],
          },
        ],
      },
    };

    await mockOrders(page, {
      user: otherSellerUser, // Ricardo is viewing
      orders: [testPending],
    });

    await page.route('**/api/v1/orders/order-pend-other/olist', (route) => {
      route.fulfill({
        json: {
          orderId: 'order-pend-other',
          number: '07-CRM',
          status: 'pendente',
          creationEnabled: true,
          operation: null,
          pendingFields: [],
        },
      });
    });

    await page.goto('/pedidos/order-pend-other');
    await page.waitForLoadState('networkidle');

    // No edit freight button or apply quote button
    await expect(page.getByRole('button', { name: 'Informar frete' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Usar cotação no frete' })).toHaveCount(0);
    // Freight amount is displayed read-only
    await expect(page.locator('.op-amounts').getByText('R$ 20,00')).toBeVisible();
  });

  test('Confirmado com cadastro incompleto: exibe pendências, bloqueia envio e mostra quem pode corrigir', async ({
    page,
  }) => {
    const testConfirmed = {
      ...confirmedOrder,
      id: 'order-conf-incomplete',
      number: '05-CRM',
      buyer: {
        name: 'Buffet Casa Rosa',
        document: '',
        postalCode: '',
        addressStreet: '',
        addressNumber: '',
        addressDistrict: '',
        addressCity: '',
        addressState: '',
      },
      amounts: {
        piecesCents: 118000,
        freightCents: 0,
        freightOrigin: 'manual',
        totalCents: 118000,
      },
    };

    await mockOrders(page, {
      user: sellerUser,
      orders: [testConfirmed],
    });

    await page.route('**/api/v1/orders/order-conf-incomplete/olist', (route) => {
      route.fulfill({
        json: {
          orderId: 'order-conf-incomplete',
          number: '05-CRM',
          status: 'confirmado',
          creationEnabled: true,
          operation: null,
          pendingFields: [
            { code: 'document', label: 'CPF ou CNPJ' },
            { code: 'postalCode', label: 'CEP' },
            { code: 'addressStreet', label: 'Logradouro' },
            { code: 'addressNumber', label: 'Número' },
            { code: 'addressDistrict', label: 'Bairro' },
            { code: 'addressCity', label: 'Cidade' },
            { code: 'addressState', label: 'UF' },
          ],
        },
      });
    });

    await page.goto('/pedidos/order-conf-incomplete');
    await page.waitForLoadState('networkidle');

    const olistSection = page.locator('.olist-preparation');
    await expect(olistSection).toBeVisible();
    await expect(
      olistSection.getByText('Complete os dados para gerar no Olist'),
    ).toBeVisible();

    // Missing buyer fields listed in PT-BR
    await expect(olistSection.getByText('CPF ou CNPJ')).toBeVisible();
    await expect(olistSection.getByText('CEP')).toBeVisible();
    await expect(olistSection.getByText('Logradouro')).toBeVisible();

    // Explains who can fix
    await expect(
      olistSection.getByText(
        /Quem pode corrigir: o vendedor responsável pela conversa \(ou um administrador\) deve completar o cadastro obrigatório do comprador/u,
      ),
    ).toBeVisible();

    // Export button is NOT shown while registration is incomplete
    await expect(olistSection.getByRole('button', { name: 'Gerar no Olist' })).toHaveCount(0);

    // PDF generation is STILL allowed and enabled (independent of Olist)
    await expect(page.getByRole('button', { name: 'Gerar PDF' })).toBeVisible();

    await expectNoAxeViolations(page);
  });

  test('Confirmado com centavos fracionados: exibe erro de tamanho não representável', async ({
    page,
  }) => {
    const testConfirmed = {
      ...confirmedOrder,
      id: 'order-conf-fractional',
      amounts: { piecesCents: 10000, freightCents: 0, totalCents: 10000 },
    };

    await mockOrders(page, {
      user: sellerUser,
      orders: [testConfirmed],
    });

    await page.route('**/api/v1/orders/order-conf-fractional/olist', (route) => {
      route.fulfill({
        json: {
          orderId: 'order-conf-fractional',
          number: '05-CRM',
          status: 'confirmado',
          creationEnabled: true,
          operation: null,
          pendingFields: [
            {
              code: 'OLIST_SIZE_PRICE_INEXACT',
              label: 'Valor do tamanho GG não é representável em centavos exatos no Olist.',
            },
          ],
        },
      });
    });

    await page.goto('/pedidos/order-conf-fractional');
    await page.waitForLoadState('networkidle');

    const olistSection = page.locator('.olist-preparation');
    await expect(
      olistSection.getByText(/Valor do tamanho GG não é representável/u),
    ).toBeVisible();
    await expect(olistSection.getByRole('button', { name: 'Gerar no Olist' })).toHaveCount(0);
  });

  test('Confirmado com integração Olist indisponível: mostra aviso correspondente', async ({
    page,
  }) => {
    const testConfirmed = {
      ...confirmedOrder,
      id: 'order-conf-disabled',
      amounts: { piecesCents: 10000, freightCents: 0, totalCents: 10000 },
    };

    await mockOrders(page, {
      user: sellerUser,
      orders: [testConfirmed],
    });

    await page.route('**/api/v1/orders/order-conf-disabled/olist', (route) => {
      route.fulfill({
        json: {
          orderId: 'order-conf-disabled',
          number: '05-CRM',
          status: 'confirmado',
          creationEnabled: false,
          operation: null,
          pendingFields: [],
        },
      });
    });

    await page.goto('/pedidos/order-conf-disabled');
    await page.waitForLoadState('networkidle');

    const olistSection = page.locator('.olist-preparation');
    await expect(olistSection.getByText('Integração Olist indisponível')).toBeVisible();
    await expect(olistSection.getByRole('button', { name: 'Gerar no Olist' })).toHaveCount(0);
  });

  test('Confirmado apto: clica "Gerar no Olist" sem prévia obrigatória e acompanha progresso até conclusão', async ({
    page,
  }) => {
    const testConfirmed = {
      ...confirmedOrder,
      id: 'order-conf-ready',
      number: '05-CRM',
      amounts: { piecesCents: 118000, freightCents: 0, totalCents: 118000 },
    };

    let exportCalled = false;
    let exportCount = 0;
    /** @type {any} */
    let currentOperation = null;

    await mockOrders(page, {
      user: sellerUser,
      orders: [testConfirmed],
    });

    await page.route('**/api/v1/orders/order-conf-ready/olist', (route) => {
      route.fulfill({
        json: {
          orderId: 'order-conf-ready',
          number: '05-CRM',
          status: 'confirmado',
          creationEnabled: true,
          operation: currentOperation,
          pendingFields: [],
        },
      });
    });

    await page.route('**/api/v1/orders/order-conf-ready/olist/export', (route) => {
      if (route.request().method() === 'POST') {
        exportCalled = true;
        exportCount++;
        currentOperation = {
          state: 'queued',
          stage: 'queued',
          number: null,
          retrySafe: false,
        };
        return route.fulfill({
          status: 202,
          json: {
            orderId: 'order-conf-ready',
            number: '05-CRM',
            operationId: 'op-123',
            state: 'queued',
            stage: 'queued',
          },
        });
      }
      return route.fallback();
    });

    await page.goto('/pedidos/order-conf-ready');
    await page.waitForLoadState('networkidle');

    const olistSection = page.locator('.olist-preparation');
    await expect(olistSection).toBeVisible();
    await expect(olistSection.getByText('Ainda não gerado no Olist')).toBeVisible();

    const generateBtn = olistSection.getByRole('button', { name: 'Gerar no Olist' });
    await expect(generateBtn).toBeVisible();

    // Click triggers POST directly without modal dialog
    await generateBtn.click();
    expect(exportCalled).toBe(true);
    expect(exportCount).toBe(1);

    // Displays queued status
    await expect(olistSection.getByText('Aguardando processamento')).toBeVisible();

    // Transition to resolving_customer
    currentOperation = {
      state: 'resolving_customer',
      stage: 'customer',
      number: null,
      retrySafe: false,
    };
    await olistSection.getByRole('button', { name: 'Atualizar situação' }).click();
    await expect(olistSection.getByText('Processando… Cliente')).toBeVisible();

    // Transition to resolving_products
    currentOperation = {
      state: 'resolving_products',
      stage: 'products',
      number: null,
      retrySafe: false,
    };
    await olistSection.getByRole('button', { name: 'Atualizar situação' }).click();
    await expect(olistSection.getByText('Processando… Produtos e tamanhos')).toBeVisible();

    // Transition to sending
    currentOperation = {
      state: 'sending',
      stage: 'order',
      number: null,
      retrySafe: false,
    };
    await olistSection.getByRole('button', { name: 'Atualizar situação' }).click();
    await expect(olistSection.getByText('Processando… Venda')).toBeVisible();

    // Transition to succeeded
    currentOperation = {
      state: 'succeeded',
      stage: 'completed',
      number: '98765',
      retrySafe: false,
    };
    await olistSection.getByRole('button', { name: 'Atualizar situação' }).click();
    await expect(
      olistSection.getByText(/Gerado no Olist · Venda nº 98765/u),
    ).toBeVisible();
    await expect(olistSection.getByText(/05-CRM/u)).toBeVisible();

    // Reload page recovers persisted state
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(
      page.locator('.olist-preparation').getByText(/Gerado no Olist · Venda nº 98765/u),
    ).toBeVisible();

    await expectNoAxeViolations(page);
  });

  test('Falha segura com retrySafe oferece "Retomar geração", retoma e avança', async ({
    page,
  }) => {
    const testConfirmed = {
      ...confirmedOrder,
      id: 'order-conf-retry',
      amounts: { piecesCents: 118000, freightCents: 0, totalCents: 118000 },
    };

    let resumeCalls = 0;
    let operation = {
      state: 'failed_safe',
      stage: 'customer',
      number: null,
      retrySafe: true,
      lastErrorCode: 'NETWORK_TIMEOUT',
      lastErrorMessage: 'Conexão temporariamente indisponível.',
    };

    await mockOrders(page, {
      user: sellerUser,
      orders: [testConfirmed],
    });

    await page.route('**/api/v1/orders/order-conf-retry/olist', (route) => {
      route.fulfill({
        json: {
          orderId: 'order-conf-retry',
          number: '05-CRM',
          status: 'confirmado',
          creationEnabled: true,
          operation,
          pendingFields: [],
        },
      });
    });

    await page.route('**/api/v1/orders/order-conf-retry/olist/export', (route) => {
      if (route.request().method() === 'POST') {
        resumeCalls++;
        operation = {
          state: 'queued',
          stage: 'queued',
          number: null,
          retrySafe: false,
        };
        return route.fulfill({
          status: 202,
          json: {
            orderId: 'order-conf-retry',
            number: '05-CRM',
            operationId: 'op-resume-1',
            state: 'queued',
            stage: 'queued',
          },
        });
      }
      return route.fallback();
    });

    await page.goto('/pedidos/order-conf-retry');
    await page.waitForLoadState('networkidle');

    const olistSection = page.locator('.olist-preparation');
    await expect(olistSection.getByText('Não foi possível concluir esta etapa')).toBeVisible();

    const resumeBtn = olistSection.getByRole('button', { name: 'Retomar geração' });
    await expect(resumeBtn).toBeVisible();

    // Click resume
    await resumeBtn.click();
    expect(resumeCalls).toBe(1);

    await expect(olistSection.getByText('Aguardando processamento')).toBeVisible();
  });

  test('Incerteza operacional exibe "Conferência necessária" sem retry criador', async ({
    page,
  }) => {
    const testConfirmed = {
      ...confirmedOrder,
      id: 'order-conf-uncertain',
      amounts: { piecesCents: 118000, freightCents: 0, totalCents: 118000 },
    };

    await mockOrders(page, {
      user: sellerUser,
      orders: [testConfirmed],
    });

    await page.route('**/api/v1/orders/order-conf-uncertain/olist', (route) => {
      route.fulfill({
        json: {
          orderId: 'order-conf-uncertain',
          number: '05-CRM',
          status: 'confirmado',
          creationEnabled: true,
          operation: {
            state: 'outcome_unknown',
            stage: 'order',
            number: null,
            retrySafe: false,
          },
          pendingFields: [],
        },
      });
    });

    await page.goto('/pedidos/order-conf-uncertain');
    await page.waitForLoadState('networkidle');

    const olistSection = page.locator('.olist-preparation');
    await expect(olistSection.getByText('Conferência necessária')).toBeVisible();
    await expect(olistSection.getByRole('button', { name: 'Retomar geração' })).toHaveCount(0);
    await expect(olistSection.getByRole('button', { name: 'Gerar no Olist' })).toHaveCount(0);
  });

  test('Falha na consulta da integração exibe erro e botão somente leitura "Atualizar situação"', async ({
    page,
  }) => {
    const testConfirmed = {
      ...confirmedOrder,
      id: 'order-conf-query-err',
      amounts: { piecesCents: 118000, freightCents: 0, totalCents: 118000 },
    };

    let fail = true;

    await mockOrders(page, {
      user: sellerUser,
      orders: [testConfirmed],
    });

    await page.route('**/api/v1/orders/order-conf-query-err/olist', (route) => {
      if (fail) {
        return route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR' } });
      }
      return route.fulfill({
        json: {
          orderId: 'order-conf-query-err',
          number: '05-CRM',
          status: 'confirmado',
          creationEnabled: true,
          operation: null,
          pendingFields: [],
        },
      });
    });

    await page.goto('/pedidos/order-conf-query-err');
    await page.waitForLoadState('networkidle');

    const olistSection = page.locator('.olist-preparation');
    await expect(
      olistSection.getByText('Não foi possível consultar a integração'),
    ).toBeVisible();

    const refreshBtn = olistSection.getByRole('button', { name: 'Atualizar situação' });
    await expect(refreshBtn).toBeVisible();

    // Click refresh after recovery
    fail = false;
    await refreshBtn.click();
    await expect(olistSection.getByText('Ainda não gerado no Olist')).toBeVisible();
  });

  test('Responsividade em 320px, 390px e desktop, e suporte a tema escuro', async ({
    page,
  }) => {
    const testConfirmed = {
      ...confirmedOrder,
      id: 'order-conf-responsive',
      amounts: { piecesCents: 118000, freightCents: 2500, totalCents: 120500 },
    };

    await mockOrders(page, {
      user: sellerUser,
      orders: [testConfirmed],
    });

    await page.route('**/api/v1/orders/order-conf-responsive/olist', (route) => {
      route.fulfill({
        json: {
          orderId: 'order-conf-responsive',
          number: '05-CRM',
          status: 'confirmado',
          creationEnabled: true,
          operation: null,
          pendingFields: [],
        },
      });
    });

    // 320px mobile
    await page.setViewportSize({ width: 320, height: 600 });
    await page.goto('/pedidos/order-conf-responsive');
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);

    // 390px mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);

    // Desktop 1366px
    await page.setViewportSize({ width: 1366, height: 900 });
    await expectNoHorizontalOverflow(page);

    // Dark theme
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);
  });
});
