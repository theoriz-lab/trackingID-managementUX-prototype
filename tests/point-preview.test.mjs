import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePointPreview } from '../src/point-preview.js';

test('point preview normalizes sampled XY points into the thumbnail', () => {
  const preview = samplePointPreview([
    -2, 0, 10,
     0, 2, 11,
     2, 4, 12
  ], 3);

  assert.deepEqual(preview, [
    [0, 1],
    [0.5, 0.5],
    [1, 0]
  ]);
});

test('point preview respects its sampling limit', () => {
  const data = [];
  for (let index = 0; index < 100; index += 1) data.push(index, index * 2, 0);
  assert.equal(samplePointPreview(data, 12).length, 12);
});

test('point preview handles empty clouds', () => {
  assert.deepEqual(samplePointPreview([], 32), []);
});
