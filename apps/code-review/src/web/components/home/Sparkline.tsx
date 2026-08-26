import { useId } from "react";
import { Area, AreaChart } from "recharts";

/**
 * A small, smooth review-trend sparkline drawn with recharts. Uses a monotone
 * curve + soft gradient area fill and inherits its color from the parent's
 * `currentColor`, so the repo card controls the accent. Animation is disabled
 * to keep a grid of these cheap to render.
 */
export function Sparkline({
  data,
  width = 96,
  height = 32,
  className = "",
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const gradientId = useId();
  const values = Array.isArray(data) && data.length > 0 ? data : [0, 0];
  const chartData = values.map((v, i) => ({ i, v }));

  return (
    <div className={className} style={{ width, height }}>
      <AreaChart
        width={width}
        height={height}
        data={chartData}
        margin={{ top: 3, right: 2, bottom: 3, left: 2 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </div>
  );
}
