"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatBRL } from "@/lib/format";

export interface DonutSlice {
  key: string;
  name: string;
  value: number;
  color: string;
}

// Pizza (donut) com total no centro e legenda com valores — a legenda com
// números é o "relief" exigido pelas cores de baixo contraste no modo claro.
export function DonutChart({
  slices,
  centerLabel,
}: {
  slices: DonutSlice[];
  centerLabel?: string;
}) {
  const visible = slices.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0 || visible.length === 0) {
    return <p className="text-sm text-zinc-500">Sem dados para o gráfico.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center">
      <div className="relative h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="100%"
              stroke="var(--chart-surface)"
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
            >
              {visible.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [formatBRL(Number(value)), String(name)]}
              contentStyle={{
                backgroundColor: "var(--chart-surface)",
                border: "1px solid var(--chart-grid)",
                borderRadius: 8,
                fontSize: 13,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && <span className="text-xs text-zinc-500">{centerLabel}</span>}
          <span className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {formatBRL(total)}
          </span>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {visible.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-zinc-700 dark:text-zinc-300">{s.name}</span>
            <span className="ml-auto font-medium text-zinc-950 dark:text-zinc-50">
              {formatBRL(s.value)}
            </span>
            <span className="w-14 text-right text-zinc-500">
              {((s.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
