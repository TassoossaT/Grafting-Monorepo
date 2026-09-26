/**
 * Draws a spiral the way a person does with a centre-ends spiral tool:
 * click the centre, click the start (its height is where the spiral
 * starts), turn the pointer round the centre -- the hover previews are what
 * count the turning -- and click the end.
 */
export function drawSpiral(tool, ctx, { center, radius, startAngle = 0, turns, startY = center.y, params, end }) {
  const at = (angle) => ({ point: { x: center.x + radius * Math.cos(angle), y: 0, z: center.z + radius * Math.sin(angle) } });
  tool.onClick(ctx, { point: center }, params);
  tool.onClick(ctx, { point: { ...at(startAngle).point, y: startY } }, params);
  const steps = Math.max(2, Math.ceil(Math.abs(turns) * 16));
  for (let i = 1; i <= steps; i += 1) {
    const sample = at(startAngle + turns * 2 * Math.PI * (i / steps));
    tool.previewFor({ start: sample, current: sample, samples: [sample] }, params, ctx);
  }
  tool.onClick(ctx, end ?? at(startAngle + turns * 2 * Math.PI), params);
}

/** Clicks `points` with a curve draft tool, in order. */
export function clickAll(tool, ctx, points, params) {
  for (const point of points) {
    const sample = point.point ? point : { point };
    tool.previewFor({ start: sample, current: sample, samples: [sample] }, params, ctx);
    tool.onClick(ctx, sample, params);
  }
}
