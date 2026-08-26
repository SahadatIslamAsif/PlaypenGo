// The explicit mobile fallback: "If a chart still feels cramped, fall back to
// a list of subject rows with a sparkline and the latest mark." No axes, no
// gridlines, no tooltip — just a shape, sized to sit inline in a list row.

export function Sparkline({
  values,
  width = 64,
  height = 24,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length === 0) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series (or a single point) still needs to draw a visible line
  // rather than collapsing to the vertical midpoint's edge case.
  const span = max - min || 1;

  const points = values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : (i / (values.length - 1)) * width,
    y: height - ((v - min) / span) * height,
  }));

  const d = points.reduce(
    (path, p, i) => path + (i === 0 ? `M ${p.x},${p.y}` : ` L ${p.x},${p.y}`),
    "",
  );

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
