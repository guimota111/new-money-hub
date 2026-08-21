"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { formatBRL } from "@/lib/format";
import { INCOME_COLOR } from "@/lib/chart-colors";

export interface IncomeCategoryInfo {
  slug: string;
  name: string;
}

export type MonthlyIncomeRow = { month: string } & Record<string, number | string>;

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(m) - 1]}/${y.slice(2)}`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function IncomeChart({
  rows,
  categories,
}: {
  rows: MonthlyIncomeRow[];
  categories: IncomeCategoryInfo[];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">Sem receitas no período.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={formatMonth}
            tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatCompact}
            tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            formatter={(value, name) => [formatBRL(Number(value)), String(name)]}
            labelFormatter={(label) => formatMonth(String(label))}
            contentStyle={{
              backgroundColor: "var(--chart-surface)",
              border: "1px solid var(--chart-grid)",
              borderRadius: 8,
              fontSize: 13,
            }}
            cursor={{ fill: "var(--chart-grid)", opacity: 0.4 }}
          />
          <Legend
            formatter={(value) => (
              <span style={{ color: "var(--chart-muted)", fontSize: 13 }}>{value}</span>
            )}
          />
          {categories.map((c) => (
            <Bar
              key={c.slug}
              dataKey={c.slug}
              name={c.name}
              stackId="renda"
              maxBarSize={24}
              fill={INCOME_COLOR[c.slug] ?? "var(--chart-muted)"}
              stroke="var(--chart-surface)"
              strokeWidth={1}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
