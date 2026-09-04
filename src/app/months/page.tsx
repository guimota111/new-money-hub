import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { ViewToggle } from "@/components/view-toggle";
import { CategoryPie } from "@/components/charts/pie-chart";
import { EXPENSE_COLOR, INCOME_COLOR, colorForSlug, slotIndex } from "@/lib/chart-colors";
import { formatBRL } from "@/lib/format";
import { getHouseholdScope } from "@/lib/household";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

interface IncomeRow {
  id: string;
  user_id: string;
  amount: number | string;
  description: string | null;
  received_at: string;
  income_categories: { name: string; slug: string } | null;
  assets: { name: string } | null;
}

interface ExpenseRow {
  id: string;
  user_id: string;
  amount: number | string;
  description: string | null;
  spent_at: string;
  source: string;
  expense_categories: { name: string; slug: string } | null;
}

// mês corrente no fuso do Brasil, como "YYYY-MM"
function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function shiftMonth(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(mes: string): { start: string; end: string } {
  const [y, m] = mes.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${mes}-01`, end: `${mes}-${String(lastDay).padStart(2, "0")}` };
}

function monthLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default async function MonthsPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; visao?: string }>;
}) {
  const filters = await searchParams;
  const mes = /^\d{4}-\d{2}$/.test(filters.mes ?? "") ? filters.mes! : currentMonth();
  const prevMes = shiftMonth(mes, -1);
  const { start, end } = monthRange(mes);
  const prev = monthRange(prevMes);

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, scope] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    getHouseholdScope(supabase, user.id, filters.visao),
  ]);

  // histórico: últimos 12 meses até o mês atual (independente do mês exibido)
  const histLast = currentMonth();
  const histFirst = shiftMonth(histLast, -11);
  const histRange = { start: monthRange(histFirst).start, end: monthRange(histLast).end };
  // cartão do 1º mês do histórico vem dos gastos do mês anterior a ele
  const histCardStart = monthRange(shiftMonth(histFirst, -1)).start;

  // entradas do mês + saídas: gastos manuais do mês e fatura do cartão, que é
  // composta pelos gastos do mês anterior (pagos neste mês). Tudo paginado
  // além do teto de 1000 linhas do PostgREST.
  const [incomeData, manualData, cardData, histIncomeData, histExpenseData] =
    await Promise.all([
      fetchAllRows((f, t) =>
        supabase
          .from("incomes")
          .select(
            "id, user_id, amount, description, received_at, income_categories(name, slug), assets(name)",
          )
          .in("user_id", scope.userIds)
          .gte("received_at", start)
          .lte("received_at", end)
          .order("received_at", { ascending: false })
          .order("id", { ascending: false })
          .range(f, t),
      ),
      fetchAllRows((f, t) =>
        supabase
          .from("expenses")
          .select("id, user_id, amount, description, spent_at, source, expense_categories(name, slug)")
          .in("user_id", scope.userIds)
          .neq("source", "pluggy")
          .gte("spent_at", start)
          .lte("spent_at", end)
          .order("spent_at", { ascending: false })
          .order("id", { ascending: false })
          .range(f, t),
      ),
      fetchAllRows((f, t) =>
        supabase
          .from("expenses")
          .select("id, user_id, amount, description, spent_at, source, expense_categories(name, slug)")
          .in("user_id", scope.userIds)
          .eq("source", "pluggy")
          .gte("spent_at", prev.start)
          .lte("spent_at", prev.end)
          .order("spent_at", { ascending: false })
          .order("id", { ascending: false })
          .range(f, t),
      ),
      fetchAllRows((f, t) =>
        supabase
          .from("incomes")
          .select("id, amount, received_at")
          .in("user_id", scope.userIds)
          .gte("received_at", histRange.start)
          .lte("received_at", histRange.end)
          .order("id", { ascending: true })
          .range(f, t),
      ),
      fetchAllRows((f, t) =>
        supabase
          .from("expenses")
          .select("id, amount, spent_at, source")
          .in("user_id", scope.userIds)
          .gte("spent_at", histCardStart)
          .lte("spent_at", histRange.end)
          .order("id", { ascending: true })
          .range(f, t),
      ),
    ]);

  const incomes = (incomeData ?? []) as unknown as IncomeRow[];
  const expenses = [
    ...((manualData ?? []) as unknown as ExpenseRow[]),
    ...((cardData ?? []) as unknown as ExpenseRow[]),
  ];

  const totalIn = incomes.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalOut = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const saldo = totalIn - totalOut;
  const barMax = Math.max(totalIn, totalOut, 1);

  const incomeByCat = new Map<string, { name: string; value: number }>();
  for (const income of incomes) {
    const cat = income.income_categories;
    if (!cat) continue;
    const entry = incomeByCat.get(cat.slug) ?? { name: cat.name, value: 0 };
    entry.value += Number(income.amount);
    incomeByCat.set(cat.slug, entry);
  }
  const incomeSlices = [...incomeByCat.entries()]
    .map(([slug, e]) => ({
      key: slug,
      name: e.name,
      value: e.value,
      color: INCOME_COLOR[slug] ?? colorForSlug(slug),
    }))
    .sort((a, b) => slotIndex(a.color) - slotIndex(b.color));

  const expenseByCat = new Map<string, { name: string; value: number }>();
  for (const expense of expenses) {
    const cat = expense.expense_categories;
    if (!cat) continue;
    const entry = expenseByCat.get(cat.slug) ?? { name: cat.name, value: 0 };
    entry.value += Number(expense.amount);
    expenseByCat.set(cat.slug, entry);
  }
  const expenseSlices = [...expenseByCat.entries()]
    .map(([slug, e]) => ({
      key: slug,
      name: e.name,
      value: e.value,
      color: EXPENSE_COLOR[slug] ?? colorForSlug(slug),
    }))
    .sort((a, b) => slotIndex(a.color) - slotIndex(b.color));

  // agrega o histórico por mês, com a fatura do cartão deslocada um mês
  const history = Array.from({ length: 12 }, (_, i) => shiftMonth(histLast, i - 11)).map(
    (m) => ({ mes: m, in: 0, out: 0 }),
  );
  const histIndex = new Map(history.map((h, i) => [h.mes, i]));
  for (const row of histIncomeData ?? []) {
    const idx = histIndex.get(String(row.received_at).slice(0, 7));
    if (idx != null) history[idx].in += Number(row.amount);
  }
  for (const row of histExpenseData ?? []) {
    const spentMonth = String(row.spent_at).slice(0, 7);
    const billMonth = row.source === "pluggy" ? shiftMonth(spentMonth, 1) : spentMonth;
    const idx = histIndex.get(billMonth);
    if (idx != null) history[idx].out += Number(row.amount);
  }
  const histMax = Math.max(...history.map((h) => Math.max(h.in, h.out)), 1);

  const monthHref = (target: string) => {
    const params = new URLSearchParams({ mes: target });
    if (scope.casal) params.set("visao", "casal");
    return `/months?${params.toString()}`;
  };

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} view={scope.casal ? "casal" : undefined} />
      <main className="w-full flex-1 space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
              {monthLabel(mes)}
              {scope.casal && <span className="text-zinc-500"> · casal</span>}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Entradas e saídas do mês — a fatura do cartão traz os gastos de{" "}
              {monthLabel(prevMes).toLowerCase()}.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {scope.canToggle && (
              <ViewToggle basePath="/months" params={filters} casal={scope.casal} />
            )}
            <div className="flex items-center gap-1 rounded-lg border border-zinc-300 bg-white p-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-950">
              <Link
                href={monthHref(prevMes)}
                className="rounded-md px-2.5 py-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
                aria-label="Mês anterior"
              >
                ←
              </Link>
              <form method="get" className="contents">
                {scope.casal && <input type="hidden" name="visao" value="casal" />}
                <input
                  type="month"
                  name="mes"
                  defaultValue={mes}
                  className="rounded-md bg-transparent px-1 py-1 text-zinc-700 dark:text-zinc-300"
                />
                <button type="submit" className="rounded-md px-2.5 py-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50">
                  Ir
                </button>
              </form>
              <Link
                href={monthHref(shiftMonth(mes, 1))}
                className="rounded-md px-2.5 py-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
                aria-label="Próximo mês"
              >
                →
              </Link>
            </div>
          </div>
        </div>

        {/* entradas x saídas */}
        <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-zinc-500">Entradas</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
                {formatBRL(totalIn)}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Saídas</p>
              <p className="mt-1 text-2xl font-semibold text-red-700 dark:text-red-400">
                {formatBRL(totalOut)}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Saldo do mês</p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  saldo >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-700 dark:text-red-400"
                }`}
              >
                {saldo >= 0 ? "+" : ""}
                {formatBRL(saldo)}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
                <div
                  className="h-full rounded-md bg-emerald-600 dark:bg-emerald-500"
                  style={{ width: `${(totalIn / barMax) * 100}%` }}
                />
              </div>
              <span className="w-28 text-right text-sm text-zinc-500">entradas</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
                <div
                  className="h-full rounded-md bg-red-600 dark:bg-red-500"
                  style={{ width: `${(totalOut / barMax) * 100}%` }}
                />
              </div>
              <span className="w-28 text-right text-sm text-zinc-500">saídas</span>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* receitas */}
          <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Fonte das receitas
            </h2>
            <CategoryPie totalLabel="Entradas" slices={incomeSlices} />
            <details className="group mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <summary className="cursor-pointer select-none text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 [&::-webkit-details-marker]:hidden">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
                Ver receitas ({incomes.length})
              </summary>
              <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
                {incomes.map((income) => (
                  <li key={income.id} className="flex items-center gap-3 py-2">
                    <span className="w-20 shrink-0 text-zinc-500">
                      {formatDate(income.received_at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-zinc-950 dark:text-zinc-50">
                      {income.description ?? income.assets?.name ?? income.income_categories?.name ?? "—"}
                      {scope.casal && (
                        <span className="text-zinc-500"> · {scope.nameOf(income.user_id)}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-medium text-emerald-700 dark:text-emerald-400">
                      {formatBRL(Number(income.amount))}
                    </span>
                  </li>
                ))}
                {incomes.length === 0 && (
                  <li className="py-2 text-zinc-500">Nenhuma receita neste mês.</li>
                )}
              </ul>
            </details>
          </section>

          {/* despesas */}
          <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Despesas por grupo
            </h2>
            <CategoryPie totalLabel="Saídas" slices={expenseSlices} />
            <details className="group mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <summary className="cursor-pointer select-none text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 [&::-webkit-details-marker]:hidden">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
                Ver despesas ({expenses.length})
              </summary>
              <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
                {expenses.map((expense) => (
                  <li key={expense.id} className="flex items-center gap-3 py-2">
                    <span className="w-20 shrink-0 text-zinc-500">
                      {formatDate(expense.spent_at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-zinc-950 dark:text-zinc-50">
                      {expense.description ?? "—"}
                      <span className="text-zinc-500">
                        {expense.source === "pluggy" ? " · cartão" : ""}
                        {scope.casal ? ` · ${scope.nameOf(expense.user_id)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-zinc-500">
                      {expense.expense_categories?.name ?? "—"}
                    </span>
                    <span className="shrink-0 font-medium text-red-700 dark:text-red-400">
                      {formatBRL(Number(expense.amount))}
                    </span>
                  </li>
                ))}
                {expenses.length === 0 && (
                  <li className="py-2 text-zinc-500">Nenhuma despesa neste mês.</li>
                )}
              </ul>
            </details>
          </section>
        </div>

        {/* histórico dos últimos 12 meses */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Últimos 12 meses
          </h2>
          <div className="space-y-3">
            {history.map((h) => {
              const net = h.in - h.out;
              return (
                <div key={h.mes} className="flex items-center gap-3">
                  <Link
                    href={monthHref(h.mes)}
                    className={`w-24 shrink-0 text-sm capitalize underline-offset-2 hover:underline ${
                      h.mes === mes
                        ? "font-semibold text-zinc-950 dark:text-zinc-50"
                        : "text-zinc-500"
                    }`}
                  >
                    {monthLabel(h.mes).replace(" de ", "/").slice(0, 8)}
                  </Link>
                  <div className="flex-1 space-y-1">
                    <div className="h-3.5 overflow-hidden rounded-sm bg-zinc-100 dark:bg-zinc-900">
                      <div
                        className="h-full rounded-sm bg-emerald-600 dark:bg-emerald-500"
                        style={{ width: `${(h.in / histMax) * 100}%` }}
                        title={`Entradas: ${formatBRL(h.in)}`}
                      />
                    </div>
                    <div className="h-3.5 overflow-hidden rounded-sm bg-zinc-100 dark:bg-zinc-900">
                      <div
                        className="h-full rounded-sm bg-red-600 dark:bg-red-500"
                        style={{ width: `${(h.out / histMax) * 100}%` }}
                        title={`Saídas: ${formatBRL(h.out)}`}
                      />
                    </div>
                  </div>
                  <div className="w-40 shrink-0 text-right text-xs">
                    <div className="text-emerald-700 dark:text-emerald-400">{formatBRL(h.in)}</div>
                    <div className="text-red-700 dark:text-red-400">{formatBRL(h.out)}</div>
                  </div>
                  <div
                    className={`w-24 shrink-0 text-right text-sm font-medium ${
                      net >= 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-red-700 dark:text-red-400"
                    }`}
                  >
                    {net >= 0 ? "+" : ""}
                    {formatBRL(net)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
