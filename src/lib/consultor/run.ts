import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeAllocation,
  DEFAULT_SETTINGS,
  type AllocationAssetRow,
  type AllocationReport,
} from "@/lib/allocation";
import { loadAllocationData } from "@/lib/allocation-data";
import { assetCurrentValue, isUsClass } from "@/lib/portfolio";
import {
  buildFundamentalsIndex,
  loadFundamentalsData,
  MIGRATION_FILE_0009,
  type FundamentalsIndex,
} from "@/lib/fundamentals/cache";
import {
  SCREEN_CATEGORIES,
  screenCategory,
  type ScreenCategory,
  type ScreenResult,
} from "@/lib/fundamentals/screen";
import type { Fundamentals } from "@/lib/fundamentals/types";
import { universeEntryFor } from "@/lib/fundamentals/universe";
import { fetchFinnhubQuote, fetchPtaxUsdBrl } from "@/lib/prices";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/supabase/errors";
import {
  collectHeadlines,
  loadNewsCache,
  MIGRATION_FILE_0011,
  newsKey,
  saveVerdicts,
} from "@/lib/news/cache";
import { addUsage, emptyUsage, MODELS, runStructured, runText } from "./ai";
import { reconcilePreviousRuns } from "./followup";
import {
  buildNarrativePrompt,
  buildNewsPrompt,
  buildRankingPrompt,
  NARRATIVE_SYSTEM,
  NEWS_LEVEL_LABEL,
  NEWS_SYSTEM,
  RANKING_SYSTEM,
} from "./prompts";
import { NewsVerdictSchema, RankingSchema, type RankingOutput } from "./schemas";
import { buildShoppingList, marketOf } from "./shopping";
import type {
  CompactAsset,
  CompactHolding,
  Level1Summary,
  NewsHeadline,
  NewsTarget,
  NewsVerdict,
  PositionSnapshot,
  PreparedCategory,
  PreparedState,
  RunRow,
  RunSnapshot,
  RunState,
} from "./types";

// Máquina de etapas da análise. Cada chamada a advanceRun executa UMA etapa
// (a de IA leva até ~2 min) e grava o estado; o cliente chama de novo até
// terminar. Um lock por step_started_at evita duas invocações na mesma etapa.

export const MIGRATION_FILE_0010 = "supabase/migrations/0010_analysis_runs.sql";
const LOCK_MINUTES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function stepLabel(step: string, categoryNames: Record<string, string> = {}): string {
  if (step === "prepare") return "Lendo carteira, metas e universo";
  if (step === "news") return "Lendo notícias das posições";
  if (step === "news_finalists") return "Lendo notícias dos finalistas";
  if (step === "shopping") return "Montando a lista de compras";
  if (step === "narrative") return "Escrevendo o relatório";
  if (step.startsWith("rank:")) {
    const slug = step.slice(5);
    return `IA analisando ${categoryNames[slug] ?? slug}`;
  }
  return step;
}

export function snapshotOf(run: RunRow, busy = false): RunSnapshot {
  const state = run.state;
  const names = Object.fromEntries((state.prepared?.categories ?? []).map((c) => [c.slug, c.name]));
  const step = state.plan[state.done.length] ?? run.step;
  const progress =
    run.status === "done"
      ? 100
      : state.plan.length > 0
        ? Math.round((state.done.length / state.plan.length) * 100)
        : 0;
  return {
    id: run.id,
    status: run.status,
    step,
    stepLabel: run.status === "done" ? "Concluída" : stepLabel(step, names),
    progress,
    error: run.error,
    busy,
  };
}

export async function createRun(
  supabase: SupabaseClient,
  userId: string,
  { contribution, mode }: { contribution: number; mode: "standard" | "full" },
): Promise<{ id: string } | { error: string }> {
  const state: RunState = { plan: ["prepare"], done: [], usage: emptyUsage() };
  const { data, error } = await supabase
    .from("analysis_runs")
    .insert({
      user_id: userId,
      mode,
      contribution_amount: contribution,
      status: "running",
      step: "prepare",
      progress: 0,
      state,
    })
    .select("id")
    .single();
  if (error) {
    return {
      error: isMissingTableError(error)
        ? `Rode ${MIGRATION_FILE_0010} no SQL editor do Supabase.`
        : error.message,
    };
  }
  return { id: data.id as string };
}

