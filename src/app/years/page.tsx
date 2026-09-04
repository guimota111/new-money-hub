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
  amount: number | string;
  received_at: string;
  income_categories: { name: string; slug: string } | null;
}

interface ExpenseRow {
  amount: number | string;
  spent_at: string;
  source: string;
  expense_categories: { name: string; slug: string } | null;
}

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function currentYear(): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
    }).format(new Date()),
  );
}

// mês da fatura: gastos do cartão são pagos no mês seguinte (mesma regra da
// página Meses); o resto conta no próprio mês
function billMonth(spentAt: string, source: string): string {
  const m = spentAt.slice(0, 7);
  if (source !== "pluggy") return m;
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function YearsPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; visao?: string }>;
}) {
  const filters = await searchParams;
  const ano = /^\d{4}$/.test(filters.ano ?? "") ? Number(filters.ano) : currentYear();

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, scope] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    getHouseholdScope(supabase, user.id, filters.visao),
  ]);

  // histórico completo de uma vez — o ano exibido, os meses dele e o gráfico
  // anual saem todos das mesmas duas consultas (paginadas além do teto de
  // 1000 linhas do PostgREST)
  const [incomeData, expenseData] = await Promise.all([
    fetchAllRows((f, t) =>
      supabase
        .from("incomes")
        .select("amount, received_at, income_categories(name, slug)")
        .in("user_id", scope.userIds)
        .order("received_at", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t),
    ),
    fetchAllRows((f, t) =>
      supabase
        .from("expenses")
        .select("amount, spent_at, source, expense_categories(name, slug)")
        .in("user_id", scope.userIds)
        .order("spent_at", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t),
    ),
  ]);

  const incomes = (incomeData ?? []) as unknown as IncomeRow[];
  const expenses = (expenseData ?? []) as unknown as ExpenseRow[];

  // ---- totais e pizzas do ano exibido -------------------------------------
  const anoStr = String(ano);
  const yearIncomes = incomes.filter((i) => i.received_at.slice(0, 4) === anoStr);
  const yearExpenses = expenses.filter(
    (e) => billMonth(e.spent_at, e.source).slice(0, 4) === anoStr,
  );

  const totalIn = yearIncomes.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalOut = yearExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const saldo = totalIn - totalOut;
  const barMax = Math.max(totalIn, totalOut, 1);

  const incomeByCat = new Map<string, { name: string; value: number }>();
  for (const income of yearIncomes) {
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
  for (const expense of yearExpenses) {
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

  // ---- meses do ano exibido ----------------------------------------------
  const months = Array.from({ length: 12 }, (_, i) => ({
    mes: `${anoStr}-${String(i + 1).padStart(2, "0")}`,
    in: 0,
    out: 0,
  }));
  for (const income of yearIncomes) {
    months[Number(income.received_at.slice(5, 7)) - 1].in += Number(income.amount);
  }
  for (const expense of yearExpenses) {
    months[Number(billMonth(expense.spent_at, expense.source).slice(5, 7)) - 1].out +=
      Number(expense.amount);
  }
  const monthMax = Math.max(...months.map((m) => Math.max(m.in, m.out)), 1);

  // ---- histórico anual (todos os anos com dado) ---------------------------
  const yearsMap = new Map<string, { in: number; out: number }>();
  for (const income of incomes) {
    const y = income.received_at.slice(0, 4);
    const entry = yearsMap.get(y) ?? { in: 0, out: 0 };
    entry.in += Number(income.amount);
    yearsMap.set(y, entry);
  }
  for (const expense of expenses) {
    const y = billMonth(expense.spent_at, expense.source).slice(0, 4);
    const entry = yearsMap.get(y) ?? { in: 0, out: 0 };
    entry.out += Number(expense.amount);
    yearsMap.set(y, entry);
  }
  const history = [...yearsMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([y, v]) => ({ ano: y, ...v }));
  const histMax = Math.max(...history.map((h) => Math.max(h.in, h.out)), 1);

  const yearHref = (target: number | string) => {
    const params = new URLSearchParams({ ano: String(target) });
    if (scope.casal) params.set("visao", "casal");
    return `/years?${params.toString()}`;
  };
  const monthHref = (mes: string) => {
    const params = new URLSearchParams({ mes });
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
              {ano}
              {scope.casal && <span className="text-zinc-500"> · casal</span>}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Entradas e saídas do ano — as faturas do cartão contam no mês em
              que são pagas.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {scope.canToggle && (
              <ViewToggle basePath="/years" params={filters} casal={scope.casal} />
            )}
            <div className="flex items-center gap-1 rounded-lg border border-zinc-300 bg-white p-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-950">
              <Link
                href={yearHref(ano - 1)}
                className="rounded-md px-2.5 py-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
                aria-label="Ano anterior"
              >
                ←
              </Link>
              <form method="get" className="contents">
                {scope.casal && <input type="hidden" name="visao" value="casal" />}
                <input
                  type="number"
                  name="ano"
                  min={2000}
                  max={2100}
                  defaultValue={ano}
                  className="w-20 rounded-md bg-transparent px-1 py-1 text-center text-zinc-700 dark:text-zinc-300"
                />
                <button type="submit" className="rounded-md px-2.5 py-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50">
                  Ir
                </button>
              </form>
              <Link
                href={yearHref(ano + 1)}
                className="rounded-md px-2.5 py-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
                aria-label="Próximo ano"
              >
                →
              </Link>
            </div>
          </div>
        </div>

        {/* entradas x saídas do ano */}
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
              <p className="text-sm text-zinc-500">Saldo do ano</p>
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
          <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Fonte das receitas
            </h2>
            <CategoryPie totalLabel="Entradas" slices={incomeSlices} />
          </section>
          <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Despesas por grupo
            </h2>
            <CategoryPie totalLabel="Saídas" slices={expenseSlices} />
          </section>
        </div>

        {/* mês a mês do ano exibido */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Meses de {ano}
          </h2>
          <div className="space-y-3">
            {months.map((m, i) => {
              const net = m.in - m.out;
              return (
                <div key={m.mes} className="flex items-center gap-3">
                  <Link
                    href={monthHref(m.mes)}
                    className="w-24 shrink-0 text-sm text-zinc-500 underline-offset-2 hover:underline"
                  >
                    {MONTHS_PT[i]}
                  </Link>
                  <div className="flex-1 space-y-1">
                    <div className="h-3.5 overflow-hidden rounded-sm bg-zinc-100 dark:bg-zinc-900">
                      <div
                        className="h-full rounded-sm bg-emerald-600 dark:bg-emerald-500"
                        style={{ width: `${(m.in / monthMax) * 100}%` }}
                        title={`Entradas: ${formatBRL(m.in)}`}
                      />
                    </div>
                    <div className="h-3.5 overflow-hidden rounded-sm bg-zinc-100 dark:bg-zinc-900">
                      <div
                        className="h-full rounded-sm bg-red-600 dark:bg-red-500"
                        style={{ width: `${(m.out / monthMax) * 100}%` }}
                        title={`Saídas: ${formatBRL(m.out)}`}
                      />
                    </div>
                  </div>
                  <div className="w-40 shrink-0 text-right text-xs">
                    <div className="text-emerald-700 dark:text-emerald-400">{formatBRL(m.in)}</div>
                    <div className="text-red-700 dark:text-red-400">{formatBRL(m.out)}</div>
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

        {/* histórico de todos os anos */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Histórico anual
          </h2>
          <div className="space-y-3">
            {history.map((h) => {
              const net = h.in - h.out;
              return (
                <div key={h.ano} className="flex items-center gap-3">
                  <Link
                    href={yearHref(h.ano)}
                    className={`w-24 shrink-0 text-sm underline-offset-2 hover:underline ${
                      h.ano === anoStr
                        ? "font-semibold text-zinc-950 dark:text-zinc-50"
                        : "text-zinc-500"
                    }`}
                  >
                    {h.ano}
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
            {history.length === 0 && (
              <p className="text-sm text-zinc-500">Nenhum lançamento registrado ainda.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
