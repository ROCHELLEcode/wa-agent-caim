import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esPedidoGenericoDeInfo } from './runner.js';

describe('esPedidoGenericoDeInfo', () => {
  it('matchea pedidos genéricos típicos, con o sin tildes/mayúsculas/signos', () => {
    for (const t of ['info', 'Info', 'INFO', 'información', 'informacion', '¿info?', 'info porfa', 'Catálogo', 'catalogo']) {
      assert.equal(esPedidoGenericoDeInfo(t), true, `debería matchear: "${t}"`);
    }
  });

  it('NO matchea mensajes con cualquier pista real de modelo/capacidad/precio', () => {
    for (const t of [
      'info de la ovni',
      'precio de la de 12',
      'quiero una de 24 huevos',
      'info de la microplus',
      'cuánto cuesta la más grande',
      'hola',
      'quiero comprar',
    ]) {
      assert.equal(esPedidoGenericoDeInfo(t), false, `NO debería matchear: "${t}"`);
    }
  });
});
