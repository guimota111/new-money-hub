import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/header";
import { DonutChart } from "@/components/charts/donut-chart";
import { INCOME_COLOR, slotIndex } from "@/lib/chart-colors";
import { formatBRL } from "@/lib/format";

const PAGE_SIZE = 50;

interface IncomeRow {
  id: string;
  amount: number | string;
  description: string | null;
  received_at: string;
  income_categories: { name: string; slug: string } | null;
  assets: { name: string } | null;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default async function IncomesPage({
  searchParams,
}: {
  searchParams: Promise<{
    categoria?: string;
    busca?: string;
    de?: string;
    ate?: string;
    pagina?: string;
  }>;
}) {
  const filters = await searchParams;
  const page = Math.max(1, Number(filters.pagina) || 1);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  const { data: categories } = await supabase
    .from("income_categories")
    .select("id, name, slug")
    .order("name");

  let query = supabase
    .from("incomes")
    .select(
      "id, amount, description, received_at, income_categories(name, slug), assets(name)",
    )
    .eq("user_id", user.id);

  const selectedCategory = (categories ?? []).find((c) => c.slug === filters.categoria);
  if (selectedCategory) query = query.eq("income_category_id", selectedCategory.id);
  if (filters.busca) query = query.ilike("description", `%${filters.busca}%`);
  if (filters.de) query = query.gte("received_at", filters.de);
  if (filters.ate) query = query.lte("received_at", filters.ate);

  // busca tudo filtrado (cap 5000) para somar; paginação em memória
  const { data } = await query
    .order("received_at", { ascending: false })
    .limit(5000);

  const all = (data ?? []) as unknown as IncomeRow[];
  const totalAmount = all.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const byCategory = new Map<string, { name: string; value: number }>();
  for (const income of all) {
    const cat = income.income_categories;
    if (!cat) continue;
    const entry = byCategory.get(cat.slug) ?? { name: cat.name, value: 0 };
    entry.value += Number(income.amount);
    byCategory.set(cat.slug, entry);
  }
  const slices = [...byCategory.entries()]
    .map(([slug, e]) => ({
      key: slug,
      name: e.name,
      value: e.value,
      color: INCOME_COLOR[slug] ?? "var(--chart-muted)",
    }))
    .sort((a, b) => slotIndex(a.color) - slotIndex(b.color));

  const baseParams = new URLSearchParams();
  if (filters.categoria) baseParams.set("categoria", filters.categoria);
  if (filters.busca) baseParams.set("busca", filters.busca);
  if (filters.de) baseParams.set("de", filters.de);
  if (filters.ate) baseParams.set("ate", filters.ate);
  const pageHref = (p: number) => {
    const params = new URLSearchParams(baseParams);
    params.set("pagina", String(p));
    return `/incomes?${params.toString()}`;
  };

  const inputClass =
    "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full flex-1 space-y-6 px-6 py-10">
        <div>
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            Receitas
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {all.length} lançamento{all.length === 1 ? "" : "s"} · Total:{" "}
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {formatBRL(totalAmount)}
            </span>
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
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
            <label className="block text-xs font-medium text-zinc-500">Buscar (ticker/descrição)</label>
            <input
              name="busca"
              placeholder="Ex: MXRF11"
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
          <Link href="/incomes" className="text-sm text-zinc-500 underline">
            Limpar
          </Link>
        </form>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Por categoria (filtro atual)
          </h2>
          <DonutChart centerLabel="Total" slices={slices} />
        </section>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Descrição</th>
                <th className="px-4 py-3 font-medium">Categoria</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                    Nenhuma receita encontrada.
                  </td>
                </tr>
              )}
              {rows.map((income) => (
                <tr key={income.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="whitespace-nowrap px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                    {formatDate(income.received_at)}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-950 dark:text-zinc-50">
                    {income.description ?? income.assets?.name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                    {income.income_categories?.name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-emerald-700 dark:text-emerald-400">
                    {formatBRL(Number(income.amount))}
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
