import { SubmitButton } from "@/components/submit-button";

// Form de lançamento manual (receita ou despesa), colapsado por padrão.
// Server component: o insert acontece na server action recebida via prop.
export function ManualEntryForm({
  action,
  categories,
  kind,
  defaultDate,
}: {
  action: (formData: FormData) => Promise<void>;
  categories: { id: string; name: string }[];
  kind: "receita" | "despesa";
  defaultDate: string;
}) {
  const inputClass =
    "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  return (
    <details className="group rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50 [&::-webkit-details-marker]:hidden">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
        Adicionar {kind}
      </summary>
      <form action={action} className="flex flex-wrap items-end gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-500">Valor (R$)</label>
          <input
            name="valor"
            required
            inputMode="decimal"
            placeholder="1.234,56"
            className={`${inputClass} w-28`}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-500">Descrição</label>
          <input
            name="descricao"
            placeholder={kind === "receita" ? "Ex: Salário" : "Ex: Feira"}
            className={`${inputClass} w-48`}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-500">Categoria</label>
          <select name="categoria" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Escolha...
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-500">Data</label>
          <input name="data" type="date" required defaultValue={defaultDate} className={inputClass} />
        </div>
        <SubmitButton
          pendingText="Salvando..."
          className="rounded-md bg-zinc-950 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Salvar {kind}
        </SubmitButton>
      </form>
    </details>
  );
}
