import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentControl, logMessageStatus, parseAgentControl } from './adapter.js';
import { MemoryStore } from '../../memory/memory.js';
import { ycloudEnv } from './env.js';
import type { ChannelContext } from '../types.js';
import type { AgentConfig } from '../../config.js';

const FROM = ycloudEnv.YCLOUD_FROM_NUMBER;
const CLIENTE = '+51999888777';

function echoPayload(to: string, body: string, from: string = FROM) {
  return {
    type: 'whatsapp.smb.message.echoes',
    whatsappMessage: { from, to, text: { body } },
  };
}

function ctxConFakeStore(store: MemoryStore): ChannelContext {
  return {
    store,
    config: {} as AgentConfig,
    enqueue: async () => {},
    runInline: async () => null,
  };
}

describe('parseAgentControl — detección de /nn y /ss en el eco de WhatsApp', () => {
  it('/nn pausa el agente (enable: false)', () => {
    const r = parseAgentControl(echoPayload(CLIENTE, '/nn'));
    assert.deepEqual(r, { externalContactId: CLIENTE, enable: false });
  });

  it('/ss reanuda el agente (enable: true)', () => {
    const r = parseAgentControl(echoPayload(CLIENTE, '/ss'));
    assert.deepEqual(r, { externalContactId: CLIENTE, enable: true });
  });

  it('es insensible a mayúsculas y a espacios alrededor', () => {
    const r = parseAgentControl(echoPayload(CLIENTE, '  /NN  '));
    assert.deepEqual(r, { externalContactId: CLIENTE, enable: false });
  });

  it('ignora el evento si no es un eco de whatsapp.smb.message.echoes', () => {
    const r = parseAgentControl({ type: 'whatsapp.inbound_message.received', whatsappMessage: { from: FROM, to: CLIENTE, text: { body: '/nn' } } });
    assert.equal(r, null);
  });

  it('ignora el eco si viene de otro número (otra cuenta/negocio en el mismo webhook)', () => {
    const r = parseAgentControl(echoPayload(CLIENTE, '/nn', '+51900000000'));
    assert.equal(r, null);
  });

  it('un mensaje normal tuyo (no un comando) no matchea nada', () => {
    const r = parseAgentControl(echoPayload(CLIENTE, 'dale, en un rato te paso el precio'));
    assert.equal(r, null);
  });

  it('un comando con typo (ej. "/n") no matchea nada', () => {
    const r = parseAgentControl(echoPayload(CLIENTE, '/n'));
    assert.equal(r, null);
  });
});

describe('applyAgentControl — efecto real sobre la conversación', () => {
  it('/nn deja agentEnabled=false y /ss lo vuelve a poner en true, en la MISMA conversación', async () => {
    const store = new MemoryStore();
    const ctx = ctxConFakeStore(store);

    await applyAgentControl({ externalContactId: CLIENTE, enable: false }, ctx);

    const contact = await store.upsertContact({ externalId: CLIENTE });
    const conv1 = await store.getOrCreateConversation(contact.id);
    assert.equal(conv1.agentEnabled, false);

    await applyAgentControl({ externalContactId: CLIENTE, enable: true }, ctx);
    const conv2 = await store.getOrCreateConversation(contact.id);
    assert.equal(conv2.id, conv1.id);
    assert.equal(conv2.agentEnabled, true);
  });

  it('una conversación nueva arranca con agentEnabled=true por defecto (antes de cualquier /nn)', async () => {
    const store = new MemoryStore();
    const contact = await store.upsertContact({ externalId: CLIENTE });
    const conv = await store.getOrCreateConversation(contact.id);
    assert.equal(conv.agentEnabled, true);
  });
});

describe('logMessageStatus — detección del estado real de entrega (whatsapp.message.updated)', () => {
  it('reconoce el evento y devuelve true, sea cual sea el status', () => {
    const r = logMessageStatus({
      type: 'whatsapp.message.updated',
      whatsappMessage: { id: 'msg1', to: CLIENTE, type: 'image', status: 'delivered' },
    });
    assert.equal(r, true);
  });

  it('también devuelve true para un status "failed" (con errorCode/errorMessage)', () => {
    const r = logMessageStatus({
      type: 'whatsapp.message.updated',
      whatsappMessage: {
        id: 'msg2',
        to: CLIENTE,
        type: 'image',
        status: 'failed',
        errorCode: 131026,
        errorMessage: 'Message undeliverable',
      },
    });
    assert.equal(r, true);
  });

  it('ignora cualquier otro tipo de evento (devuelve false, no lo intercepta)', () => {
    const r = logMessageStatus({ type: 'whatsapp.inbound_message.received', whatsappInboundMessage: {} });
    assert.equal(r, false);
  });
});
