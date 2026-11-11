import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockOrders, ownConfirmedOrder } from './support/orders-mock.js';
import { actionItems, mockPainel } from './support/painel-mock.js';

test('delivery confirmation and correction preserve the legacy payment day and its pending review (DDE-02)', async ({
  page,
}) => {
  const original = {
    ...structuredClone(ownConfirmedOrder),
    origin: 'atendimento',
    paymentReviewRequired: true,
  };
  /** @type {Array<Record<string, any>>} */
  const writes = [];
  await mockOrders(page, {
    orders: [original],
    onWrite: (write) => writes.push(write),
  });
  await page.clock.setFixedTime(new Date('2026-10-22T15:00:00.000Z'));
  await page.goto('/pedidos/order-confirmado');
  const dates = page.getByRole('region', { name: 'Datas do pedido' });
  await expect(
    dates.getByRole('button', { name: 'Editar datas', exact: true }),
  ).toHaveCount(0);
  await dates
    .getByRole('button', { name: 'Confirmar entrega', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Confirmar entrega', exact: true })
    .getByRole('button', { name: 'Sim, confirmar entrega', exact: true })
    .click();
  const change = dates.getByRole('button', {
    name: 'Alterar data de entrega',
    exact: true,
  });
  await expect(change).toBeVisible();
  await change.click();
  const dialog = page.getByRole('dialog', {
    name: 'Alterar data de entrega',
    exact: true,
  });
  await expect(dialog.getByLabel('Pago em', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByLabel('Entregue em', { exact: true }).fill('2026-10-21');
  await dialog
    .getByRole('button', { name: 'Salvar data de entrega', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toEqual([
    { action: 'delivery-confirmation', body: { expectedVersion: 4 } },
    {
      action: 'delivery-confirmation',
      body: { expectedVersion: 5, deliveredOn: '2026-10-21' },
    },
  ]);
  const { order } = await page.evaluate(
    async () =>
      await (await globalThis.fetch('/api/v1/orders/order-confirmado')).json(),
  );
  expect(order.paidOn).toBe('2026-09-10');
  expect(order.paymentReviewRequired).toBe(true);
  expect(order.deliveredOn).toBe('2026-10-21');
  expect(order.status).toBe(original.status);
  expect(order.ficha).toEqual(original.ficha);
  await expect(dates.locator('[data-event-id="milestone:paid"]')).toContainText(
    'Em revisão',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('explicit full receipt review through Dashboard preserves the original payment day', async ({
  page,
}) => {
  const mock = await mockPainel(page, { manager: false });
  const rows = actionItems();
  const item = rows.find((row) => row.targetId === 'manual-12');
  if (!item) throw new Error('Legacy payment fixture is missing');
  const order = item.order;
  Object.assign(order, { paidOn: '2026-09-10', paymentReviewRequired: true });
  mock.setActions(rows);
  await page.route(
    '**/api/v1/orders/manual-12/payment-confirmation',
    async (route) => {
      const req = route.request();
      const body = req.postDataJSON();
      mock.writes.push({
        path: new URL(req.url()).pathname,
        method: req.method(),
        body,
        key: req.headers()['idempotency-key'],
      });
      Object.assign(order, {
        paidOn: body.paidOn,
        paymentReviewRequired: false,
        version: order.version + 1,
      });
      item.targetVersion = order.version;
      item.sourceRevision = `revision-${order.version}`;
      mock.setActions(rows);
      await route.fulfill({ json: { order } });
    },
  );
  await page.goto('/dashboard');
  const actions = page.getByRole('region', { name: 'O que precisa de você' });
  await actions
    .getByRole('button', { name: 'Abrir Equipe Sintética', exact: true })
    .click();
  await actions
    .getByRole('button', { name: 'Revisar quitação', exact: true })
    .click();
  await expect(actions.getByLabel('Data do recebimento integral')).toHaveValue(
    '2026-09-10',
  );
  const confirmation = actions.getByRole('checkbox', {
    name: 'Confirmo que o valor integral foi recebido.',
    exact: true,
  });
  await expect(confirmation).not.toBeChecked();
  const confirm = actions.getByRole('button', {
    name: 'Confirmar pagamento',
    exact: true,
  });
  await confirm.click();
  expect(mock.writes).toHaveLength(0);
  await confirmation.focus();
  await page.keyboard.press('Space');
  await confirm.focus();
  await page.keyboard.press('Enter');
  await expect(
    actions.getByText('Pagamento integral registrado em 10/09/2026.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    actions.getByRole('button', { name: 'Revisar quitação', exact: true }),
  ).toHaveCount(0);
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0]).toMatchObject({
    path: '/api/v1/orders/manual-12/payment-confirmation',
    method: 'POST',
    body: { expectedVersion: 4, paidOn: '2026-09-10', receivedInFull: true },
  });
  expect(mock.writes[0].key).toBeTruthy();
  expect(mock.writes[0].body).toEqual({
    expectedVersion: 4,
    paidOn: '2026-09-10',
    receivedInFull: true,
  });
  expect(order.paidOn).toBe('2026-09-10');
  expect(order.paymentReviewRequired).toBe(false);
  expect(order.deliveredOn).toBeNull();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
