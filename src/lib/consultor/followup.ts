import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PositionSnapshot,
  PreviousRecommendation,
  PreviousRunSummary,
  RecommendationStatus,
  ShoppingType,
} from "./types";

// Acatamento: compara as posições de hoje com as do momento da rodada
// anterior e marca cada recomendação como executada, parcial ou ignorada.
// Marcação manual do usuário (status_source = 'manual') nunca é sobrescrita.

export interface RecommendationRow {
  id: string;
  run_id: string;
  type: ShoppingType;
  category_slug: string | null;
  ticker: string;
  market: "BR" | "US";
  quantity: number | string | null;
  amount_brl: number | string | null;
  price: number | string | null;
  currency: "BRL" | "USD";
  rationale: string | null;
  status: RecommendationStatus;
  status_source: "auto" | "manual";
  created_at: string;
  resolved_at: string | null;
}

const EPS = 1e-9;

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// null = recomendação informativa (watch): não muda de status
export function detectStatus(
  rec: Pick<RecommendationRow, "type" | "ticker" | "market" | "quantity" | "rationale">,
  before: PositionSnapshot,
  after: PositionSnapshot,
): RecommendationStatus | null {
  const key = `${rec.market}:${rec.ticker.toUpperCase()}`;
  const qBefore = before[key]?.quantity ?? 0;
  const qAfter = after[key]?.quantity ?? 0;
  const delta = qAfter - qBefore;
  const expectedRaw = num(rec.quantity);
  const expected = expectedRaw != null && expectedRaw > 0 ? expectedRaw : null;

  switch (rec.type) {
    case "buy":
    case "reinforce":
    case "alternative":
      if (delta <= EPS) return "ignored";
      if (expected != null) return delta >= expected * 0.9 ? "executed" : "partial";
      return "executed";
    case "trim":
      if (delta >= -EPS) return "ignored";
      if (qAfter <= EPS) return "executed";
      if (expected != null) return -delta >= expected * 0.9 ? "executed" : "partial";
      return "executed";
    case "sell":
      if (qBefore > EPS && qAfter <= EPS) return "executed";
      if (delta < -EPS) return "partial";
      return "ignored";
    case "substitute": {
      // rationale começa com "Vender XXXX para comprar YYYY"
      const sold = rec.rationale?.match(/^Vender\s+([A-Z0-9.\-]+)/i)?.[1]?.toUpperCase();
      const bought = delta > EPS;
      let soldOut = false;
      let reduced = false;
      if (sold) {
        const sKey = `${rec.market}:${sold}`;
        const sBefore = before[sKey]?.quantity ?? 0;
        const sAfter = after[sKey]?.quantity ?? 0;
        soldOut = sBefore > EPS && sAfter <= EPS;
        reduced = sAfter < sBefore - EPS;
      }
      if (bought && (soldOut || !sold)) return "executed";
      if (bought || reduced) return "partial";
      return "ignored";
    }
    case "watch":
      return null;
  }
}

interface PreviousRunRow {
  id: string;
  created_at: string;
  mode: "standard" | "full";
  contribution_amount: number | string;
  narrative: string | null;
  positions: PositionSnapshot | null;
}

export function summarizeCounts(recs: { status: RecommendationStatus }[]): Record<RecommendationStatus, number> {
  const counts: Record<RecommendationStatus, number> = { pending: 0, executed: 0, partial: 0, ignored: 0 };
  for (const r of recs) counts[r.status]++;
  return counts;
}

export function toPrevious(run: PreviousRunRow, recs: RecommendationRow[]): PreviousRunSummary {
  const recommendations: PreviousRecommendation[] = recs.map((r) => ({
    type: r.type,
    category: r.category_slug,
    ticker: r.ticker,
    amountBrl: num(r.amount_brl),
    quantity: num(r.quantity),
    rationale: r.rationale,
    status: r.status,
    statusSource: r.status_source,
  }));
  return {
    runId: run.id,
    createdAt: run.created_at,
    contribution: Number(run.contribution_amount),
    mode: run.mode,
    recommendations,
    counts: summarizeCounts(recs.filter((r) => r.type !== "watch")),
    narrativeExcerpt: run.narrative ? run.narrative.slice(0, 700) : null,
  };
}

// Reconcilia as últimas rodadas concluídas antes de `before` com as posições
// atuais e devolve o resumo da mais recente (ou null se não houver).
export async function reconcilePreviousRuns(
  supabase: SupabaseClient,
  userId: string,
  before: string,
  current: PositionSnapshot,
): Promise<PreviousRunSummary | null> {
  const { data: runData } = await supabase
    .from("analysis_runs")
    .select("id, created_at, mode, contribution_amount, narrative, positions:state->prepared->positions")
    .eq("user_id", userId)
    .eq("status", "done")
    .lt("created_at", before)
    .order("created_at", { ascending: false })
    .limit(5);
  const runs = (runData ?? []) as unknown as PreviousRunRow[];
  if (runs.length === 0) return null;

  const { data: recData } = await supabase
    .from("analysis_recommendations")
    .select("*")
    .in(
      "run_id",
      runs.map((r) => r.id),
    );
  const recs = (recData ?? []) as RecommendationRow[];
  const now = new Date().toISOString();

  for (const run of runs) {
    if (!run.positions) continue; // rodada antiga sem foto das posições
    for (const rec of recs) {
      if (rec.run_id !== run.id || rec.status_source === "manual") continue;
      const status = detectStatus(rec, run.positions, current);
      if (status == null || status === rec.status) continue;
      const { error } = await supabase
        .from("analysis_recommendations")
        .update({ status, status_source: "auto", resolved_at: status === "pending" ? null : now })
        .eq("id", rec.id)
        .eq("user_id", userId);
      if (!error) {
        rec.status = status;
        rec.status_source = "auto";
      }
    }
  }

  const latest = runs[0];
  return toPrevious(
    latest,
    recs.filter((r) => r.run_id === latest.id),
  );
}
