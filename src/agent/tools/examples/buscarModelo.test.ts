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

type Resultado = {
  opciones: { key: string; precio: number; capacidad: number; linea: string }[];
  capacidad_exacta: boolean;
};

describe('buscarModelo — la línea/código tiene prioridad sobre la capacidad', () => {
  it('caso real reportado: "quiero una MICRO de 24 huevos" da SOLO la MICROPLUS 24 (S/350), no la 24 normal (S/250)', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 24, codigo_modelo: 'MICROPLUS' }, ctx())) as Resultado;
    assert.equal(r.opciones.length, 1);
    assert.equal(r.opciones[0]!.key, 'incubadora_24_microplus');
    assert.equal(r.opciones[0]!.precio, 350);
    assert.equal(r.capacidad_exacta, true);
  });

  it('acepta la forma corta/coloquial "micro" como alias de MICROPLUS', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 24, codigo_modelo: 'micro' }, ctx())) as Resultado;
    assert.equal(r.opciones.length, 1);
    assert.equal(r.opciones[0]!.key, 'incubadora_24_microplus');
  });

  it('"OVNI" no matchea "OVNIPLUS" (son líneas distintas, no un substring)', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 18, codigo_modelo: 'OVNI' }, ctx())) as Resultado;
    // 18 no existe en la línea OVNI pura (26/52) — no debe devolver la
    // 18 OVNIPLUS (otra línea) ni adivinar una sola: trae las dos variantes
    // de OVNI para que el cliente elija.
    assert.deepEqual(
      r.opciones.map((o) => o.key).sort(),
      ['incubadora_26_ovni', 'incubadora_52_ovni'],
    );
    assert.equal(r.capacidad_exacta, false);
  });

  it('regla de negocio: si la línea pedida no tiene esa capacidad exacta, manda TODAS sus variantes (nunca adivina una sola "más cercana")', async () => {
    // "20 huevos en este modelo" (MICROPLUS) — MICROPLUS no tiene 20, pero sí
    // 24 y 50: deben venir las dos para que el cliente elija, no solo la 24.
    const r = (await buscarModelo.run({ capacidad_huevos: 20, codigo_modelo: 'MICROPLUS' }, ctx())) as Resultado;
    assert.deepEqual(
      r.opciones.map((o) => o.key).sort(),
      ['incubadora_24_microplus', 'incubadora_50_microplus'],
    );
    assert.equal(r.capacidad_exacta, false);
  });

  it('solo línea, sin capacidad puntual: manda todas las variantes de esa línea', async () => {
    const r = (await buscarModelo.run({ codigo_modelo: 'MICROPLUS' }, ctx())) as Resultado;
    assert.deepEqual(
      r.opciones.map((o) => o.key).sort(),
      ['incubadora_24_microplus', 'incubadora_50_microplus'],
    );
  });

  it('regla de negocio: capacidad exacta sin línea y con más de un modelo disponible (24 normal y 24 MICROPLUS) manda AMBAS opciones y nada más', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 24 }, ctx())) as Resultado;
    assert.deepEqual(
      r.opciones.map((o) => o.key).sort(),
      ['incubadora_24', 'incubadora_24_microplus'],
    );
    assert.equal(r.capacidad_exacta, true);
  });

  it('regla de negocio: capacidad exacta con un solo modelo disponible manda SOLO ese modelo', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 6 }, ctx())) as Resultado;
    assert.equal(r.opciones.length, 1);
    assert.equal(r.opciones[0]!.key, 'incubadora_06');
  });

  it('sin línea ni capacidad exacta disponible, da la opción más cercana (sin mezclar con otra que el cliente no pidió)', async () => {
    const r = (await buscarModelo.run({ capacidad_huevos: 20 }, ctx())) as Resultado;
    assert.equal(r.opciones.length, 1);
    assert.equal(r.opciones[0]!.key, 'incubadora_ovniplus_18');
    assert.equal(r.capacidad_exacta, false);
  });

  it('sin capacidad_huevos ni codigo_modelo, da error en vez de adivinar', async () => {
    const r = (await buscarModelo.run({}, ctx())) as { error?: string };
    assert.ok(r.error);
  });
});
