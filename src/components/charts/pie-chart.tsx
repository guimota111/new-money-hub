"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatBRL } from "@/lib/format";

export interface PieSlice {
  key: string;
  name: string;
  value: number;
  color: string;
}

const RADIAN = Math.PI / 180;

// Percentual dentro da fatia — omitido em fatias < 6% (não cabe legível);
// nesses casos o percentual continua disponível na legenda.
function SliceLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  percent,
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
}) {
  if (!percent || percent < 0.06) return null;
  const r = (outerRadius ?? 0) * 0.62;
  const x = (cx ?? 0) + r * Math.cos(-(midAngle ?? 0) * RADIAN);
  const y = (cy ?? 0) + r * Math.sin(-(midAngle ?? 0) * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#ffffff"
      fontSize={12}
      fontWeight={600}
      textAnchor="middle"
      dominantBaseline="central"
      style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.35)", strokeWidth: 2 }}
    >
      {(percent * 100).toFixed(0)}%
    </text>
  );
}

// Pizza fechada com percentuais nas fatias, total ao lado e legenda com
// valores — a legenda com números é o "relief" exigido pelas cores de baixo
// contraste no modo claro.
export function CategoryPie({
  slices,
  totalLabel = "Total",
}: {
  slices: PieSlice[];
  totalLabel?: string;
}) {
  const visible = slices.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0 || visible.length === 0) {
    return <p className="text-sm text-zinc-500">Sem dados para o gráfico.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center">
      <div className="h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible}
              dataKey="value"
              nameKey="name"
              outerRadius="100%"
              stroke="var(--chart-surface)"
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
              label={SliceLabel}
              labelLine={false}
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
      </div>
      <div className="shrink-0 text-center lg:min-w-32 lg:text-left">
        <p className="text-xs uppercase tracking-wide text-zinc-500">{totalLabel}</p>
        <p className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          {formatBRL(total)}
        </p>
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
