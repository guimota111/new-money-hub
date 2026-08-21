import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/header";
import { AllocationBar } from "@/components/charts/allocation-bar";
import { EvolutionChart, type EvolutionPoint } from "@/components/charts/evolution-chart";
import {
  IncomeChart,
  type IncomeCategoryInfo,
  type MonthlyIncomeRow,
} from "@/components/charts/income-chart";
import { formatBRL } from "@/lib/format";
import { assetCurrentValue, CLASS_ORDER, type AssetRow } from "@/lib/portfolio";

const MONTHS_SHOWN = 13;

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export default async function Home() {
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

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/onboarding");

  // ---- ativos + alocação --------------------------------------------------
  const { data: assetData } = await supabase
    .from("assets")
    .select(
      "id, name, quantity, average_price, purchase_date, metadata, asset_classes(name, slug), market_instruments(ticker, current_price, current_price_updated_at)",
    )
    .eq("user_id", user.id);
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
  const { data: snapshotData } = await supabase
    .from("asset_snapshots")
    .select("snapshot_date, total_value, assets!inner(user_id)")
    .eq("assets.user_id", user.id)
    .order("snapshot_date", { ascending: true });
  const byDate = new Map<string, number>();
  for (const s of snapshotData ?? []) {
    byDate.set(s.snapshot_date, (byDate.get(s.snapshot_date) ?? 0) + Number(s.total_value));
  }
  const evolution: EvolutionPoint[] = [...byDate.entries()].map(([date, total]) => ({
    date,
    total,
  }));

  // ---- renda passiva mensal ----------------------------------------------
  const since = new Date();
  since.setMonth(since.getMonth() - MONTHS_SHOWN);
  const sinceIso = since.toISOString().slice(0, 10);

  const { data: incomeData } = await supabase
    .from("incomes")
    .select("amount, received_at, income_categories(name, slug)")
    .eq("user_id", user.id)
    .gte("received_at", sinceIso)
    .neq("income_categories.slug", "salario")
    .limit(5000);

  const monthly = new Map<string, Record<string, number>>();
  const categoriesSeen = new Map<string, string>();
  let passiveTotal12m = 0;
  for (const income of incomeData ?? []) {
    const cat = income.income_categories as unknown as { name: string; slug: string } | null;
    if (!cat || cat.slug === "salario") continue;
    const month = String(income.received_at).slice(0, 7);
    const bucket = monthly.get(month) ?? {};
    bucket[cat.slug] = (bucket[cat.slug] ?? 0) + Number(income.amount);
    monthly.set(month, bucket);
    categoriesSeen.set(cat.slug, cat.name);
    passiveTotal12m += Number(income.amount);
  }
  const incomeRows: MonthlyIncomeRow[] = [...monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, values]) => ({ month, ...values }));
  const incomeCategories: IncomeCategoryInfo[] = [...categoriesSeen.entries()].map(
    ([slug, name]) => ({ slug, name }),
  );

  const monthsWithData = Math.max(1, incomeRows.length);
  const monthlyAvg = passiveTotal12m / monthsWithData;

  const pricesUpdatedAt = assets
    .map((a) => a.market_instruments?.current_price_updated_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full flex-1 space-y-6 px-6 py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Patrimônio total"
            value={formatBRL(totalValue)}
            hint={
              pricesUpdatedAt
                ? `Cotações de ${new Date(String(pricesUpdatedAt)).toLocaleString("pt-BR")}`
                : "Baseado no preço médio — cotações automáticas em breve"
            }
          />
          <StatTile
            label={`Renda passiva (últimos ${MONTHS_SHOWN} meses)`}
            value={formatBRL(passiveTotal12m)}
          />
          <StatTile label="Média mensal de renda passiva" value={formatBRL(monthlyAvg)} />
          <StatTile label="Ativos em carteira" value={String(assets.length)} />
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
              Renda passiva por mês
            </h2>
            <IncomeChart rows={incomeRows} categories={incomeCategories} />
          </section>
        </div>
      </main>
    </div>
  );
}
