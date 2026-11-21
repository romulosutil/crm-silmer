import { expect, test } from '@playwright/test';
import { actionItems, mockPainel } from './support/painel-mock.js';

test('o atalho abre a fila da urgência com o mesmo recorte ao voltar', async ({
  page,
}) => {
  await mockPainel(page);
  await page.goto('/dashboard?periodo=7dias');
  const urgency = page.getByRole('region', { name: 'Urgência da fila' });
  await expect(urgency).toContainText('1 conversa espera vendedor');
  await expect(urgency).toContainText('42 min');
  await urgency.getByRole('button', { name: 'Abrir fila' }).press('Enter');
  await expect(page).toHaveURL(/visao=central&fila=sem-responsavel/u);
  await expect(
    page.getByRole('heading', { name: 'Fila da Central ao vivo' }),
  ).toBeFocused();
  await page.goBack();
  await expect(
    page.getByRole('radio', { name: '7 dias', exact: true }),
  ).toBeChecked();
  await expect(urgency).toBeVisible();
});

test('o período altera resultado, equipe e destinos mantendo a urgência atual', async ({
  page,
}) => {
  await mockPainel(page);
  await page.goto('/dashboard?periodo=hoje');
  const urgency = page.getByRole('region', { name: 'Urgência da fila' });
  await expect(urgency).toContainText('1 conversa espera vendedor');
  await page.getByRole('radio', { name: 'Hoje', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('radio', { name: '7 dias', exact: true }),
  ).toBeChecked();
  const result = page.getByRole('region', { name: 'Vendas do período' });
  await expect(result.locator('dd').first()).toHaveText('R$ 800,00');
  await expect(
    result.getByRole('link', { name: 'Conferir pedidos', exact: true }),
  ).toHaveAttribute(
    'href',
    '/pedidos?status=confirmado&de=2026-10-09&ate=2026-10-15',
  );
  await expect(page.getByRole('region', { name: 'Vendedores' })).toContainText(
    'R$ 500,00',
  );
  await expect(urgency).toContainText('1 conversa espera vendedor');
});

test('unavailable actions are unknown, never an empty queue or zero, while own performance remains readable', async ({
  page,
}) => {
  await mockPainel(page, { manager: false });
  let failing = true;
  await page.route('**/api/v1/dashboard/actions', (route) =>
    route.fulfill({
      contentType: 'application/json',
      status: failing ? 503 : 200,
      body: JSON.stringify(
        failing
          ? { code: 'UNAVAILABLE' }
          : {
              today: '2026-10-15',
              generatedAt: '2026-10-15T15:00:00Z',
              items: actionItems(),
              hasMore: false,
            },
      ),
    }),
  );
  await page.goto('/dashboard');
  const actions = page.getByRole('region', { name: 'O que precisa de você' });
  await expect(actions.getByRole('alert')).toContainText(
    'Não foi possível consultar suas providências agora.',
  );
  await expect(
    actions.getByRole('button', { name: 'Tudo —', exact: true }),
  ).toBeVisible();
  await expect(
    actions.getByText('Nenhuma providência nesta visão', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Seu resultado' }),
  ).toContainText('R$ 8.400,00');
  failing = false;
  await actions
    .getByRole('button', { name: 'Atualizar providências', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    actions.getByRole('heading', {
      name: 'O que precisa de você',
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    actions.getByRole('button', { name: 'Tudo 5', exact: true }),
  ).toBeVisible();
});

test('an event preserves a payment draft and its original version until explicit review', async ({
  page,
}) => {
  const mock = await mockPainel(page, { manager: false });
  let releaseEvent = () => {};
  const gate = new Promise((resolve) => {
    releaseEvent = () => resolve(null);
  });
  await page.route('**/api/v1/events?**', async (route) => {
    await gate;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: 'retry: 60000\n\nevent: inbox.order.changed\nid: action-update\ndata: {"orderId":"manual-12"}\n\n',
    });
  });
  await page.goto('/dashboard');
  const actions = page.getByRole('region', { name: 'O que precisa de você' });
  await actions
    .getByRole('button', { name: 'Abrir Equipe Sintética', exact: true })
    .click();
  await actions
    .getByRole('button', { name: 'Registrar pagamento', exact: true })
    .click();
  await actions.getByLabel('Data do recebimento integral').fill('2026-10-14');
  const check = actions.getByRole('checkbox', {
    name: 'Confirmo que o valor integral foi recebido.',
  });
  await check.check();
  const rows = actionItems();
  rows[1].targetVersion = 5;
  rows[1].order.finalAmountCents = 200000;
  rows[1].order.version = 5;
  mock.setActions(rows);
  const readsBefore = mock.actionReads();
  releaseEvent();
  await expect(
    actions.getByText(
      'Há uma atualização pendente. Seus dados digitados foram preservados.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(mock.actionReads()).toBe(readsBefore);
  await expect(actions.getByLabel('Data do recebimento integral')).toHaveValue(
    '2026-10-14',
  );
  await expect(check).toBeChecked();
  await expect(actions).toContainText('R$ 1.280,00');
  await actions
    .getByRole('button', { name: 'Confirmar pagamento', exact: true })
    .click();
  await expect(actions.getByRole('alert')).toContainText(
    'A providência mudou.',
  );
  expect(mock.writes[0].body.expectedVersion).toBe(4);
  await expect(check).toBeChecked();
});

test('a partial queue labels its loaded counts and links to complete work lists', async ({
  page,
}) => {
  await mockPainel(page, { manager: false });
  await page.route('**/api/v1/dashboard/actions', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        today: '2026-10-15',
        generatedAt: '2026-10-15T15:00:00Z',
        items: actionItems().slice(0, 2),
        hasMore: true,
      }),
    }),
  );
  await page.goto('/dashboard');
  const actions = page.getByRole('region', { name: 'O que precisa de você' });
  await expect(actions).toContainText(
    'Mostrando 2 itens; há mais na lista completa.',
  );
  await expect(actions).toContainText(
    'Os contadores consideram apenas os itens carregados.',
  );
  await expect(
    actions.getByRole('button', { name: 'Tudo 2', exact: true }),
  ).toBeVisible();
  await expect(
    actions.getByRole('link', { name: 'Ver todas as minhas conversas' }),
  ).toHaveAttribute('href', '/inbox?fila=minhas');
  await expect(
    actions.getByText('Nada urgente agora.', { exact: true }),
  ).toHaveCount(0);
});

test('failed or unknown sends ask for verification, never imply a silent customer', async ({
  page,
}) => {
  await mockPainel(page, { manager: false });
  const rows = actionItems();
  rows[0].reason = 'send_unknown';
  rows[0].subtitle = 'Resultado do envio desconhecido; confira sem reenviar';
  await page.route('**/api/v1/dashboard/actions', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        today: '2026-10-15',
        generatedAt: '2026-10-15T15:00:00Z',
        items: rows,
        hasMore: false,
      }),
    }),
  );
  await page.goto('/dashboard');
  const actions = page.getByRole('region', { name: 'O que precisa de você' });
  await actions
    .getByRole('button', { name: 'Abrir Cliente Sintético', exact: true })
    .click();
  await expect(
    actions.getByRole('link', { name: 'Verificar envio na conversa' }),
  ).toHaveAttribute('href', '/inbox/reply-1');
  await expect(
    actions.getByRole('link', { name: 'Abrir conversa para responder' }),
  ).toHaveCount(0);
  await expect(actions).toContainText('não reenvie sem conferir');
});
