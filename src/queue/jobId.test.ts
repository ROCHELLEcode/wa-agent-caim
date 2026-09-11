import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobId } from './jobId.js';

describe('buildJobId', () => {
  it('usa __ como separador (BullMQ rechaza los :)', () => {
    assert.equal(buildJobId('conv-1', 5), 'conv-1__5');
    assert.ok(!buildJobId('conv-1', 5).includes(':'));
  });
});
