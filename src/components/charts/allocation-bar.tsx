import { formatBRL } from "@/lib/format";
import { CLASS_COLOR } from "@/lib/chart-colors";

export interface AllocationSlice {
  slug: string;
  name: string;
  value: number;
}

// Parte-de-um-todo: barra horizontal empilhada única (divs puros), com gap de
// 2px na cor da superfície entre segmentos e legenda com valores (a legenda
// com números é o "relief" exigido pelas cores claras no modo claro).
export function AllocationBar({ slices }: { slices: AllocationSlice[] }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const visible = slices.filter((s) => s.value > 0);
  if (total <= 0 || visible.length === 0) {
    return <p className="text-sm text-zinc-500">Sem dados de alocação ainda.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex h-6 w-full overflow-hidden rounded-md" style={{ gap: 2 }}>
        {visible.map((s) => (
          <div
            key={s.slug}
            title={`${s.name}: ${formatBRL(s.value)}`}
            style={{
              width: `${(s.value / total) * 100}%`,
              backgroundColor: CLASS_COLOR[s.slug] ?? "var(--chart-muted)",
              minWidth: 3,
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {visible.map((s) => (
          <li key={s.slug} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: CLASS_COLOR[s.slug] ?? "var(--chart-muted)" }}
            />
            <span className="text-zinc-700 dark:text-zinc-300">{s.name}</span>
            <span className="font-medium text-zinc-950 dark:text-zinc-50">
              {formatBRL(s.value)}
            </span>
            <span className="text-zinc-500">
              {((s.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
