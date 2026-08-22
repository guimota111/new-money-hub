import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { CategoryPie } from "@/components/charts/pie-chart";
import { ViewToggle } from "@/components/view-toggle";
import { ManualEntryForm } from "@/components/manual-entry-form";
import { EXPENSE_COLOR, slotIndex } from "@/lib/chart-colors";
import { formatBRL } from "@/lib/format";
import { getHouseholdScope } from "@/lib/household";
import { createExpense, deleteExpense } from "./actions";

const PAGE_SIZE = 50;

interface ExpenseRow {
  id: string;
  user_id: string;
  amount: number | string;
  description: string | null;
  spent_at: string;
  source: string;
  expense_categories: { name: string; slug: string } | null;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    categoria?: string;
    busca?: string;
    de?: string;
    ate?: string;
    pagina?: string;
    visao?: string;
  }>;
}) {
  const filters = await searchParams;
  const page = Math.max(1, Number(filters.pagina) || 1);

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, scope, { data: categories }] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    getHouseholdScope(supabase, user.id, filters.visao),
    supabase.from("expense_categories").select("id, name, slug").order("name"),
  ]);

  let query = supabase
    .from("expenses")
    .select("id, user_id, amount, description, spent_at, source, expense_categories(name, slug)")
    .in("user_id", scope.userIds);

  const selectedCategory = (categories ?? []).find((c) => c.slug === filters.categoria);
  if (selectedCategory) query = query.eq("expense_category_id", selectedCategory.id);
  if (filters.busca) query = query.ilike("description", `%${filters.busca}%`);
  if (filters.de) query = query.gte("spent_at", filters.de);
  if (filters.ate) query = query.lte("spent_at", filters.ate);

  const { data } = await query.order("spent_at", { ascending: false }).limit(5000);

  const all = (data ?? []) as unknown as ExpenseRow[];
  const totalAmount = all.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const byCategory = new Map<string, { name: string; value: number }>();
  for (const expense of all) {
    const cat = expense.expense_categories;
    if (!cat) continue;
    const entry = byCategory.get(cat.slug) ?? { name: cat.name, value: 0 };
    entry.value += Number(expense.amount);
    byCategory.set(cat.slug, entry);
  }
  const slices = [...byCategory.entries()]
    .map(([slug, e]) => ({
      key: slug,
      name: e.name,
      value: e.value,
      color: EXPENSE_COLOR[slug] ?? "var(--chart-muted)",
    }))
    .sort((a, b) => slotIndex(a.color) - slotIndex(b.color));

  const baseParams = new URLSearchParams();
  if (filters.categoria) baseParams.set("categoria", filters.categoria);
  if (filters.busca) baseParams.set("busca", filters.busca);
  if (filters.de) baseParams.set("de", filters.de);
  if (filters.ate) baseParams.set("ate", filters.ate);
  if (scope.casal) baseParams.set("visao", "casal");
  const pageHref = (p: number) => {
    const params = new URLSearchParams(baseParams);
    params.set("pagina", String(p));
    return `/expenses?${params.toString()}`;
  };

  const inputClass =
    "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} view={scope.casal ? "casal" : undefined} />
      <main className="w-full flex-1 space-y-6 px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
              {scope.casal ? "Despesas do casal" : "Despesas"}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {all.length} lançamento{all.length === 1 ? "" : "s"} · Total:{" "}
              <span className="font-semibold text-red-700 dark:text-red-400">
                {formatBRL(totalAmount)}
              </span>
            </p>
          </div>
          {scope.canToggle && (
            <ViewToggle basePath="/expenses" params={filters} casal={scope.casal} />
          )}
        </div>

        <ManualEntryForm
          action={createExpense}
          categories={categories ?? []}
          kind="despesa"
          defaultDate={new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo",
          }).format(new Date())}
        />

        <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          {scope.casal && <input type="hidden" name="visao" value="casal" />}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">Categoria</label>
            <select name="categoria" defaultValue={filters.categoria ?? ""} className={inputClass}>
              <option value="">Todas</option>
              {(categories ?? []).map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">Buscar (descrição)</label>
            <input
              name="busca"
              placeholder="Ex: iFood"
              defaultValue={filters.busca ?? ""}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">De</label>
            <input name="de" type="date" defaultValue={filters.de ?? ""} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">Até</label>
            <input name="ate" type="date" defaultValue={filters.ate ?? ""} className={inputClass} />
          </div>
          <button
            type="submit"
            className="rounded-md bg-zinc-950 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Filtrar
          </button>
          <Link
            href={scope.casal ? "/expenses?visao=casal" : "/expenses"}
            className="text-sm text-zinc-500 underline"
          >
            Limpar
          </Link>
        </form>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Por categoria (filtro atual)
          </h2>
          <CategoryPie totalLabel="Total" slices={slices} />
        </section>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Descrição</th>
                <th className="px-4 py-3 font-medium">Categoria</th>
                <th className="px-4 py-3 font-medium">Origem</th>
                {scope.casal && <th className="px-4 py-3 font-medium">Quem</th>}
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={scope.casal ? 7 : 6} className="px-4 py-8 text-center text-zinc-500">
                    Nenhuma despesa encontrada.
                  </td>
                </tr>
              )}
              {rows.map((expense) => (
                <tr key={expense.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="whitespace-nowrap px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                    {formatDate(expense.spent_at)}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-950 dark:text-zinc-50">
                    {expense.description ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                    {expense.expense_categories?.name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {expense.source === "pluggy" ? "Cartão Nubank" : "Manual"}
                  </td>
                  {scope.casal && (
                    <td className="px-4 py-2.5 text-zinc-500">{scope.nameOf(expense.user_id)}</td>
                  )}
                  <td className="px-4 py-2.5 text-right font-medium text-red-700 dark:text-red-400">
                    {formatBRL(Number(expense.amount))}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    {expense.source === "manual" && expense.user_id === user.id && (
                      <form action={deleteExpense.bind(null, expense.id)}>
                        <button
                          type="submit"
                          title="Excluir lançamento manual"
                          className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          ×
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-3">
              {page > 1 && (
                <Link href={pageHref(page - 1)} className="underline hover:text-zinc-950 dark:hover:text-zinc-50">
                  ← Anterior
                </Link>
              )}
              {page < totalPages && (
                <Link href={pageHref(page + 1)} className="underline hover:text-zinc-950 dark:hover:text-zinc-50">
                  Próxima →
                </Link>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
