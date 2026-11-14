import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mostrarSeccion } from './mostrarSeccion.js';
import type { ToolContext } from '../index.js';
import type { ConversationStore } from '../../../memory/store.js';

function ctx(alreadySent: Set<string> = new Set()): ToolContext {
  return {
    contactId: 'c1',
    conversationId: 'conv1',
    contactName: null,
    store: {} as ConversationStore,
    media: [],
    alreadySent,
  };
}

describe('mostrarSeccion — no reenvía una sección que ya se mandó antes en la conversación', () => {
  it('primera vez: manda todo el panorama de "pequenos" normalmente', async () => {
    const c = ctx();
    const r = (await mostrarSeccion.run({ seccion: 'pequenos' }, c)) as { ok: boolean; forzar_silencio?: boolean };
    assert.equal(r.ok, true);
    assert.equal(r.forzar_silencio, undefined);
    assert.ok(c.media.length > 0);
  });

  it('caso real reportado: si "pequenos" ya está en ctx.alreadySent (se mandó antes en esta conversación), no manda NADA de nuevo', async () => {
    const c = ctx(new Set(['seccion:pequenos']));
    const r = (await mostrarSeccion.run({ seccion: 'pequenos' }, c)) as {
      ok: boolean;
      ya_enviado_antes?: boolean;
      forzar_silencio?: boolean;
    };
    assert.equal(r.ok, false);
    assert.equal(r.ya_enviado_antes, true);
    assert.equal(r.forzar_silencio, true);
    assert.equal(c.media.length, 0);
  });

  it('secciones distintas son independientes: "pequenos" ya enviado no bloquea "piedra"', async () => {
    const c = ctx(new Set(['seccion:pequenos']));
    const r = (await mostrarSeccion.run({ seccion: 'piedra' }, c)) as { ok: boolean; forzar_silencio?: boolean };
    assert.equal(r.ok, true);
    assert.equal(r.forzar_silencio, undefined);
    assert.ok(c.media.length > 0);
  });
});
