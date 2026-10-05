export const UNASSIGNED_ID_COLOR_VALUE = 0x8a909b;
export const UNASSIGNED_ID_COLOR_CSS = '#8a909b';
const ID_ZERO_COLOR = 0x7cf7ff;

const ID_PALETTE = Object.freeze([
  0x10d9ff, // 1 cyan
  0xff3fb4, // 2 magenta
  0xff8a2a, // 3 orange
  0x70e34f, // 4 lime
  0x8b5cff, // 5 violet
  0x00d7b5, // 6 teal
  0xff465f, // 7 red
  0xffd429, // 8 yellow
  0x4b7cff, // 9 blue
  0xff6f91, // 10 pink
  0xb9f227, // 11 acid green
  0x31a8ff  // 12 sky blue
]);

export function idColorValue(id) {
  if (id === null || id === undefined || id === '') return UNASSIGNED_ID_COLOR_VALUE;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 0) return UNASSIGNED_ID_COLOR_VALUE;
  if (numericId === 0) return ID_ZERO_COLOR;
  return ID_PALETTE[(numericId - 1) % ID_PALETTE.length];
}

export function idColorCss(id) {
  return colorValueToCss(idColorValue(id));
}

export function colorValueToCss(value) {
  return `#${Number(value).toString(16).padStart(6, '0')}`;
}

export function idPaletteSize() {
  return ID_PALETTE.length;
}
