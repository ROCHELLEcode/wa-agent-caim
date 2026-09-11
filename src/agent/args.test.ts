import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { list, NOT_SAID, positiveNumber, text } from './args.js';

describe('text', () => {
  it('descarta vacío, espacios y el centinela NOT_SAID', () => {
    assert.equal(text(''), undefined);
    assert.equal(text('   '), undefined);
    assert.equal(text(NOT_SAID), undefined);
    assert.equal(text(5), undefined);
    assert.equal(text('hola'), 'hola');
    assert.equal(text('  hola  '), 'hola');
  });
});

describe('positiveNumber', () => {
  it('descarta 0, negativos y no-números', () => {
    assert.equal(positiveNumber(0), undefined);
    assert.equal(positiveNumber(-3), undefined);
    assert.equal(positiveNumber('3' as unknown), undefined);
    assert.equal(positiveNumber(3), 3);
  });
});

describe('list', () => {
  it('filtra a los valores permitidos, o undefined si queda vacía', () => {
    assert.deepEqual(list(['a', 'x', 'b'], ['a', 'b'] as const), ['a', 'b']);
    assert.equal(list(['x'], ['a', 'b'] as const), undefined);
    assert.equal(list('a', ['a'] as const), undefined);
  });
});
