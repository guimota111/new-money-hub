"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecommendationStatus } from "@/app/consultor/actions";

type Status = "pending" | "executed" | "partial" | "ignored";

const LABEL: Record<Status, string> = {
  pending: "sem verificação",
  executed: "executada",
  partial: "parcial",
  ignored: "ignorada",
};

const CLASS: Record<Status, string> = {
  pending: "border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700",
  executed: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
  partial: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
  ignored: "border-zinc-200 text-zinc-400 dark:border-zinc-800",
};

// Status de acatamento de uma recomendação: a detecção automática preenche na
// rodada seguinte; aqui o usuário corrige à mão. Trocar o select salva na hora.
export function RecommendationStatusCell({
  id,
  status,
  source,
}: {
  id: string;
  status: Status;
  source: "auto" | "manual";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<Status>(status);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select
        value={local}
        disabled={pending}
        title={source === "manual" ? "marcado por você" : "detectado pela diferença de posições"}
        onChange={(e) => {
          const next = e.target.value as Status;
          setLocal(next);
          startTransition(async () => {
            const result = await setRecommendationStatus(id, next);
            setError(result.error);
            router.refresh();
          });
        }}
        className={`rounded-full border bg-transparent px-2 py-0.5 text-[11px] disabled:opacity-50 ${CLASS[local]}`}
      >
        {(Object.keys(LABEL) as Status[]).map((s) => (
          <option key={s} value={s}>
            {LABEL[s]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </span>
  );
}
