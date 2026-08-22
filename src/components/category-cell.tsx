"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateExpenseCategory } from "@/app/expenses/actions";

// Célula de categoria editável: trocar o select salva na hora; com "sempre"
// marcado, cria a regra e recategoriza todo o histórico com a mesma descrição.
export function CategoryCell({
  expenseId,
  currentId,
  currentName,
  categories,
  canEdit,
  hasDescription,
}: {
  expenseId: string;
  currentId: string | null;
  currentName: string | null;
  categories: { id: string; name: string }[];
  canEdit: boolean;
  hasDescription: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [always, setAlways] = useState(false);

  if (!canEdit) return <>{currentName ?? "—"}</>;

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        defaultValue={currentId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value;
          if (!value) return;
          startTransition(async () => {
            await updateExpenseCategory(expenseId, value, always);
            router.refresh();
          });
        }}
        className="rounded border border-transparent bg-transparent py-0.5 pr-1 text-sm text-zinc-700 hover:border-zinc-300 disabled:opacity-50 dark:text-zinc-300 dark:hover:border-zinc-700"
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {hasDescription && (
        <label
          title="Aplicar sempre a despesas com esta descrição (cria regra para importações futuras)"
          className="flex cursor-pointer items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => setAlways(e.target.checked)}
            className="h-3 w-3"
          />
          sempre
        </label>
      )}
    </span>
  );
}
