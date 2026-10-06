import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PRINT_TEMPLATE,
  TEMPLATE_V2,
  TEMPLATE_V3,
  TEMPLATE_V4,
  TEMPLATE_V5,
  TEMPLATE_V6,
  renderOrderFicha,
} from '../modules/orders/src/print/index.js';

const rootUrl = new URL('../', import.meta.url);

test('the print route alone permits the exact styles of supported ficha templates', async () => {
  const nginx = await readFile(new URL('docker/nginx.conf', rootUrl), 'utf8');
  const fixture = JSON.parse(
    await readFile(
      new URL('docs/phase0/ficha-pdf-synthetic-v4.json', rootUrl),
      'utf8',
    ),
  );
  const routePolicy =
    /map \$uri \$print_style_sources \{\s*default "";\s*~\^\/api\/v1\/orders\/\[\^\/\]\+\/print\$ "([^"]+)";\s*\}/u.exec(
      nginx,
    );

  assert.ok(routePolicy, 'only the print path adds stylesheet hashes');
  assert.match(nginx, /style-src 'self' \$print_style_sources" always;/u);
  assert.doesNotMatch(nginx, /unsafe-inline/u);

  const permittedHashes = new Set(routePolicy[1].split(' '));
  for (const template of [
    TEMPLATE_V2,
    TEMPLATE_V3,
    TEMPLATE_V4,
    TEMPLATE_V5,
    TEMPLATE_V6,
  ]) {
    const html = renderOrderFicha(fixture.order, template);
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gu)];
    assert.equal(styles.length, 1, `${template} has one static style block`);
    assert.doesNotMatch(
      html,
      /\sstyle=/iu,
      `${template} has no style attributes`,
    );
    const anotherOrder = structuredClone(fixture.order);
    anotherOrder.number = '26-CRM';
    anotherOrder.ficha.summary.cliente = 'Outra cliente sintética';
    const otherStyles = [
      ...renderOrderFicha(anotherOrder, template).matchAll(
        /<style>([\s\S]*?)<\/style>/gu,
      ),
    ];
    assert.equal(
      otherStyles[0]?.[1],
      styles[0][1],
      `${template} stylesheet is independent of order data`,
    );
    const hash = createHash('sha256')
      .update(styles[0][1], 'utf8')
      .digest('base64');
    assert.ok(
      permittedHashes.has(`'sha256-${hash}'`),
      `${template} must have its current CSS hash in the print CSP`,
    );
  }
  assert.ok(
    [TEMPLATE_V2, TEMPLATE_V3, TEMPLATE_V4, TEMPLATE_V5, TEMPLATE_V6].includes(
      PRINT_TEMPLATE,
    ),
    'the active template must be included in the permitted set',
  );
  assert.equal(
    permittedHashes.size,
    5,
    'no other inline stylesheet is allowed',
  );
});
