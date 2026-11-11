import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buscarModelo } from './buscarModelo.js';
import type { ToolContext } from '../index.js';
import type { ConversationStore } from '../../../memory/store.js';

function ctx(): ToolContext {
  return {
    contactId: 'c1',
    conversationId: 'conv1',
    contactName: null,
    store: {} as ConversationStore,
    media: [],
    alreadySent: new Set(),
  };
}

describe('buscarModelo — la línea/código tiene prioridad sobre la capacidad', () => {
  it('caso real reportado: "quiero una MICRO de 24 huevos" da la MICROPLUS 24 (S/350), no la 24 normal (S/250)', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 24, codigo_modelo: 'MICROPLUS' }, ctx())) as {
      mas_cercano: { key: string; precio: number; capacidad: number };
    };
    assert.equal(r.mas_cercano.key, 'incubadora_24_microplus');
    assert.equal(r.mas_cercano.precio, 350);
  });

  it('acepta la forma corta/coloquial "micro" como alias de MICROPLUS', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 24, codigo_modelo: 'micro' }, ctx())) as {
      mas_cercano: { key: string };
    };
    assert.equal(r.mas_cercano.key, 'incubadora_24_microplus');
  });

  it('cuando la línea pedida no tiene esa capacidad exacta, da el modelo más cercano DENTRO de esa misma línea (nunca otra línea numéricamente más cercana)', async () => {
    // "20 huevos en este modelo" (MICROPLUS) — MICROPLUS no tiene 20, pero sí
    // 24 (dist 4) y 50 (dist 30). OVNIPLUS 18 (dist 2 del 20) NO debe ganar
    // solo por estar numéricamente más cerca: este fue el bug reportado.
    const r = (await buscarModelo.run({ capacidad_huevos: 20, codigo_modelo: 'MICROPLUS' }, ctx())) as {
      mas_cercano: { key: string; capacidad: number };
      capacidad_exacta: boolean;
    };
    assert.equal(r.mas_cercano.key, 'incubadora_24_microplus');
    assert.equal(r.capacidad_exacta, false);
  });

  it('"OVNI" no matchea "OVNIPLUS" (son líneas distintas, no un substring)', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 18, codigo_modelo: 'OVNI' }, ctx())) as {
      mas_cercano: { key: string };
    };
    // 18 no existe en la línea OVNI pura (26/52) — el más cercano dentro de
    // OVNI es el 26, nunca el 18 OVNIPLUS aunque matchee exacto en capacidad.
    assert.equal(r.mas_cercano.key, 'incubadora_26_ovni');
  });

  it('sin código de línea, sigue funcionando como antes (más cercano global)', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 24 }, ctx())) as {
      mas_cercano: { key: string };
    };
    assert.equal(r.mas_cercano.key, 'incubadora_24');
  });
});
