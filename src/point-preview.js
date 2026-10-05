export function samplePointPreview(pointData, limit = 72, {
  center = [0, 0, 0],
  lookAt = [0, 0, 1]
} = {}) {
  const data = pointData ?? [];
  const pointCount = Math.floor(data.length / 3);
  if (pointCount <= 0 || limit <= 0) return [];

  const [cx = 0, cy = 0, cz = 0] = center.map(Number);
  let [fx = 0, , fz = 1] = lookAt.map(Number);
  const horizontalLength = Math.hypot(fx, fz);
  if (!Number.isFinite(horizontalLength) || horizontalLength < 1e-6) {
    fx = 0;
    fz = 1;
  } else {
    fx /= horizontalLength;
    fz /= horizontalLength;
  }

  // Y-up front view: horizontal thumbnail axis is the cluster's local right
  // vector, derived from its look-at direction.
  const rightX = fz;
  const rightZ = -fx;

  const count = Math.min(Math.max(1, Math.floor(limit)), pointCount);
  const step = pointCount / count;
  const sampled = [];

  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const pointIndex = Math.min(pointCount - 1, Math.floor(sampleIndex * step));
    const offset = pointIndex * 3;
    const x = Number(data[offset]);
    const y = Number(data[offset + 1]);
    const z = Number(data[offset + 2]);
    if (![x, y, z].every(Number.isFinite)) continue;

    const dx = x - cx;
    const dz = z - cz;
    sampled.push([
      dx * rightX + dz * rightZ,
      y - cy
    ]);
  }

  if (!sampled.length) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of sampled) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);
  return sampled.map(([x, y]) => [
    (x - minX) / width,
    1 - (y - minY) / height
  ]);
}
