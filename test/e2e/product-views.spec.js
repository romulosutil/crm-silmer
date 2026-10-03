import { expect, test } from '@playwright/test';

test('prioritizes a pending order only after a delivered outbound message and opens its row', async ({
  page,
}) => {
  /** @param {number} hours */
  const ago = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const base = {
    confirmedAt: null,
    confirmedBy: null,
    finalAmountCents: null,
    ficha: { summary: { cliente: 'Cliente sem resposta', nome: 'Uniformes' } },
    missingFields: ['finalAmount'],
    seller: { name: 'Marina' },
    status: 'pendente',
    totalPieces: 10,
    updatedAt: ago(96),
  };
  const items = [
    {
      ...base,
      id: 'order-waiting',
      number: '25-CRM',
      lastMessage: {
        direction: 'outbound',
        deliveryStatus: 'delivered',
        occurredAt: ago(50),
      },
    },
    {
      ...base,
      ficha: { summary: { cliente: 'Cliente respondeu', nome: 'Camisetas' } },
      id: 'order-replied',
      number: '26-CRM',
      lastMessage: {
        direction: 'inbound',
        deliveryStatus: null,
        occurredAt: ago(50),
      },
    },
  ];

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/sessions/current') {
      await route.fulfill({
        json: { user: { id: 'seller-1', name: 'Marina', capabilities: [] } },
      });
    } else if (path === '/api/v1/events') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\n: connected\n\n',
      });
    } else if (path === '/api/v1/orders') {
      await route.fulfill({
        json: {
          items,
          counts: { confirmado: 0, pendente: 2 },
          nextCursor: null,
        },
      });
    } else {
      await route.fulfill({ status: 404, json: {} });
    }
  });

  await page.goto('/pedidos');
  const waiting = page.getByRole('row', { name: /Cliente sem resposta/ });
  await expect(waiting).toContainText('Retomar contato');
  await expect(waiting).toContainText('Cliente sem resposta há');
  const replied = page.getByRole('row', { name: /Cliente respondeu/ });
  await expect(replied).not.toContainText('Cliente sem resposta há');
  await expect(replied).toContainText('Revisar pedido');
  await waiting.getByRole('cell', { name: '10' }).click();
  await expect(page).toHaveURL('/pedidos/order-waiting');
});
