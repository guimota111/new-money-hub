import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { ViewToggle } from "@/components/view-toggle";
import { formatBRL, formatQuantity } from "@/lib/format";
import { getHouseholdScope } from "@/lib/household";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

const PAGE_SIZE = 50;

interface MovementRow {
  id: string;
  user_id: string;
  direction: "credito" | "debito";
  movement_type: string;
  ticker: string | null;
  institution: string | null;
  quantity: number | string | null;
  unit_price: number | string | null;
  total_value: number | string | null;
  moved_at: string;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ticker?: string;
    tipo?: string;
    direcao?: string;
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

  const [{ data: profile }, scope] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    getHouseholdScope(supabase, user.id, filters.visao),
  ]);

  let query = supabase
    .from("movements")
    .select(
      "id, user_id, direction, movement_type, ticker, institution, quantity, unit_price, total_value, moved_at",
      { count: "exact" },
    )
    .in("user_id", scope.userIds);

  if (filters.ticker) query = query.eq("ticker", filters.ticker);
  if (filters.tipo) query = query.eq("movement_type", filters.tipo);
  if (filters.direcao === "credito" || filters.direcao === "debito") {
    query = query.eq("direction", filters.direcao);
  }
  if (filters.de) query = query.gte("moved_at", filters.de);
  if (filters.ate) query = query.lte("moved_at", filters.ate);

  const from = (page - 1) * PAGE_SIZE;
  // lista filtrada + opções dos selects (tipos e tickers) em paralelo;
  // as opções paginam além do teto de 1000 linhas do PostgREST
  const [{ data, count }, allRows] = await Promise.all([
    query
      .order("moved_at", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    fetchAllRows((f, t) =>
      supabase
        .from("movements")
        .select("movement_type, ticker")
        .in("user_id", scope.userIds)
        .order("id", { ascending: true })
        .range(f, t),
    ),
  ]);
  const types = [...new Set((allRows ?? []).map((r) => r.movement_type))].sort();
  const tickers = [...new Set((allRows ?? []).map((r) => r.ticker).filter(Boolean))].sort() as string[];

  const rows = (data ?? []) as unknown as MovementRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const baseParams = new URLSearchParams();
  if (filters.ticker) baseParams.set("ticker", filters.ticker);
  if (filters.tipo) baseParams.set("tipo", filters.tipo);
  if (filters.direcao) baseParams.set("direcao", filters.direcao);
  if (filters.de) baseParams.set("de", filters.de);
  if (filters.ate) baseParams.set("ate", filters.ate);
  if (scope.casal) baseParams.set("visao", "casal");
  const pageHref = (p: number) => {
    const params = new URLSearchParams(baseParams);
    params.set("pagina", String(p));
    return `/movements?${params.toString()}`;
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
              {scope.casal ? "Movimentações do casal" : "Movimentações"}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {total} registro{total === 1 ? "" : "s"}
              {(filters.ticker || filters.tipo || filters.direcao || filters.de || filters.ate) &&
                " com os filtros aplicados"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {scope.canToggle && (
              <ViewToggle basePath="/movements" params={filters} casal={scope.casal} />
            )}
            <Link
              href="/import"
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Importar extrato B3
            </Link>
          </div>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          {scope.casal && <input type="hidden" name="visao" value="casal" />}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">Ticker</label>
            <select name="ticker" defaultValue={filters.ticker ?? ""} className={inputClass}>
              <option value="">Todos</option>
              {tickers.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">Tipo</label>
            <select name="tipo" defaultValue={filters.tipo ?? ""} className={inputClass}>
              <option value="">Todos</option>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">Entrada/Saída</label>
            <select name="direcao" defaultValue={filters.direcao ?? ""} className={inputClass}>
              <option value="">Todas</option>
              <option value="credito">Crédito</option>
              <option value="debito">Débito</option>
            </select>
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
            href={scope.casal ? "/movements?visao=casal" : "/movements"}
            className="text-sm text-zinc-500 underline"
          >
            Limpar
          </Link>
        </form>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Ticker</th>
                {scope.casal && <th className="px-4 py-3 font-medium">Quem</th>}
                <th className="px-4 py-3 text-right font-medium">Quantidade</th>
                <th className="px-4 py-3 text-right font-medium">Preço unit.</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={scope.casal ? 7 : 6} className="px-4 py-8 text-center text-zinc-500">
                    Nenhuma movimentação encontrada.
                  </td>
                </tr>
              )}
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="whitespace-nowrap px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                    {formatDate(m.moved_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        m.direction === "credito"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-red-700 dark:text-red-400"
                      }
                    >
                      {m.direction === "credito" ? "↑" : "↓"}
                    </span>{" "}
                    <span className="text-zinc-700 dark:text-zinc-300">{m.movement_type}</span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-zinc-950 dark:text-zinc-50">
                    {m.ticker ?? "—"}
                  </td>
                  {scope.casal && (
                    <td className="px-4 py-2.5 text-zinc-500">{scope.nameOf(m.user_id)}</td>
                  )}
                  <td className="px-4 py-2.5 text-right text-zinc-700 dark:text-zinc-300">
                    {m.quantity != null ? formatQuantity(Number(m.quantity)) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-700 dark:text-zinc-300">
                    {m.unit_price != null ? formatBRL(Number(m.unit_price)) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-zinc-950 dark:text-zinc-50">
                    {m.total_value != null ? formatBRL(Number(m.total_value)) : "—"}
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
