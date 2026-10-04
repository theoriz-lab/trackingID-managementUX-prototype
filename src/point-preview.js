export function samplePointPreview(pointData, limit = 72) {
  const data = pointData ?? [];
  const pointCount = Math.floor(data.length / 3);
  if (pointCount <= 0 || limit <= 0) return [];

  const count = Math.min(Math.max(1, Math.floor(limit)), pointCount);
  const step = pointCount / count;
  const sampled = [];

  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const pointIndex = Math.min(pointCount - 1, Math.floor(sampleIndex * step));
    const offset = pointIndex * 3;
    const x = Number(data[offset]);
    const y = Number(data[offset + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sampled.push([x, y]);
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
