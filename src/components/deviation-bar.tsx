import { formatPercent } from "@/lib/format";

// Desvio da meta em pontos percentuais: barra divergente a partir do zero
// (centro). Abaixo da meta cresce para a esquerda no tom frio, acima para a
// direita no tom quente; o eixo central é neutro. O texto ao lado fica em
// token de texto, nunca na cor da série.
export function DeviationBar({ pts, scale }: { pts: number; scale: number }) {
  const half = Math.min(50, (Math.abs(pts) / Math.max(scale, 0.01)) * 50);
  const below = pts < 0;
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative h-3 w-28 shrink-0 overflow-hidden rounded-sm bg-zinc-200 dark:bg-zinc-800"
        title={`${pts >= 0 ? "+" : ""}${formatPercent(pts, 1)} pontos vs meta`}
        role="img"
        aria-label={`${pts >= 0 ? "acima" : "abaixo"} da meta em ${formatPercent(Math.abs(pts), 1)} pontos`}
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-400" />
        {Math.abs(pts) > 0.05 && (
          <div
            className="absolute inset-y-0.5 rounded-sm"
            style={{
              ...(below ? { right: "50%" } : { left: "50%" }),
              width: `${half}%`,
              backgroundColor: below ? "var(--series-1)" : "var(--series-2)",
            }}
          />
        )}
      </div>
      <span className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
        {pts >= 0 ? "+" : "−"}
        {formatPercent(Math.abs(pts), 1)}
      </span>
    </div>
  );
}
