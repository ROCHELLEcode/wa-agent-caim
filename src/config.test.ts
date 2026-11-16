import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { schema } from './config.js';

function base() {
  return {
    system_prompt: 'hola',
    products: [{ key: 'incubadora_24', media: [] }],
    catalogo: [{ key: 'incubadora_24', linea: '24', capacidad: 24, precio: 250 }],
  };
}

describe('schema de config/agent.yaml — cruce catalogo/products', () => {
  it('un catalogo.key que no existe en products falla al parsear (antes se resolvía en silencio a "sin fotos")', () => {
    const cfg = base();
    cfg.catalogo = [{ key: 'incubadora_24_TYPO', linea: '24', capacidad: 24, precio: 250 }];
    const r = schema.safeParse(cfg);
    assert.equal(r.success, false);
    assert.ok(r.error!.issues.some((i) => i.message.includes('incubadora_24_TYPO')));
  });

  it('products.key duplicada falla al parsear', () => {
    const cfg = base();
    cfg.products.push({ key: 'incubadora_24', media: [] });
    const r = schema.safeParse(cfg);
    assert.equal(r.success, false);
  });

  it('catalogo.key duplicada falla al parsear', () => {
    const cfg = base();
    cfg.catalogo.push({ key: 'incubadora_24', linea: '24 MICROPLUS', capacidad: 24, precio: 350 });
    const r = schema.safeParse(cfg);
    assert.equal(r.success, false);
  });

  it('un config sano (catalogo y products consistentes) parsea bien', () => {
    const r = schema.safeParse(base());
    assert.equal(r.success, true);
  });
});
