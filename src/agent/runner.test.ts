import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esPedidoGenericoDeInfo, esPedidoAmbiguoDeProducto, pruneOrphanToolCalls } from './runner.js';

describe('esPedidoGenericoDeInfo', () => {
  it('matchea pedidos genéricos que SÍ dan alguna pista de ser sobre incubadoras', () => {
    for (const t of [
      'necesito info de las incubadoras',
      'buenos días, quisiera saber qué incubadoras manejan',
      'info de huevos de gallina',
    ]) {
      assert.equal(esPedidoGenericoDeInfo(t), true, `debería matchear: "${t}"`);
    }
  });

  it('bug reportado (CAIM ahora también vende picadoras de verduras): un pedido genérico SIN ninguna pista de incubadoras ya NO dispara el catálogo de incubadoras — ver esPedidoAmbiguoDeProducto', () => {
    for (const t of [
      'info',
      'Info',
      'INFO',
      'información',
      'informacion',
      '¿info?',
      'info porfa',
      'Catálogo',
      'catalogo',
      'hola buenas, quisiera información por favor',
      'buenas tardes me pueden dar info',
      'qué modelos tienen disponibles',
      'tienen catálogo de las máquinas',
      'me pasarían el catálogo porfa',
      'hola, quiero información de sus productos',
      'podrían darme info porfavor',
      'buenas, tienen catalogo?',
      'hola, cuánto cuesta',
      'qué precios tienen',
      'cuánto sale',
      'cuánto vale',
      'me pueden dar una cotización',
      'quisiera cotizar por favor',
      'buenas, cuál es el costo',
    ]) {
      assert.equal(esPedidoGenericoDeInfo(t), false, `ya NO debería matchear (ahora es ambiguo): "${t}"`);
    }
  });

  it('nunca matchea si se menciona "picadora" — eso lo maneja el flujo de picadora, no el de incubadoras', () => {
    for (const t of ['info', 'catálogo', 'precio'].map((p) => `${p} de la picadora`)) {
      assert.equal(esPedidoGenericoDeInfo(t), false, `NO debería matchear: "${t}"`);
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

});

describe('esPedidoAmbiguoDeProducto', () => {
  it('pedidos genéricos de precio/catálogo sin ninguna pista de incubadoras NI picadoras son ambiguos', () => {
    for (const t of [
      'info',
      'catalogo',
      'cuánto cuesta',
      'cuánto sale',
      'cuánto vale',
      'qué precios tienen',
      'me pueden dar una cotización',
    ]) {
      assert.equal(esPedidoAmbiguoDeProducto(t), true, `debería ser ambiguo: "${t}"`);
    }
  });

  it('NO es ambiguo si hay pista de incubadoras (eso es esPedidoGenericoDeInfo) ni si menciona picadora (eso es otro flujo)', () => {
    for (const t of ['necesito info de las incubadoras', 'cuánto cuesta la picadora', 'hola', 'quiero una de 24 huevos']) {
      assert.equal(esPedidoAmbiguoDeProducto(t), false, `NO debería ser ambiguo: "${t}"`);
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
