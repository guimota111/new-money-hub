"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { formatBRL } from "@/lib/format";

export interface EvolutionPoint {
  date: string; // yyyy-mm-dd
  total: number;
}

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function EvolutionChart({ points }: { points: EvolutionPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        O histórico aparece aqui conforme as cotações são atualizadas — cada
        atualização grava um snapshot do patrimônio.
      </p>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateShort}
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
            formatter={(value) => [formatBRL(Number(value)), "Patrimônio"]}
            labelFormatter={(label) => formatDateShort(String(label))}
            contentStyle={{
              backgroundColor: "var(--chart-surface)",
              border: "1px solid var(--chart-grid)",
              borderRadius: 8,
              fontSize: 13,
            }}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinecap="round"
            dot={{ r: 4, fill: "var(--series-1)", stroke: "var(--chart-surface)", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "var(--chart-surface)", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
