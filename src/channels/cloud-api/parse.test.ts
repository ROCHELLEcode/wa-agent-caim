import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInbound } from './parse.js';

const PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ wa_id: '5491100000000', profile: { name: 'Ana' } }],
            messages: [{ from: '5491100000000', id: 'wamid.ABC', type: 'text', text: { body: 'Hola' } }],
          },
        },
      ],
    },
  ],
};

describe('cloud-api parseInbound', () => {
  it('extrae texto, contacto, nombre e id', () => {
    const m = parseInbound(PAYLOAD)[0]!;
    assert.equal(m.externalContactId, '5491100000000');
    assert.equal(m.text, 'Hola');
    assert.equal(m.name, 'Ana');
    assert.equal(m.externalMessageId, 'wamid.ABC');
    assert.equal(m.isInbound, true);
  });

  it('devuelve [] si no hay mensajes', () => {
    assert.equal(parseInbound({ entry: [] }).length, 0);
    assert.equal(parseInbound({}).length, 0);
  });
});
