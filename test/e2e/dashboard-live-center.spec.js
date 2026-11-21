import { expect, test } from '@playwright/test';
import { mockPainel } from './support/painel-mock.js';

test('Central mantém a fila escolhida e relê o relógio, as filas e os fatos em uma lacuna', async ({
  page,
}) => {
  await mockPainel(page);
  await page.clock.install({ time: new Date('2026-11-05T13:00:00Z') });
  let minutes = 14,
    factsReads = 0;
  let generation = 0;
  // Controllable transport for the real shell's EventSource listeners.
  await page.addInitScript(() => {
    class Source extends globalThis.EventTarget {
      constructor() {
        super();
        globalThis.addEventListener('painel-fixture-event', (e) => {
          const { type, data, id } = /** @type {CustomEvent} */ (e).detail;
          this.dispatchEvent(
            new globalThis.MessageEvent(type, {
              data: JSON.stringify(data),
              lastEventId: id,
            }),
          );
        });
      }
      close() {}
    }
    Object.defineProperty(globalThis, 'EventSource', { value: Source });
  });
  await page.route('**/api/v1/dashboard/live?**', async (route) => {
    const p = new URL(route.request().url()).searchParams;
    const stamp = '2026-11-05T13:00:00Z';
    if (p.get('region') === 'facts') {
      factsReads++;
      return route.fulfill({
        json: {
          generatedAt: stamp,
          facts: generation
            ? [
                {
                  cursor: '8',
                  kind: 'printed',
                  recordId: 'store-1',
                  reference: 'LJ-001',
                  at: stamp,
                },
              ]
            : [],
          nextCursor: null,
        },
      });
    }
    const filter = p.get('filter') ?? 'todas';
    const rows =
      filter === 'sem-responsavel' || (filter === 'atrasada' && minutes <= 15)
        ? []
        : [{ id: 'conversation-1', kind: 'resposta', minutes }];
    return route.fulfill({
      json: {
        generatedAt: stamp,
        page: 1,
        pageSize: 20,
        unclaimed: 0,
        waiting: 1,
        late: minutes > 15 ? 1 : 0,
        total: rows.length,
        withAgent: 0,
        oldestMinutes: rows.length ? minutes : null,
        rows,
      },
    });
  });
  await page.goto('/dashboard?visao=central&fila=atrasada&periodo=mes');
  const queue = page.getByRole('region', { name: 'Fila de atenção' });
  await expect(queue.getByText('Nenhum atendimento nesta fila.')).toBeVisible();
  minutes = 16;
  await page.clock.fastForward(31000);
  const record = queue.getByRole('link', {
    name: /Aguardando resposta humana/,
  });
  await expect(record).toContainText('16 min');
  await record.focus();
  generation++;
  const previous = factsReads;
  await page.evaluate(() => {
    for (const type of [
      'open',
      'stream.reset',
      'inbox.order.changed',
      'inbox.order.changed',
    ]) {
      globalThis.dispatchEvent(
        new globalThis.CustomEvent('painel-fixture-event', {
          detail: { type, data: { cursor: '8', orderId: 'store-1' }, id: '8' },
        }),
      );
    }
  });
  await page.clock.fastForward(500);
  await expect.poll(() => factsReads).toBeGreaterThan(previous);
  await expect(
    page.getByRole('link', { name: /Primeira impressão da loja.*LJ-001/ }),
  ).toHaveCount(1);
  await expect(record).toBeFocused();
  await page.evaluate(() =>
    globalThis.dispatchEvent(
      new globalThis.CustomEvent('painel-fixture-event', {
        detail: { type: 'error', data: {}, id: '8' },
      }),
    ),
  );
  await expect(
    page.getByText('Sem conexão ao vivo', { exact: true }),
  ).toBeVisible();
  await expect(record).toBeVisible();
  await record.press('Enter');
  await expect(page).toHaveURL(/\/inbox\/conversation-1/u);
  await page.goBack();
  await expect(
    queue.getByRole('button', { name: /Acima de 15 min úteis/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('link', { name: /Primeira impressão da loja.*pedidos?/ }),
  ).toHaveAttribute('href', '/pedidos?origem=loja&impressao=pendente');
});

test('Resumo de ontem diferencia prévia, registro preparado, zero e falha sem emitir comando', async ({
  page,
}) => {
  await mockPainel(page);
  let snapshot = false,
    fail = false,
    enabled = false;
  const methods = /** @type {string[]} */ ([]);
  await page.route('**/api/v1/dashboard/checkpoint', async (route) => {
    methods.push(route.request().method());
    if (fail)
      return route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE' },
      });
    return route.fulfill({
      json: {
        day: '2026-11-04',
        scheduledAt: '08:00',
        enabled,
        configured: true,
        snapshot,
        generatedAt: '2026-11-05T12:10:00Z',
        totals: { soldAmountCents: 0, confirmedCount: 0 },
        previewText: 'Resumo de vendas',
        recipients: [
          {
            id: 'a',
            label: 'Destino sintético',
            status: snapshot ? 'sent' : 'not_generated',
          },
        ],
      },
    });
  });
  await page.goto('/dashboard');
  const region = page.getByRole('region', {
    name: 'Resumo automático de ontem',
  });
  await expect(
    region.getByText('Prévia dinâmica', { exact: true }),
  ).toBeVisible();
  await expect(region.getByText(/Automação desativada/)).toBeVisible();
  await expect(region.locator('dd').nth(1)).toHaveText('0');
  snapshot = enabled = true;
  await region.getByRole('button', { name: 'Atualizar resumo' }).click();
  await expect(
    region.getByText('Registro preparado', { exact: true }),
  ).toBeVisible();
  await expect(
    region.getByText(/Aceito pelo provedor · entrega não confirmada/),
  ).toBeVisible();
  fail = true;
  await region.getByRole('button', { name: 'Atualizar resumo' }).click();
  await expect(region.getByText(/Falha ao atualizar/)).toBeVisible();
  await expect(
    region.getByText('Registro preparado', { exact: true }),
  ).toBeVisible();
  expect(methods.every((method) => method === 'GET')).toBe(true);
});
