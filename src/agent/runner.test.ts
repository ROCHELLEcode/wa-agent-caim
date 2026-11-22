import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esPedidoGenericoDeInfo, pruneOrphanToolCalls } from './runner.js';

describe('esPedidoGenericoDeInfo', () => {
  it('matchea pedidos genéricos típicos, con o sin tildes/mayúsculas/signos', () => {
    for (const t of ['info', 'Info', 'INFO', 'información', 'informacion', '¿info?', 'info porfa', 'Catálogo', 'catalogo']) {
      assert.equal(esPedidoGenericoDeInfo(t), true, `debería matchear: "${t}"`);
    }
  });

  it('matchea frases reales de clientes (con saludo, "porfa", "quisiera", etc. — no solo la frase pelada)', () => {
    for (const t of [
      'hola buenas, quisiera información por favor',
      'buenas tardes me pueden dar info',
      'necesito info de las incubadoras',
      'qué modelos tienen disponibles',
      'tienen catálogo de las máquinas',
      'me pasarían el catálogo porfa',
      'hola, quiero información de sus productos',
      'buenos días, quisiera saber qué incubadoras manejan',
      'podrían darme info porfavor',
      'buenas, tienen catalogo?',
    ]) {
      assert.equal(esPedidoGenericoDeInfo(t), true, `debería matchear: "${t}"`);
    }
  });

  it('matchea pedidos genéricos de precio/cotización SIN mencionar modelo ni capacidad (antes caían al criterio del LLM)', () => {
    for (const t of [
      'hola, cuánto cuesta',
      'qué precios tienen',
      'cuánto sale',
      'cuánto vale',
      'me pueden dar una cotización',
      'quisiera cotizar por favor',
      'buenas, cuál es el costo',
    ]) {
      assert.equal(esPedidoGenericoDeInfo(t), true, `debería matchear: "${t}"`);
    }
  });

  it('NO matchea mensajes con cualquier pista real de modelo/capacidad/precio', () => {
    for (const t of [
      'info de la ovni',
      'precio de la de 12',
      'quiero una de 24 huevos',
      'info de la microplus',
      'info de la micro',
      'cuánto cuesta la más grande',
      'hola, quiero información de la más grande',
      'quiero una incubadora grande',
      'info de la industrial',
      'hola',
      'quiero comprar',
    ]) {
      assert.equal(esPedidoGenericoDeInfo(t), false, `NO debería matchear: "${t}"`);
    }
  });

  it('bug reportado: una pregunta puntual de seguimiento (sin número, pero con "cuánto") ya NO dispara el catálogo completo', () => {
    for (const t of [
      'con cuánto de adelanto me la envían',
      '¿cuánto es el adelanto?',
      'cuánto cuesta el flete',
      'cuánto demora el envío',
      'cuánto es el método de pago',
    ]) {
      assert.equal(esPedidoGenericoDeInfo(t), false, `NO debería matchear: "${t}"`);
    }
  });

  it('sigue matcheando los pedidos genéricos de precio sin palabras de seguimiento puntual', () => {
    for (const t of ['cuánto cuesta', 'cuánto sale', 'cuánto vale', 'qué precios tienen']) {
      assert.equal(esPedidoGenericoDeInfo(t), true, `debería matchear: "${t}"`);
    }
  });
});

describe('pruneOrphanToolCalls', () => {
  it('bug real: un tool_call sin resultado guardado (el proceso se cayó a mitad de turno) se descarta ENTERO, aunque ya no esté al final del historial', () => {
    const historial = [
      { role: 'user', content: 'quiero una de 24 huevos' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'buscar_modelo', arguments: '{}' } },
          { id: 'call_2', type: 'function', function: { name: 'send_product_media', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{}' },
      // call_2 nunca se guardó (acá se cayó el proceso).
      { role: 'user', content: 'hola de nuevo?' }, // turno siguiente, ya encolado
    ] as unknown as Parameters<typeof pruneOrphanToolCalls>[0];

    const limpio = pruneOrphanToolCalls(historial);
    assert.deepEqual(
      limpio.map((m) => m.role),
      ['user', 'user'],
    );
  });

  it('un historial sano (todos los tool_calls con su resultado) no se toca', () => {
    const historial = [
      { role: 'user', content: 'hola' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'stay_silent', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{}' },
    ] as unknown as Parameters<typeof pruneOrphanToolCalls>[0];

    assert.deepEqual(pruneOrphanToolCalls(historial), historial);
  });
});
