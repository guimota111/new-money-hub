"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { advanceAnalysis, retryAnalysis } from "@/app/consultor/actions";
import type { RunSnapshot } from "@/lib/consultor/types";

// Dirige a análise: chama o servidor uma etapa por vez (a de IA leva até ~2
// minutos) e mostra o progresso. Fechar a aba não perde nada: ao voltar, a
// página retoma da etapa em que parou.
export function RunDriver({ initial }: { initial: RunSnapshot }) {
  const router = useRouter();
  const [snap, setSnap] = useState(initial);
  const [retrying, setRetrying] = useState(false);
  const loopRunning = useRef(false);

  useEffect(() => {
    if (snap.status !== "running" || loopRunning.current) return;
    loopRunning.current = true;
    let cancelled = false;

    (async () => {
      let current = snap;
      while (!cancelled && current.status === "running") {
        if (current.busy) await new Promise((r) => setTimeout(r, 3000));
        try {
          current = await advanceAnalysis(current.id);
        } catch (e) {
          current = {
            ...current,
            status: "failed",
            error: e instanceof Error ? e.message : "Falha de rede ao avançar a análise.",
          };
        }
        if (!cancelled) setSnap(current);
      }
      loopRunning.current = false;
      if (!cancelled && current.status === "done") router.refresh();
    })();

    return () => {
      cancelled = true;
      loopRunning.current = false;
    };
    // só re-arma quando o status volta a "running" (retry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.status, snap.id]);

  async function retry() {
    setRetrying(true);
    try {
      const next = await retryAnalysis(snap.id);
      setSnap(next);
    } finally {
      setRetrying(false);
    }
  }

  const failed = snap.status === "failed";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className={failed ? "text-red-700 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"}>
          {failed ? "A análise parou" : `${snap.stepLabel}${snap.busy ? " (aguardando outra aba)" : "…"}`}
        </span>
        <span className="tabular-nums text-zinc-500">{snap.progress}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            failed ? "bg-red-500" : "bg-emerald-500"
          }`}
          style={{ width: `${Math.max(3, snap.progress)}%` }}
        />
      </div>
      {failed && (
        <div className="space-y-2">
          <p className="text-sm text-red-700 dark:text-red-400">{snap.error}</p>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {retrying ? "Retomando..." : "Tentar de novo desta etapa"}
          </button>
        </div>
      )}
      {!failed && (
        <p className="text-xs text-zinc-500">
          Cada etapa de IA leva de 1 a 3 minutos. Pode fechar a aba; ao voltar, a análise
          continua de onde parou.
        </p>
      )}
    </div>
  );
}
