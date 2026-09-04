"use client";

import { useMemo, useState } from "react";
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
import { INCOME_COLOR, colorForSlug } from "@/lib/chart-colors";
import { GranularityToggle } from "@/components/granularity-toggle";
import {
  bucketKey,
  bucketLabel,
  bucketRange,
  type Granularity,
} from "@/lib/granularity";

export interface IncomeCategoryInfo {
  slug: string;
  name: string;
}

// lançamento cru — o chart agrega no cliente conforme a granularidade
export interface IncomeEntry {
  date: string; // yyyy-mm-dd
  slug: string;
  amount: number;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function IncomeChart({
  entries,
  categories,
}: {
  entries: IncomeEntry[];
  categories: IncomeCategoryInfo[];
}) {
  const [granularity, setGranularity] = useState<Granularity>("mes");

  // janelas por granularidade (60 dias / 26 semanas / 12 meses / todos os
  // anos) com buckets contínuos, para o eixo não pular períodos vazios
  const data = useMemo(() => {
    const first = entries.length > 0 ? entries[0].date : null;
    const buckets = bucketRange(granularity, first);
    const index = new Map(buckets.map((b, i) => [b, i]));
    const rows = buckets.map((b) => ({ key: b } as { key: string } & Record<string, number | string>));
    for (const e of entries) {
      const idx = index.get(bucketKey(e.date, granularity));
      if (idx == null) continue;
      const row = rows[idx];
      row[e.slug] = (Number(row[e.slug]) || 0) + e.amount;
    }
    return rows;
  }, [entries, granularity]);

  if (entries.length === 0) {
    return <p className="text-sm text-zinc-500">Sem receitas no período.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <GranularityToggle value={granularity} onChange={setGranularity} />
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
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
              formatter={(value, name) => [formatBRL(Number(value)), String(name)]}
              labelFormatter={(label) => bucketLabel(String(label), granularity)}
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
                fill={INCOME_COLOR[c.slug] ?? colorForSlug(c.slug)}
                stroke="var(--chart-surface)"
                strokeWidth={1}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
