import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esPedidoGenericoDeInfo } from './runner.js';

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
});
