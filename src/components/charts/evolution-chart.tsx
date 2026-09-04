"use client";

import { useMemo, useState } from "react";
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
import { GranularityToggle } from "@/components/granularity-toggle";
import { bucketKey, bucketLabel, type Granularity } from "@/lib/granularity";

export interface EvolutionPoint {
  date: string; // yyyy-mm-dd
  total: number;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function EvolutionChart({ points }: { points: EvolutionPoint[] }) {
  const [granularity, setGranularity] = useState<Granularity>("dia");

  // patrimônio é um nível, não um fluxo: cada bucket fica com o último
  // snapshot dele (points chega ordenado por data, então o último vence)
  const data = useMemo(() => {
    const byBucket = new Map<string, number>();
    for (const p of points) byBucket.set(bucketKey(p.date, granularity), p.total);
    return [...byBucket.entries()].map(([key, total]) => ({ key, total }));
  }, [points, granularity]);

  if (points.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        O histórico aparece aqui conforme as cotações são atualizadas — cada
        atualização grava um snapshot do patrimônio.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <GranularityToggle value={granularity} onChange={setGranularity} />
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="key"
              tickFormatter={(key) => bucketLabel(String(key), granularity)}
              tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
              axisLine={{ stroke: "var(--chart-grid)" }}
              tickLine={false}
              minTickGap={24}
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
              labelFormatter={(label) => bucketLabel(String(label), granularity)}
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
              dot={
                data.length > 40
                  ? false
                  : { r: 4, fill: "var(--series-1)", stroke: "var(--chart-surface)", strokeWidth: 2 }
              }
              activeDot={{ r: 5, stroke: "var(--chart-surface)", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
