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
import { MIGRATION_FILE_0010 } from "@/lib/consultor/run";
import { isMissingTableError } from "@/lib/supabase/errors";
import { SubmitButton } from "@/components/submit-button";
import { startAnalysis } from "./actions";
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

interface RunListRow {
  id: string;
  status: "running" | "done" | "failed";
  mode: "standard" | "full";
  contribution_amount: number | string;
  cost_usd: number | string;
  progress: number;
  created_at: string;
}

const STATUS_LABEL: Record<RunListRow["status"], string> = {
  running: "em andamento",
  done: "concluída",
  failed: "parou",
};

function AnalysisLauncher({
  aporte,
  defaultMode,
  runs,
  runsReady,
}: {
  aporte: string | undefined;
  defaultMode: "standard" | "full";
  runs: RunListRow[];
  runsReady: boolean;
}) {
  return (
    <section className={card}>
      <h2 className={sectionTitle}>Análise completa com IA</h2>
      <form action={startAnalysis} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="aporte-ia" className="block text-xs font-medium text-zinc-500">
            Aporte (R$)
          </label>
          <input
            id="aporte-ia"
            name="aporte"
            inputMode="decimal"
            required
            placeholder="Ex: 3.000,00"
            defaultValue={aporte ?? ""}
            className={`${inputClass} w-40`}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="modo" className="block text-xs font-medium text-zinc-500">
            Modo
          </label>
          <select id="modo" name="modo" defaultValue={defaultMode} className={inputClass}>
            <option value="standard">Padrão: só caixas em déficit</option>
            <option value="full">Completo: varre toda a carteira</option>
          </select>
        </div>
        <SubmitButton pendingText="Iniciando..." className={primaryButton}>
          Analisar carteira
        </SubmitButton>
        <p className="basis-full text-xs text-zinc-500">
          Seleção de ativos com Opus 5 sobre os candidatos do pré-filtro, revisão das posições,
          lista de compras e relatório. Leva alguns minutos e custa em torno de R$ 5 por rodada.
        </p>
      </form>

      {!runsReady && (
        <p className={`${noticeWarn} mt-4`}>
          As análises precisam da migração 0010. Rode{" "}
          <code className="font-mono text-xs">{MIGRATION_FILE_0010}</code> no SQL editor do Supabase.
        </p>
      )}
      {runsReady && runs.length > 0 && (
        <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Últimas análises</h3>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                <Link href={`/consultor/analise/${r.id}`} className="font-medium text-zinc-950 underline dark:text-zinc-50">
                  {new Date(r.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </Link>
                <span className="text-zinc-500">aporte {formatBRL(Number(r.contribution_amount))}</span>
                <span className="text-zinc-500">{r.mode === "full" ? "completo" : "padrão"}</span>
                <span
                  className={
                    r.status === "failed"
                      ? "text-red-700 dark:text-red-400"
                      : r.status === "running"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-zinc-500"
                  }
                >
                  {STATUS_LABEL[r.status]}
                  {r.status === "running" ? ` (${r.progress}%)` : ""}
                </span>
                {Number(r.cost_usd) > 0 && <span className="text-zinc-400">US$ {Number(r.cost_usd).toFixed(2)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

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
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Prévia sem IA
          </button>
          <p className="basis-full text-xs text-zinc-500 sm:basis-auto">
            Nível 1: só a alocação por caixa, na hora e sem custo. A análise completa fica logo
            abaixo.
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

  const [{ data: profile }, data, runsRes] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    loadAllocationData(supabase, user.id),
    supabase
      .from("analysis_runs")
      .select("id, status, mode, contribution_amount, cost_usd, progress, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const contribution = Math.max(0, parseDecimal(aporte ?? "") ?? 0);
  const settings = data.settings ?? DEFAULT_SETTINGS;
  const report =
    data.ready && data.categories.length > 0
      ? computeAllocation(data.assets, data.categories, settings, contribution)
      : null;
  const runsReady = !isMissingTableError(runsRes.error);
  const runs = (runsRes.data ?? []) as RunListRow[];

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
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/consultor/classificar" className={linkClass}>
              Classificar ativos
            </Link>
            <Link href="/consultor/categorias" className={linkClass}>
              Categorias e metas
            </Link>
            <Link href="/consultor/universo" className={linkClass}>
              Universo e pré-filtro
            </Link>
            <Link href="/consultor/historico" className={linkClass}>
              Histórico
            </Link>
          </div>
        </div>

        {erro && <p className={noticeError}>{erro}</p>}
        {!data.ready && <MigrationNotice />}
        {data.ready && data.categories.length === 0 && <EmptyCategories />}
        {report && (
          <AnalysisLauncher
            aporte={aporte}
            defaultMode={settings.default_mode}
            runs={runs}
            runsReady={runsReady}
          />
        )}
        {report && <Report report={report} settings={settings} aporte={aporte} />}
      </main>
    </div>
  );
}
