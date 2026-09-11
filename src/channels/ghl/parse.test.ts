import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInbound } from './parse.js';

describe('ghl parseInbound', () => {
  it('forma workflow: texto anidado en message.body', () => {
    const m = parseInbound({ contact_id: 'c1', message: { type: 19, body: 'Hola' }, full_name: 'Ana' });
    assert.ok(m);
    assert.equal(m.externalContactId, 'c1');
    assert.equal(m.text, 'Hola');
    assert.equal(m.name, 'Ana');
    assert.equal(m.isInbound, true);
  });

  it('forma nativa: body en la raíz + messageId', () => {
    const m = parseInbound({ contactId: 'c2', body: 'Hey', messageId: 'm1', direction: 'inbound' });
    assert.ok(m);
    assert.equal(m.externalContactId, 'c2');
    assert.equal(m.externalMessageId, 'm1');
  });

  it('marca los salientes', () => {
    const m = parseInbound({ contactId: 'c', body: 'x', direction: 'outbound' });
    assert.equal(m?.isInbound, false);
  });

  it('null sin contactId o sin texto', () => {
    assert.equal(parseInbound({ body: 'x' }), null);
    assert.equal(parseInbound({ contactId: 'c' }), null);
  });
});