export async function loadRun(supabase: SupabaseClient, userId: string, runId: string): Promise<RunRow | null> {
  const { data } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as RunRow | null) ?? null;
}

export async function retryRun(supabase: SupabaseClient, userId: string, runId: string): Promise<RunSnapshot> {
  const { data } = await supabase
    .from("analysis_runs")
    .update({ status: "running", error: null, step_started_at: null })
    .eq("id", runId)
    .eq("user_id", userId)
    .eq("status", "failed")
    .select("*")
    .maybeSingle();
  const run = (data as RunRow | null) ?? (await loadRun(supabase, userId, runId));
  if (!run) throw new Error("Análise não encontrada.");
  return snapshotOf(run);
}

export async function advanceRun(supabase: SupabaseClient, userId: string, runId: string): Promise<RunSnapshot> {
  const run = await loadRun(supabase, userId, runId);
  if (!run) throw new Error("Análise não encontrada.");
  if (run.status !== "running") return snapshotOf(run);

  // lock: só uma invocação por etapa; lock antigo (função morreu) é retomado
  const staleBefore = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const { data: locked } = await supabase
    .from("analysis_runs")
    .update({ step_started_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "running")
    .or(`step_started_at.is.null,step_started_at.lt.${staleBefore}`)
    .select("id");
  if (!locked || locked.length === 0) return snapshotOf(run, true);

  const state = run.state;
  const step = state.plan[state.done.length];

  try {
    if (!step) {
      // nada a fazer: encerra
    } else if (step === "prepare") {
      await stepPrepare(supabase, userId, run, state);
    } else if (step === "news") {
      await stepNews(supabase, state);
    } else if (step === "news_finalists") {
      await stepNewsFinalists(supabase, state);
    } else if (step.startsWith("rank:")) {
      await stepRank(state, step.slice(5), run.mode);
    } else if (step === "shopping") {
      await stepShopping(supabase, userId, run, state);
    } else if (step === "narrative") {
      await stepNarrative(state, run.mode);
    } else {
      throw new Error(`Etapa desconhecida: ${step}`);
    }
    if (step) state.done.push(step);
    const finished = state.done.length >= state.plan.length;
    const next = state.plan[state.done.length] ?? step ?? "done";
    const patch: Record<string, unknown> = {
      state,
      step: next,
      progress: finished ? 100 : Math.round((state.done.length / state.plan.length) * 100),
      step_started_at: null,
      tokens_in: state.usage.input + state.usage.cacheRead + state.usage.cacheWrite,
      tokens_out: state.usage.output,
      cost_usd: state.usage.costUsd,
      fx_rate: state.prepared?.fxRate ?? null,
    };
    if (finished) {
      patch.status = "done";
      patch.finished_at = new Date().toISOString();
      patch.narrative = state.narrative ?? null;
      patch.report = buildReport(state);
    }
    const { data } = await supabase
      .from("analysis_runs")
      .update(patch)
      .eq("id", runId)
      .select("*")
      .single();
    return snapshotOf((data as RunRow) ?? { ...run, state, status: finished ? "done" : "running" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido";
    const { data } = await supabase
      .from("analysis_runs")
      .update({
        status: "failed",
        error: message,
        step_started_at: null,
        state,
        tokens_in: state.usage.input + state.usage.cacheRead + state.usage.cacheWrite,
        tokens_out: state.usage.output,
        cost_usd: state.usage.costUsd,
      })
      .eq("id", runId)
      .select("*")
      .single();
    return snapshotOf((data as RunRow) ?? { ...run, state, status: "failed", error: message });
  }
}

// ---- etapa 1: carteira, nível 1, universo e pré-filtro --------------------

function toLevel1(report: AllocationReport): Level1Summary {
  return {
    total: report.total,
    totalAfter: report.totalAfter,
    contribution: report.contribution,
    reserve: {
      current: report.reserve.current,
      target: report.reserve.target,
      gap: report.reserve.gap,
      suggested: report.reserve.suggested,
    },
    categories: report.categories
      .filter((c) => !c.hidden)
      .map((c) => ({
        slug: c.category.slug,
        name: c.category.name,
        current: c.current,
        currentPct: c.currentPct,
        targetPct: c.category.target_pct,
        suggested: c.suggested,
        assetCount: c.assetCount,
        maxAssets: c.category.max_assets,
      })),
    plan: report.plan.map((p) => ({ label: p.label, amount: p.amount, reason: p.reason })),
    unclassified: report.unclassified.length,
  };
}

function compactAsset(f: Fundamentals | undefined, ticker: string, market: "BR" | "US"): CompactAsset {
  if (!f) {
    return {
      ticker,
      name: null,
      sector: null,
      kind: "stock",
      currency: market === "US" ? "USD" : "BRL",
      price: null,
      marketCap: null,
      liquidity: null,
      pe: null,
      pb: null,
      dy: null,
      roe: null,
      roic: null,
      netMargin: null,
      netDebtToEquity: null,
      currentRatio: null,
      revenueGrowth5y: null,
      earningsGrowth: null,
      segment: null,
      ffoYield: null,
      capRate: null,
      vacancy: null,
      properties: null,
      epsHistory: null,
      flags: ["sem fundamentos no cache"],
    };
  }
  const flags: string[] = [];
  if (f.sources.length === 0) flags.push("sem dados nas fontes");
  const eps = f.annual?.map((a) => a.eps).filter((v): v is number => v != null).slice(0, 6) ?? null;
  return {
    ticker: f.ticker,
    name: f.name,
    sector: f.sector,
    kind: f.kind,
    currency: f.currency,
    price: f.price,
    marketCap: f.marketCap,
    liquidity: f.liquidity,
    pe: f.pe,
    pb: f.pb,
    dy: f.dy,
    roe: f.roe,
    roic: f.roic,
    netMargin: f.netMargin,
    netDebtToEquity: f.netDebtToEquity,
    currentRatio: f.currentRatio,
    revenueGrowth5y: f.revenueGrowth5y,
    earningsGrowth: f.earningsGrowth,
    segment: f.segment,
    ffoYield: f.ffoYield,
    capRate: f.capRate,
    vacancy: f.vacancy,
    properties: f.properties,
    epsHistory: eps && eps.length > 0 ? eps : null,
    flags,
  };
}

function compactHolding(
  asset: AllocationAssetRow,
  market: "BR" | "US",
  index: FundamentalsIndex,
  screened: ScreenResult,
  categoryValue: number,
  fxRate: number | null,
): CompactHolding {
  const ticker = asset.market_instruments!.ticker!.toUpperCase();
  const base = compactAsset(index.byKey.get(`${market}:${ticker}`), ticker, market);
  const quantity = Number(asset.quantity);
  const avgPrice = asset.average_price != null ? Number(asset.average_price) : null;
  const priceBrl = asset.market_instruments?.current_price != null ? Number(asset.market_instruments.current_price) : null;
  // current_price é BRL; para EUA volta a US$ pelo câmbio da rodada
  const currentPrice = market === "US" ? (priceBrl != null && fxRate ? priceBrl / fxRate : base.price) : priceBrl ?? base.price;
  const gainPct = avgPrice && currentPrice ? (currentPrice / avgPrice - 1) * 100 : null;
  const valueBrl = assetCurrentValue(asset);
  return {
    ...base,
    quantity,
    avgPrice,
    currentPrice,
    gainPct,
    valueBrl,
    weightPct: categoryValue > 0 ? (valueBrl / categoryValue) * 100 : 0,
    heldButFailing: screened.passed.find((p) => p.f.ticker === ticker)?.heldButFailing ?? null,
  };
}

function universeFor(slug: ScreenCategory, index: FundamentalsIndex, held: Set<string>): Fundamentals[] {
  if (slug === "acoes_br") return index.brStocks;
  if (slug === "fiis") return index.fiis;
  const want = slug === "acoes_eua" ? "us" : "intl";
  return index.us.filter((f) => universeEntryFor(f.ticker).exposure === want || held.has(f.ticker));
}

async function stepPrepare(supabase: SupabaseClient, userId: string, run: RunRow, state: RunState) {
  const allocation = await loadAllocationData(supabase, userId);
  if (!allocation.ready) throw new Error("Rode a migração 0007 (supabase/migrations/0007_allocation.sql).");
  if (allocation.categories.length === 0) throw new Error("Crie as categorias do consultor antes de analisar.");
  const settings = allocation.settings ?? DEFAULT_SETTINGS;
  const contribution = Number(run.contribution_amount);
  const report = computeAllocation(allocation.assets, allocation.categories, settings, contribution);

  const fundamentals = await loadFundamentalsData(supabase);
  if (!fundamentals.ready) throw new Error(`Rode ${MIGRATION_FILE_0009} no SQL editor do Supabase.`);

  let fxRate: number | null = null;
  const { data: fx } = await supabase.from("fx_rates").select("rate").eq("pair", "USDBRL").maybeSingle();
  if (fx?.rate != null) fxRate = Number(fx.rate);
  else {
    try {
      fxRate = (await fetchPtaxUsdBrl())?.rate ?? null;
    } catch {
      fxRate = null;
    }
  }

  const usHeld = allocation.assets
    .filter((a) => isUsClass(a.asset_classes?.slug) && a.market_instruments?.ticker)
    .map((a) => a.market_instruments!.ticker!.toUpperCase());
  const index = buildFundamentalsIndex(fundamentals.rows, usHeld);

  // foto das posições com ticker (qualquer classe): base para saber, na
  // próxima rodada, o que desta foi acatado
  const positions: PositionSnapshot = {};
  for (const a of allocation.assets) {
    const ticker = a.market_instruments?.ticker?.toUpperCase();
    if (!ticker) continue;
    const key = `${isUsClass(a.asset_classes?.slug) ? "US" : "BR"}:${ticker}`;
    const prev = positions[key] ?? { quantity: 0, valueBrl: 0 };
    positions[key] = {
      quantity: prev.quantity + Number(a.quantity),
      valueBrl: prev.valueBrl + assetCurrentValue(a),
    };
  }
  const previous = await reconcilePreviousRuns(supabase, userId, run.created_at, positions);

  const prepared: PreparedState = {
    level1: toLevel1(report),
    fxRate,
    maxTotalAssets: settings.max_total_assets,
    totalAssetCount: report.totalAssetCount,
    categories: [],
    skipped: [],
    watchlist: [],
    positions,
    previous,
  };
  const globalCapLeft = Math.max(0, settings.max_total_assets - report.totalAssetCount);

  for (const cr of report.categories) {
    if (cr.hidden) continue;
    const slug = cr.category.slug;
    if (!(SCREEN_CATEGORIES as string[]).includes(slug)) {
      if (cr.suggested > 0.005) {
        prepared.skipped.push({
          slug,
          name: cr.category.name,
          reason: "sem seleção de ativos: renda fixa, cripto e categorias personalizadas só recebem o valor",
        });
      }
      continue;
    }
    if (run.mode === "standard" && cr.suggested <= 0.005) {
      prepared.skipped.push({ slug, name: cr.category.name, reason: "sem aporte nesta rodada (modo padrão)" });
      continue;
    }
    const category = slug as ScreenCategory;
    const market = marketOf(slug);
    const heldAssets = allocation.assets.filter(
      (a) => a.allocation_category_id === cr.category.id && !a.allocation_excluded && a.market_instruments?.ticker,
    );
    const heldTickers = new Set(heldAssets.map((a) => a.market_instruments!.ticker!.toUpperCase()));
    const screened = screenCategory(category, universeFor(category, index, heldTickers), heldTickers);
    const holdings = heldAssets.map((a) => compactHolding(a, market, index, screened, cr.current, fxRate));
    const candidates = screened.passed.filter((p) => !p.held).map((p) => compactAsset(p.f, p.f.ticker, market));
    prepared.categories.push({
      slug,
      name: cr.category.name,
      aporte: Math.round(cr.suggested * 100) / 100,
      capLeft: cr.category.max_assets == null ? null : Math.max(0, cr.category.max_assets - cr.assetCount),
      globalCapLeft,
      holdings,
      candidates,
      screen: {
        universe: screened.universe,
        passed: screened.passed.length,
        rejected: [...screened.rejected.entries()],
      },
    });
  }

  // toda posição com ticker nas categorias selecionáveis entra na checagem de
  // notícias, mesmo fora das caixas analisadas nesta rodada (poda por notícia)
  const analyzed = new Set(prepared.categories.map((c) => c.slug));
  for (const cr of report.categories) {
    const slug = cr.category.slug;
    if (!(SCREEN_CATEGORIES as string[]).includes(slug)) continue;
    const market = marketOf(slug);
    for (const a of allocation.assets) {
      if (a.allocation_category_id !== cr.category.id || a.allocation_excluded || !a.market_instruments?.ticker) continue;
      const ticker = a.market_instruments.ticker.toUpperCase();
      if (prepared.watchlist.some((w) => w.market === market && w.ticker === ticker)) continue;
      prepared.watchlist.push({
        ticker,
        market,
        name: index.byKey.get(`${market}:${ticker}`)?.name ?? (a.name !== ticker ? a.name : null),
        categorySlug: slug,
        categoryName: cr.category.name,
        outsideAnalysis: !analyzed.has(slug),
      });
    }
  }

  state.prepared = prepared;
  const newsSteps = prepared.watchlist.length > 0 ? ["news"] : [];
  const finalistSteps = run.mode === "full" && prepared.categories.length > 0 ? ["news_finalists"] : [];
  state.plan = [
    "prepare",
    ...newsSteps,
    ...prepared.categories.map((c) => `rank:${c.slug}`),
    ...finalistSteps,
    "shopping",
    "narrative",
  ];
}

// ---- notícias: manchetes (Google News / Brave) + classificação (Sonnet 5) --

async function classifyNews(supabase: SupabaseClient, state: RunState, targets: NewsTarget[]) {
  if (targets.length === 0) return;
  const admin = createAdminClient();
  const cache = await loadNewsCache(supabase, targets);
  if (!cache.ready) throw new Error(`Rode ${MIGRATION_FILE_0011} no SQL editor do Supabase.`);
  const collected = await collectHeadlines(admin, targets, cache.rows);

  const news: Record<string, NewsVerdict> = { ...(state.news ?? {}) };
  const pending: { target: NewsTarget; headlines: NewsHeadline[] }[] = [];
  for (const target of targets) {
    const key = newsKey(target.market, target.ticker);
    const headlines = collected.headlines.get(key) ?? [];
    const cachedVerdict = collected.cachedVerdicts.get(key);
    if (cachedVerdict) {
      news[key] = { ...cachedVerdict, headlines, cached: true };
      continue;
    }
    if (headlines.length === 0) {
      news[key] = {
        level: "neutral",
        recurring: false,
        summary: "Nenhuma manchete encontrada nos últimos 6 meses.",
        themes: [],
        headlines,
        cached: false,
      };
      continue;
    }
    pending.push({ target, headlines });
  }

  const fresh = new Map<string, NewsVerdict>();
  for (let i = 0; i < pending.length; i += 25) {
    const chunk = pending.slice(i, i + 25);
    const { data, usage } = await runStructured({
      model: MODELS.narrative,
      system: NEWS_SYSTEM,
      user: buildNewsPrompt(chunk),
      schema: NewsVerdictSchema,
      maxTokens: 8_000,
      effort: "medium",
    });
    state.usage = addUsage(state.usage, usage);
    const byTicker = new Map(data.verdicts.map((v) => [v.ticker.trim().toUpperCase(), v]));
    for (const { target, headlines } of chunk) {
      const key = newsKey(target.market, target.ticker);
      const v = byTicker.get(target.ticker);
      const verdict: NewsVerdict = v
        ? { level: v.level, recurring: v.recurring, summary: v.summary, themes: v.themes.slice(0, 3), headlines, cached: false }
        : { level: "neutral", recurring: false, summary: "A IA não classificou este ativo.", themes: [], headlines, cached: false };
      news[key] = verdict;
      if (v) fresh.set(key, verdict);
    }
  }
  if (fresh.size > 0) await saveVerdicts(admin, fresh);
  state.news = news;
}

async function stepNews(supabase: SupabaseClient, state: RunState) {
  const prepared = state.prepared;
  if (!prepared) throw new Error("Etapa de preparação não concluída.");
  await classifyNews(supabase, state, prepared.watchlist);
}

// Modo completo: notícias também dos finalistas (compras, alternativas e
// substituições). Veredito não neutro vira flag na recomendação.
async function stepNewsFinalists(supabase: SupabaseClient, state: RunState) {
  const prepared = state.prepared;
  if (!prepared) throw new Error("Etapa de preparação não concluída.");
  const rankings = state.rankings ?? {};
  const targets: NewsTarget[] = [];
  for (const cat of prepared.categories) {
    const r = rankings[cat.slug];
    if (!r) continue;
    const market = marketOf(cat.slug);
    const tickers = new Set([
      ...r.buys.map((b) => b.ticker),
      ...r.alternatives.map((a) => a.ticker),
      ...r.substitutions.map((s) => s.buy),
    ]);
    for (const ticker of tickers) {
      const key = newsKey(market, ticker);
      if (state.news?.[key] || targets.some((t) => t.market === market && t.ticker === ticker)) continue;
      const asset = cat.candidates.find((c) => c.ticker === ticker) ?? cat.holdings.find((h) => h.ticker === ticker);
      targets.push({ ticker, market, name: asset?.name ?? null, categorySlug: cat.slug, categoryName: cat.name, outsideAnalysis: false });
    }
  }
  await classifyNews(supabase, state, targets);

  const news = state.news ?? {};
  for (const cat of prepared.categories) {
    const r = rankings[cat.slug];
    if (!r) continue;
    const market = marketOf(cat.slug);
    for (const buy of r.buys) {
      const v = news[newsKey(market, buy.ticker)];
      if (!v || v.level === "neutral") continue;
      const flag = `notícias: ${NEWS_LEVEL_LABEL[v.level]}${v.recurring ? " recorrente" : ""} — ${v.summary}`;
      if (!buy.flags.some((f) => f.startsWith("notícias:"))) buy.flags.push(flag);
    }
  }
  state.rankings = rankings;
}

// ---- etapa 2: ranking por categoria (Opus 5) ------------------------------

function sanitizeRanking(raw: RankingOutput, cat: PreparedCategory): RankingOutput {
  const known = new Set([...cat.holdings, ...cat.candidates].map((x) => x.ticker));
  const held = new Set(cat.holdings.map((h) => h.ticker));
  const up = (t: string) => t.trim().toUpperCase();
  return {
    buys: raw.buys
      .map((b) => ({ ...b, ticker: up(b.ticker) }))
      .filter((b) => known.has(b.ticker))
      .map((b) => ({ ...b, action: held.has(b.ticker) ? "reinforce" : "new" }) as const),
    alternatives: raw.alternatives.map((a) => ({ ...a, ticker: up(a.ticker) })).filter((a) => known.has(a.ticker)),
    holdings_review: raw.holdings_review.map((h) => ({ ...h, ticker: up(h.ticker) })).filter((h) => held.has(h.ticker)),
    substitutions: raw.substitutions
      .map((s) => ({ ...s, sell: up(s.sell), buy: up(s.buy) }))
      .filter((s) => held.has(s.sell) && known.has(s.buy)),
    notes: raw.notes,
  };
}

async function stepRank(state: RunState, slug: string, mode: "standard" | "full") {
  const prepared = state.prepared;
  if (!prepared) throw new Error("Etapa de preparação não concluída.");
  const cat = prepared.categories.find((c) => c.slug === slug);
  if (!cat) throw new Error(`Categoria ${slug} não preparada.`);

  const { data, usage } = await runStructured({
    model: MODELS.rank,
    system: RANKING_SYSTEM,
    user: buildRankingPrompt(prepared, cat, mode, state.news ?? {}),
    schema: RankingSchema,
    maxTokens: 12_000,
    effort: "high",
  });
  state.rankings = { ...(state.rankings ?? {}), [slug]: sanitizeRanking(data, cat) };
  state.usage = addUsage(state.usage, usage);
}

// ---- etapa 3: lista de compras (código) -----------------------------------

async function stepShopping(supabase: SupabaseClient, userId: string, run: RunRow, state: RunState) {
  const prepared = state.prepared;
  if (!prepared) throw new Error("Etapa de preparação não concluída.");
  const rankings = state.rankings ?? {};

  // candidatos americanos não têm preço no cache de fundamentos: cota na hora
  const overrides = new Map<string, number>();
  const token = process.env.FINNHUB_TOKEN ?? "";
  for (const cat of prepared.categories) {
    if (marketOf(cat.slug) !== "US") continue;
    const ranking = rankings[cat.slug];
    if (!ranking) continue;
    const tickers = new Set([
      ...ranking.buys.map((b) => b.ticker),
      ...ranking.alternatives.map((a) => a.ticker),
      ...ranking.substitutions.map((s) => s.buy),
    ]);
    for (const ticker of tickers) {
      const holding = cat.holdings.find((h) => h.ticker === ticker);
      if (holding?.currentPrice != null) continue;
      const candidate = cat.candidates.find((c) => c.ticker === ticker);
      if (candidate?.price != null || !token) continue;
      try {
        const usd = await fetchFinnhubQuote(ticker, token);
        if (usd != null) overrides.set(`US:${ticker}`, usd);
      } catch {
        // fica sem quantidade estimada
      }
      await sleep(200);
    }
  }

  const shopping = buildShoppingList(prepared, rankings, overrides);
  state.shopping = shopping;

  // recomendações individuais (a próxima rodada usa para saber o que foi acatado)
  await supabase.from("analysis_recommendations").delete().eq("run_id", run.id).eq("user_id", userId);
  if (shopping.items.length > 0) {
    const rows = shopping.items.map((it) => ({
      run_id: run.id,
      user_id: userId,
      type: it.type,
      category_slug: it.category,
      ticker: it.ticker,
      market: it.market,
      quantity: it.quantity,
      amount_brl: it.amountBrl,
      price: it.price,
      currency: it.currency,
      rationale: it.rationale,
    }));
    const { error } = await supabase.from("analysis_recommendations").insert(rows);
    if (error) throw new Error(`analysis_recommendations: ${error.message}`);
  }
}

// ---- etapa 4: relatório em texto (Sonnet 5) -------------------------------

async function stepNarrative(state: RunState, mode: "standard" | "full") {
  const prepared = state.prepared;
  if (!prepared || !state.shopping) throw new Error("Etapas anteriores não concluídas.");
  const { text, usage } = await runText({
    model: MODELS.narrative,
    system: NARRATIVE_SYSTEM,
    user: buildNarrativePrompt(prepared, state.rankings ?? {}, state.shopping, mode, state.news ?? {}),
    maxTokens: 4_000,
    effort: "medium",
  });
  state.narrative = text;
  state.usage = addUsage(state.usage, usage);
}

function buildReport(state: RunState): Record<string, unknown> {
  return {
    level1: state.prepared?.level1 ?? null,
    fxRate: state.prepared?.fxRate ?? null,
    categories: (state.prepared?.categories ?? []).map((c) => ({
      slug: c.slug,
      name: c.name,
      aporte: c.aporte,
      ranking: state.rankings?.[c.slug] ?? null,
      holdings: c.holdings.map((h) => ({
        ticker: h.ticker,
        valueBrl: h.valueBrl,
        weightPct: h.weightPct,
        gainPct: h.gainPct,
      })),
      screen: c.screen,
    })),
    skipped: state.prepared?.skipped ?? [],
    shopping: state.shopping ?? null,
    news: state.news ?? null,
    previous: state.prepared?.previous ?? null,
    usage: state.usage,
  };
}
