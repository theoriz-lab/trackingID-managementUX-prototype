const PALETTE = Object.freeze([
  0x4cc9f0, 0x4895ef, 0x4361ee, 0x7c5cff, 0xb15cff, 0xf15bb5,
  0xff6b6b, 0xff922b, 0xf9c74f, 0x90be6d, 0x43aa8b, 0x2ec4b6
]);

export const GHOST_CLUSTER_COLOR = 0x8a909b;

const SESSION_COLOR_OFFSET = Math.floor(Math.random() * 1000);

export function clusterColorValue(key, sourceId) {
  const seed = Number.isInteger(sourceId) ? sourceId : hashString(String(key ?? ''));
  const index = Math.abs(seed * 5 + SESSION_COLOR_OFFSET) % PALETTE.length;
  return PALETTE[index];
}

export function clusterColorCss(key, sourceId) {
  return colorValueToCss(clusterColorValue(key, sourceId));
}

export function clusterDisplayColorCss(key, sourceId, ghost = false) {
  return colorValueToCss(ghost ? GHOST_CLUSTER_COLOR : clusterColorValue(key, sourceId));
}

function colorValueToCss(value) {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function hashString(value) {
  let hash = 0;
  for (const char of value) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return hash;
}
