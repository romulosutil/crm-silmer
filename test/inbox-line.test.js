import assert from 'node:assert/strict';
import test from 'node:test';
import { brand } from '../apps/edge-web/src/brand/index.js';
import { conversationLine } from '../apps/edge-web/src/lib/format.js';

// WAP-09: synthetic conversations only.
const HOLDER = { id: 'seller-synthetic', name: 'Vendedora Sintética' };
const company = brand.companyName;

test('a personal conversation reads as the holder own WhatsApp', () => {
  assert.deepEqual(
    conversationLine(
      { channel: 'whatsapp', personalLine: true, assignedUser: HOLDER },
      { actorId: HOLDER.id },
    ),
    {
      badge: 'Seu WhatsApp',
      identity: 'WhatsApp pessoal',
      sendHint: 'Sai pelo seu WhatsApp',
    },
  );
});

test('anyone else reads the holder first name and cannot send from it', () => {
  assert.deepEqual(
    conversationLine(
      { channel: 'whatsapp', personalLine: true, assignedUser: HOLDER },
      { actorId: 'admin-synthetic' },
    ),
    {
      badge: 'WhatsApp de Vendedora',
      identity: 'WhatsApp pessoal de Vendedora',
      sendHint: 'Envio só pelo titular da linha',
    },
  );
  assert.equal(
    conversationLine(
      {
        channel: 'whatsapp',
        personalLine: true,
        assignedUser: { id: HOLDER.id },
      },
      { actorId: 'admin-synthetic', holderName: 'Carla Lima' },
    )?.badge,
    'WhatsApp de Carla',
  );
  assert.equal(
    conversationLine(
      { channel: 'whatsapp', personalLine: true, assignedUser: null },
      { actorId: 'admin-synthetic' },
    )?.badge,
    'WhatsApp pessoal',
  );
  // A name that is not a name is never shown.
  assert.equal(
    conversationLine(
      {
        channel: 'whatsapp',
        personalLine: true,
        assignedUser: { id: HOLDER.id, name: '<b>x</b>' },
      },
      { actorId: 'admin-synthetic' },
    )?.identity,
    'WhatsApp pessoal',
  );
});

test('the general line keeps row and header, and names the company exit', () => {
  for (const personalLine of [false, undefined]) {
    assert.deepEqual(
      conversationLine(
        { channel: 'whatsapp', personalLine, assignedUser: HOLDER },
        { actorId: HOLDER.id },
      ),
      {
        badge: '',
        identity: 'WhatsApp',
        sendHint: `Sai pela linha ${company}`,
      },
    );
  }
});

test('other channels have no line', () => {
  assert.equal(conversationLine({ channel: 'site_chat' }), null);
  assert.equal(
    conversationLine({ channel: 'instagram', personalLine: true }),
    null,
  );
  assert.equal(conversationLine(null), null);
});
