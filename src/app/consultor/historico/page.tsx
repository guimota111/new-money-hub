import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { formatBRL } from "@/lib/format";
import { summarizeCounts, type RecommendationRow } from "@/lib/consultor/followup";
import { MIGRATION_FILE_0010 } from "@/lib/consultor/run";
import { isMissingTableError } from "@/lib/supabase/errors";
import { BackLink, card, noticeWarn, td, th } from "../ui";

interface RunListRow {
  id: string;
  status: "running" | "done" | "failed";
  mode: "standard" | "full";
  contribution_amount: number | string;
  cost_usd: number | string;
  progress: number;
  created_at: string;
  finished_at: string | null;
}

const STATUS_LABEL: Record<RunListRow["status"], string> = {
  running: "em andamento",
  done: "concluída",
  failed: "parou",
};

export default async function HistoricoPage() {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, runsRes] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    supabase
      .from("analysis_runs")
      .select("id, status, mode, contribution_amount, cost_usd, progress, created_at, finished_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const ready = !isMissingTableError(runsRes.error);
  const runs = (runsRes.data ?? []) as RunListRow[];

  const countsByRun = new Map<string, ReturnType<typeof summarizeCounts>>();
  if (runs.length > 0) {
    const { data } = await supabase
      .from("analysis_recommendations")
      .select("run_id, type, status")
      .eq("user_id", user.id)
      .in(
        "run_id",
        runs.map((r) => r.id),
      );
    const byRun = new Map<string, Pick<RecommendationRow, "status">[]>();
    for (const r of (data ?? []) as Pick<RecommendationRow, "run_id" | "type" | "status">[]) {
      if (r.type === "watch" || r.type === "alternative") continue;
      if (!byRun.has(r.run_id)) byRun.set(r.run_id, []);
      byRun.get(r.run_id)!.push({ status: r.status });
    }
    for (const [runId, recs] of byRun) countsByRun.set(runId, summarizeCounts(recs));
  }

  const totalCost = runs.reduce((sum, r) => sum + Number(r.cost_usd), 0);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <BackLink />
          <h1 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">Histórico de análises</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cada rodada guarda o relatório e as recomendações. Na rodada seguinte o consultor compara
            as posições e marca o que foi executado, parcial ou ignorado; você corrige à mão dentro de
            cada análise.
          </p>
        </div>

        {!ready && (
          <p className={noticeWarn}>
            As análises precisam da migração 0010. Rode{" "}
            <code className="font-mono text-xs">{MIGRATION_FILE_0010}</code> no SQL editor do Supabase.
          </p>
        )}

        {ready && runs.length === 0 && (
          <p className="text-sm text-zinc-500">Nenhuma análise ainda. Rode a primeira em Consultor.</p>
        )}

        {ready && runs.length > 0 && (
          <section className={`${card} p-0`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className={th}>Data</th>
                    <th className={`${th} text-right`}>Aporte</th>
                    <th className={th}>Modo</th>
                    <th className={th}>Situação</th>
                    <th className={th}>Recomendações acatadas</th>
                    <th className={`${th} text-right`}>Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const c = countsByRun.get(r.id);
                    const total = c ? c.executed + c.partial + c.ignored + c.pending : 0;
                    return (
                      <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                        <td className={td}>
                          <Link
                            href={`/consultor/analise/${r.id}`}
                            className="font-medium text-zinc-950 underline dark:text-zinc-50"
                          >
                            {new Date(r.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                          </Link>
                        </td>
                        <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>
                          {formatBRL(Number(r.contribution_amount))}
                        </td>
                        <td className={`${td} text-zinc-500`}>{r.mode === "full" ? "completo" : "padrão"}</td>
                        <td
                          className={`${td} ${
                            r.status === "failed"
                              ? "text-red-700 dark:text-red-400"
                              : r.status === "running"
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-zinc-500"
                          }`}
                        >
                          {STATUS_LABEL[r.status]}
                          {r.status === "running" ? ` (${r.progress}%)` : ""}
                        </td>
                        <td className={`${td} text-zinc-700 dark:text-zinc-300`}>
                          {c && total > 0 ? (
                            <span className="tabular-nums">
                              <span className="text-emerald-700 dark:text-emerald-400">{c.executed} executadas</span>
                              {" · "}
                              <span className="text-amber-700 dark:text-amber-400">{c.partial} parciais</span>
                              {" · "}
                              <span>{c.ignored} ignoradas</span>
                              {c.pending > 0 ? ` · ${c.pending} sem verificação` : ""}
                            </span>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className={`${td} text-right tabular-nums text-zinc-500`}>
                          {Number(r.cost_usd) > 0 ? `US$ ${Number(r.cost_usd).toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                    <td className={td} colSpan={5}>
                      {runs.length} análise{runs.length === 1 ? "" : "s"}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>US$ {totalCost.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
