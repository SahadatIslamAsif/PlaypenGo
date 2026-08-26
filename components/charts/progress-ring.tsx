// The stat card's circular progress ring. Design system: "circular progress
// ring on the left (SVG, 4px stroke, track at 12% opacity)."

export function ProgressRing({
  percentage,
  size = 56,
  strokeWidth = 4,
  color = "var(--accent)",
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(percentage, 0), 100);
  const offset = circumference * (1 - clamped / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${clamped}%`}
      className="-rotate-90"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeOpacity={0.12}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        // Undo the ring's rotation so the number reads upright.
        transform={`rotate(90 ${size / 2} ${size / 2})`}
        // The label shares the caller's `color` rather than a hardcoded
        // `fill-ink` class. `--ink` inverts per theme; on a stat card's tint
        // fill (deliberately pale in both themes) that mismatch is exactly
        // what made the earlier hardcoded ring stroke invisible in dark mode.
        fill={color}
        className="text-xs font-semibold"
      >
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}
