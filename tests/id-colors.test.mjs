import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UNASSIGNED_ID_COLOR_CSS,
  idColorCss,
  idColorValue,
  idPaletteSize
} from '../src/id-colors.js';

test('the first operator IDs receive distinct punchy colors', () => {
  const colors = Array.from({ length: 10 }, (_, index) => idColorValue(index + 1));
  assert.equal(new Set(colors).size, colors.length);
});

test('ID colors are stable and wrap only after the palette', () => {
  assert.equal(idColorValue(1), idColorValue(idPaletteSize() + 1));
  assert.equal(idColorCss(3), idColorCss(3));
});

test('ID zero is valid while missing IDs stay neutral gray', () => {
  assert.equal(idColorCss(null), UNASSIGNED_ID_COLOR_CSS);
  assert.equal(idColorCss(undefined), UNASSIGNED_ID_COLOR_CSS);
  assert.notEqual(idColorCss(0), UNASSIGNED_ID_COLOR_CSS);
});
