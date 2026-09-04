import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { AllocationBar } from "@/components/charts/allocation-bar";
import { EvolutionChart, type EvolutionPoint } from "@/components/charts/evolution-chart";
import {
  IncomeChart,
  type IncomeCategoryInfo,
  type IncomeEntry,
} from "@/components/charts/income-chart";
import { ViewToggle } from "@/components/view-toggle";
import { formatBRL } from "@/lib/format";
import { getHouseholdScope } from "@/lib/household";
import { assetCurrentValue, CLASS_ORDER, type AssetRow } from "@/lib/portfolio";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

const MONTHS_SHOWN = 12;

// renda passiva = renda de investimento; "outros" ficou ambíguo desde que
// Pix recebidos entram como receita, então a lista é explícita
const PASSIVE_SLUGS = [
  "dividendos",
  "jcp",
  "rendimento_fii",
  "rendimento_renda_fixa",
];

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative";
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-700 dark:text-red-400"
        : "text-zinc-950 dark:text-zinc-50";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ visao?: string }>;
}) {
  const { visao } = await searchParams;

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, scope] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    getHouseholdScope(supabase, user.id, visao),
  ]);
  if (!scope.hasHousehold) redirect("/onboarding");

  const since = new Date();
  since.setMonth(since.getMonth() - MONTHS_SHOWN);
  const sinceIso = since.toISOString().slice(0, 10);

  // mês corrente (fuso BR) para o card de saldo do mês; a fatura do cartão é
  // composta pelos gastos do mês anterior, como na página Meses
  const mesAtual = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [anoM, mesM] = mesAtual.split("-").map(Number);
  const mesStart = `${mesAtual}-01`;
  const mesEnd = `${mesAtual}-${String(new Date(Date.UTC(anoM, mesM, 0)).getUTCDate()).padStart(2, "0")}`;
  const prevRef = new Date(Date.UTC(anoM, mesM - 2, 1));
  const prevYm = `${prevRef.getUTCFullYear()}-${String(prevRef.getUTCMonth() + 1).padStart(2, "0")}`;
  const prevStart = `${prevYm}-01`;
  const prevEnd = `${prevYm}-${String(new Date(Date.UTC(prevRef.getUTCFullYear(), prevRef.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}`;

  // as três consultas são independentes — uma ida ao Supabase em paralelo;
  // snapshots e incomes paginam além do teto de 1000 linhas do PostgREST
  const [{ data: assetData }, snapshotData, incomeData, mesIncomes, mesManual, mesCard] =
    await Promise.all([
    supabase
      .from("assets")
      .select(
        "id, name, quantity, average_price, purchase_date, metadata, asset_classes(name, slug), market_instruments(ticker, current_price, current_price_updated_at)",
      )
      .in("user_id", scope.userIds),
    fetchAllRows((from, to) =>
      supabase
        .from("asset_snapshots")
        .select("snapshot_date, total_value, assets!inner(user_id)")
        .in("assets.user_id", scope.userIds)
        .order("snapshot_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("incomes")
        .select("amount, received_at, income_categories!inner(name, slug)")
        .in("user_id", scope.userIds)
        .in("income_categories.slug", PASSIVE_SLUGS)
        .order("received_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("incomes")
        .select("id, amount")
        .in("user_id", scope.userIds)
        .gte("received_at", mesStart)
        .lte("received_at", mesEnd)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("expenses")
        .select("id, amount")
        .in("user_id", scope.userIds)
        .neq("source", "pluggy")
        .gte("spent_at", mesStart)
        .lte("spent_at", mesEnd)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("expenses")
        .select("id, amount")
        .in("user_id", scope.userIds)
        .eq("source", "pluggy")
        .gte("spent_at", prevStart)
        .lte("spent_at", prevEnd)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  // ---- ativos + alocação --------------------------------------------------
  const assets = (assetData ?? []) as unknown as AssetRow[];
  const totalValue = assets.reduce((sum, a) => sum + assetCurrentValue(a), 0);

  const slices = CLASS_ORDER.map((slug) => {
    const classAssets = assets.filter((a) => a.asset_classes?.slug === slug);
    return {
      slug,
      name: classAssets[0]?.asset_classes?.name ?? slug,
      value: classAssets.reduce((sum, a) => sum + assetCurrentValue(a), 0),
    };
  });

  // ---- evolução (snapshots somados por dia) -------------------------------
  const byDate = new Map<string, number>();
  for (const s of snapshotData ?? []) {
    byDate.set(s.snapshot_date, (byDate.get(s.snapshot_date) ?? 0) + Number(s.total_value));
  }
  const evolution: EvolutionPoint[] = [...byDate.entries()].map(([date, total]) => ({
    date,
    total,
  }));

  // ---- renda passiva (histórico completo; o card soma os últimos 12m) -----
  const passiveEntries: IncomeEntry[] = [];
  const categoriesSeen = new Map<string, string>();
  const monthsIn12m = new Set<string>();
  let passiveTotal12m = 0;
  for (const income of incomeData ?? []) {
    const cat = income.income_categories as unknown as { name: string; slug: string } | null;
    if (!cat || cat.slug === "salario") continue;
    const date = String(income.received_at);
    passiveEntries.push({ date, slug: cat.slug, amount: Number(income.amount) });
    categoriesSeen.set(cat.slug, cat.name);
    if (date >= sinceIso) {
      passiveTotal12m += Number(income.amount);
      monthsIn12m.add(date.slice(0, 7));
    }
  }
  const incomeCategories: IncomeCategoryInfo[] = [...categoriesSeen.entries()].map(
    ([slug, name]) => ({ slug, name }),
  );

  const monthsWithData = Math.max(1, monthsIn12m.size);
  const monthlyAvg = passiveTotal12m / monthsWithData;

  // ---- saldo do mês corrente ---------------------------------------------
  const mesIn = mesIncomes.reduce((sum, r) => sum + Number(r.amount), 0);
  const mesOut = [...mesManual, ...mesCard].reduce((sum, r) => sum + Number(r.amount), 0);
  const mesSaldo = mesIn - mesOut;

  // ---- variação patrimonial (~30 dias, pela série de snapshots) -----------
  let variation: { amount: number; pct: number } | null = null;
  if (evolution.length >= 2) {
    const latest = evolution[evolution.length - 1];
    const cutoff = new Date(new Date(latest.date).getTime() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    // sem fallback: só mostra quando existe medição de ~30 dias atrás, senão
    // uma série recém-começada inflaria a variação
    const baseline = [...evolution].reverse().find((p) => p.date <= cutoff);
    if (baseline && baseline.date !== latest.date && baseline.total > 0) {
      variation = {
        amount: latest.total - baseline.total,
        pct: (latest.total / baseline.total - 1) * 100,
      };
    }
  }

  const pricesUpdatedAt = assets
    .map((a) => a.market_instruments?.current_price_updated_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} view={scope.casal ? "casal" : undefined} />
      <main className="w-full flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            {scope.casal ? "Visão do casal" : "Visão geral"}
          </h1>
          {scope.canToggle && <ViewToggle basePath="/" casal={scope.casal} />}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Patrimônio total"
            value={formatBRL(totalValue)}
            hint={
              variation
                ? `${variation.amount >= 0 ? "+" : ""}${formatBRL(variation.amount)} (${variation.pct >= 0 ? "+" : ""}${variation.pct.toFixed(1)}%) em ~30 dias · ${assets.length} ativos`
                : pricesUpdatedAt
                  ? `${assets.length} ativos · cotações de ${new Date(String(pricesUpdatedAt)).toLocaleString("pt-BR")}`
                  : `${assets.length} ativos`
            }
          />
          <StatTile
            label="Saldo do mês"
            value={`${mesSaldo >= 0 ? "+" : ""}${formatBRL(mesSaldo)}`}
            tone={mesSaldo >= 0 ? "positive" : "negative"}
            hint={`entradas ${formatBRL(mesIn)} · saídas ${formatBRL(mesOut)}`}
          />
          <StatTile
            label={`Renda passiva (últimos ${MONTHS_SHOWN} meses)`}
            value={formatBRL(passiveTotal12m)}
            hint="dividendos, JCP, FIIs e renda fixa"
          />
          <StatTile label="Média mensal de renda passiva" value={formatBRL(monthlyAvg)} />
        </div>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Alocação por classe
          </h2>
          <AllocationBar slices={slices} />
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Evolução do patrimônio
            </h2>
            <EvolutionChart points={evolution} />
          </section>
          <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Renda passiva
            </h2>
            <IncomeChart entries={passiveEntries} categories={incomeCategories} />
          </section>
        </div>
      </main>
    </div>
  );
}
