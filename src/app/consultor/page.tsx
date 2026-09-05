import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { StatTile } from "@/components/stat-tile";
import { DeviationBar } from "@/components/deviation-bar";
import { formatBRL, formatPercent, parseDecimal } from "@/lib/format";
import { allocationColor } from "@/lib/chart-colors";
import {
  computeAllocation,
  DEFAULT_SETTINGS,
  type AllocationReport,
  type AllocationSettings,
} from "@/lib/allocation";
import { loadAllocationData } from "@/lib/allocation-data";
import {
  card,
  EmptyCategories,
  inputClass,
  linkClass,
  MigrationNotice,
  noticeError,
  noticeWarn,
  primaryButton,
  sectionTitle,
  td,
  th,
} from "./ui";

const EPS = 0.005;

function Report({
  report,
  settings,
  aporte,
}: {
  report: AllocationReport;
  settings: AllocationSettings;
  aporte: string | undefined;
}) {
  const hasContribution = report.contribution > EPS;
  const visible = report.categories.filter((c) => !c.hidden);
  const scale = Math.max(5, ...visible.map((c) => Math.abs(c.deviationPts)));
  const targetsOk = Math.abs(report.targetSum - 100) < 0.01;
  const overCap = report.totalAssetCount > settings.max_total_assets;
  const reserve = report.reserve;
  const reserveBelow = reserve.target > 0 && reserve.gap > EPS;

  return (
    <>
      <section className={card}>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="aporte" className="block text-xs font-medium text-zinc-500">
              Quanto você vai aportar agora? (R$)
            </label>
            <input
              id="aporte"
              name="aporte"
              inputMode="decimal"
              placeholder="Ex: 3.000,00"
              defaultValue={aporte ?? ""}
              className={`${inputClass} w-48`}
            />
          </div>
          <button type="submit" className={primaryButton}>
            Analisar carteira
          </button>
          <p className="basis-full text-xs text-zinc-500 sm:basis-auto">
            Nível 1: alocação por caixa. Seleção de ativos, notícias e poda entram nas
            próximas entregas.
          </p>
        </form>
      </section>

      {report.unclassified.length > 0 && (
        <p className={noticeWarn}>
          {report.unclassified.length} ativo{report.unclassified.length === 1 ? "" : "s"}{" "}
          ainda sem categoria ficam fora desta análise:{" "}
          {report.unclassified
            .slice(0, 5)
            .map((a) => a.name)
            .join(", ")}
          {report.unclassified.length > 5 ? "…" : ""}.{" "}
          <Link href="/consultor/classificar" className="underline">
            Classificar agora
          </Link>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Carteira considerada"
          value={formatBRL(report.total)}
          hint={`${report.countedCount} ativo${report.countedCount === 1 ? "" : "s"} classificado${report.countedCount === 1 ? "" : "s"} · ${report.excludedCount} fora da carteira`}
        />
        <StatTile
          label="Reserva de emergência"
          value={formatBRL(reserve.current)}
          tone={reserve.target > 0 ? (reserveBelow ? "negative" : "positive") : undefined}
          hint={
            reserve.target > 0
              ? `meta ${formatBRL(reserve.target)} · ${
                  reserveBelow
                    ? `faltam ${formatBRL(reserve.gap)}`
                    : `${formatBRL(-reserve.gap)} acima do valor`
                }${reserve.categoryName ? ` · dentro de ${reserve.categoryName}` : ""}`
              : "defina o valor em Categorias e metas"
          }
        />
        <StatTile
          label="Ativos no teto"
          value={`${report.totalAssetCount} / ${settings.max_total_assets}`}
          tone={overCap ? "negative" : undefined}
          hint="cada ticker conta 1 · renda fixa conta 1 · reserva não conta"
        />
        <StatTile
          label="Soma das metas"
          value={formatPercent(report.targetSum, 0)}
          tone={targetsOk ? undefined : "negative"}
          hint={targetsOk ? "as metas fecham em 100%" : "ajuste em Categorias e metas"}
        />
      </div>

      <section className={card}>
        <h2 className={sectionTitle}>Caixas vs meta</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                <th className={th}>Categoria</th>
                <th className={`${th} text-right`}>Atual</th>
                <th className={`${th} text-right`}>% atual</th>
                <th className={`${th} text-right`}>Meta</th>
                <th className={th}>Desvio</th>
                <th className={`${th} text-right`}>Ativos</th>
                {hasContribution && <th className={`${th} text-right`}>Aporte sugerido</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const max = row.category.max_assets;
                const overSub = max != null && row.assetCount > max;
                return (
                  <tr
                    key={row.category.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                  >
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: allocationColor(row.category.slug) }}
                        />
                        <span className="font-medium text-zinc-950 dark:text-zinc-50">
                          {row.category.name}
                        </span>
                        {row.category.target_pct === 0 && (
                          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-400 dark:border-zinc-800">
                            meta 0%
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>
                      {formatBRL(row.current)}
                    </td>
                    <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>
                      {formatPercent(row.currentPct)}
                    </td>
                    <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>
                      {formatPercent(row.category.target_pct, 0)}
                    </td>
                    <td className={td}>
                      <DeviationBar pts={row.deviationPts} scale={scale} />
                    </td>
                    <td
                      className={`${td} text-right tabular-nums ${
                        overSub ? "text-red-700 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      {row.assetCount}
                      {max != null ? ` / ${max}` : ""}
                    </td>
                    {hasContribution && (
                      <td className={`${td} text-right font-medium tabular-nums text-zinc-950 dark:text-zinc-50`}>
                        {row.suggested > EPS ? formatBRL(row.suggested) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                <td className={td}>Carteira</td>
                <td className={`${td} text-right tabular-nums`}>{formatBRL(report.total)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatPercent(100, 0)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatPercent(report.targetSum, 0)}</td>
                <td className={td} />
                <td className={`${td} text-right tabular-nums`}>
                  {report.totalAssetCount} / {settings.max_total_assets}
                </td>
                {hasContribution && (
                  <td className={`${td} text-right tabular-nums`}>
                    {formatBRL(report.contribution - report.leftover)}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--series-1)" }} />
            abaixo da meta
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--series-2)" }} />
            acima da meta
          </span>
          <span>desvio em pontos percentuais da carteira</span>
        </p>
      </section>

      <section className={card}>
        <h2 className={sectionTitle}>
          {hasContribution ? `Onde entram os ${formatBRL(report.contribution)}` : "Ordem de prioridade do aporte"}
        </h2>
        {hasContribution ? (
          report.plan.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Nenhuma caixa recebe aporte: confira se as metas somam 100%.
            </p>
          ) : (
            <ol className="space-y-2">
              {report.plan.map((step, i) => (
                <li key={`${step.kind}-${step.slug ?? i}`} className="flex items-baseline gap-3 text-sm">
                  <span className="w-5 shrink-0 text-right tabular-nums text-zinc-400">{i + 1}.</span>
                  <span className="flex-1">
                    <span className="font-medium text-zinc-950 dark:text-zinc-50">{step.label}</span>
                    <span className="text-zinc-500"> · {step.reason}</span>
                  </span>
                  <span className="font-medium tabular-nums text-zinc-950 dark:text-zinc-50">
                    {formatBRL(step.amount)}
                  </span>
                </li>
              ))}
            </ol>
          )
        ) : (
          <>
            {!reserveBelow && report.priority.length === 0 ? (
              <p className="text-sm text-zinc-500">Todas as caixas estão na meta ou acima.</p>
            ) : (
              <ol className="space-y-2">
                {reserveBelow && (
                  <li className="flex items-baseline gap-3 text-sm">
                    <span className="w-5 shrink-0 text-right tabular-nums text-zinc-400">1.</span>
                    <span className="flex-1">
                      <span className="font-medium text-zinc-950 dark:text-zinc-50">
                        Reserva de emergência
                      </span>
                      <span className="text-zinc-500"> · prioridade automática até completar o valor</span>
                    </span>
                    <span className="font-medium tabular-nums text-zinc-950 dark:text-zinc-50">
                      faltam {formatBRL(reserve.gap)}
                    </span>
                  </li>
                )}
                {report.priority.map((row, i) => (
                  <li key={row.category.id} className="flex items-baseline gap-3 text-sm">
                    <span className="w-5 shrink-0 text-right tabular-nums text-zinc-400">
                      {i + (reserveBelow ? 2 : 1)}.
                    </span>
                    <span className="flex-1">
                      <span className="font-medium text-zinc-950 dark:text-zinc-50">
                        {row.category.name}
                      </span>
                      <span className="text-zinc-500">
                        {" "}
                        · {formatPercent((row.gap / row.targetAfter) * 100, 0)} abaixo da meta
                      </span>
                    </span>
                    <span className="font-medium tabular-nums text-zinc-950 dark:text-zinc-50">
                      faltam {formatBRL(row.gap)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 text-xs text-zinc-500">
              Informe o valor do aporte acima para ver a distribuição em reais.
            </p>
          </>
        )}
      </section>
    </>
  );
}

export default async function ConsultorPage({
  searchParams,
}: {
  searchParams: Promise<{ aporte?: string; erro?: string }>;
}) {
  const { aporte, erro } = await searchParams;

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, data] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    loadAllocationData(supabase, user.id),
  ]);

  const contribution = Math.max(0, parseDecimal(aporte ?? "") ?? 0);
  const settings = data.settings ?? DEFAULT_SETTINGS;
  const report =
    data.ready && data.categories.length > 0
      ? computeAllocation(data.assets, data.categories, settings, contribution)
      : null;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
              Consultor de Alocação
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Compara cada caixa da sua carteira com a meta e diz onde o próximo aporte
              deve entrar. Só os seus ativos, na cotação mais recente.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/consultor/classificar" className={linkClass}>
              Classificar ativos
            </Link>
            <Link href="/consultor/categorias" className={linkClass}>
              Categorias e metas
            </Link>
          </div>
        </div>

        {erro && <p className={noticeError}>{erro}</p>}
        {!data.ready && <MigrationNotice />}
        {data.ready && data.categories.length === 0 && <EmptyCategories />}
        {report && <Report report={report} settings={settings} aporte={aporte} />}
      </main>
    </div>
  );
}
