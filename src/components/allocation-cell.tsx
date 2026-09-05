"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAssetAllocation } from "@/app/consultor/actions";

const EXCLUDED = "__fora__";

// Célula de classificação do ativo no consultor: trocar o select ou o
// checkbox salva na hora (mesmo padrão da CategoryCell das despesas).
// O pai remonta o componente via key quando os dados do servidor mudam.
export function AllocationCell({
  assetId,
  categoryId,
  excluded,
  reserve,
  categories,
}: {
  assetId: string;
  categoryId: string | null;
  excluded: boolean;
  reserve: boolean;
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState({ categoryId, excluded, reserve });

  function save(next: { categoryId: string | null; excluded: boolean; reserve: boolean }) {
    setLocal(next);
    startTransition(async () => {
      const result = await setAssetAllocation(assetId, next);
      setError(result.error);
      router.refresh();
    });
  }

  const value = local.excluded ? EXCLUDED : (local.categoryId ?? "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          if (v === EXCLUDED) save({ categoryId: null, excluded: true, reserve: false });
          else save({ categoryId: v || null, excluded: false, reserve: v ? local.reserve : false });
        }}
        className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
      >
        <option value="">— não classificado —</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value={EXCLUDED}>Fora da carteira</option>
      </select>
      {!local.excluded && (
        <label
          title="Faz parte da reserva de emergência (conta no valor da reserva e não conta no teto de ativos)"
          className="flex cursor-pointer items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          <input
            type="checkbox"
            checked={local.reserve}
            disabled={pending}
            onChange={(e) =>
              save({ categoryId: local.categoryId, excluded: false, reserve: e.target.checked })
            }
            className="h-3.5 w-3.5"
          />
          reserva
        </label>
      )}
      {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </div>
  );
}
