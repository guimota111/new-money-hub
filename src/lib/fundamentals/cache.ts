import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { isMissingTableError } from "@/lib/supabase/errors";
import { fetchBrapiList, type BrapiListItem } from "./brapi-list";
import { fetchFinnhubMetrics, type FinnhubMetricPayload } from "./finnhub";
import {
  fetchFundamentusDetails,
  fetchFundamentusFiis,
  fetchFundamentusStocks,
  type FundamentusDetails,
  type FundamentusFiiRow,
  type FundamentusStockRow,
} from "./fundamentus";
import { normalizeBrStock, normalizeFii, normalizeUs } from "./normalize";
import { SOURCES, type CacheRow, type Fundamentals, type Market } from "./types";
import { universeEntryFor, US_UNIVERSE } from "./universe";

// Cache de fundamentos no Postgres: uma linha por (mercado, ticker, fonte) com
// o payload bruto. Leitura com o client do usuário (RLS libera para
// autenticados); escrita com o service role.

export const MIGRATION_FILE_0009 = "supabase/migrations/0009_fundamentals_cache.sql";
export const BR_TTL_DAYS = 7;
export const US_TTL_DAYS = 30;
export const DETAILS_TTL_DAYS = 30;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface SourceStatus {
  source: string;
  refreshed_at: string;
  item_count: number;
  note: string | null;
}

export interface FundamentalsData {
  ready: boolean;
  rows: CacheRow[];
  status: Map<string, SourceStatus>;
}

export async function loadFundamentalsData(supabase: SupabaseClient): Promise<FundamentalsData> {
  const probe = await supabase.from("source_refresh").select("source, refreshed_at, item_count, note");
  if (isMissingTableError(probe.error)) return { ready: false, rows: [], status: new Map() };
  const status = new Map(
    ((probe.data ?? []) as SourceStatus[]).map((s) => [s.source, s] as const),
  );
  const rows = await fetchAllRows<CacheRow>((from, to) =>
    supabase
      .from("fundamentals_cache")
      .select("market, ticker, source, payload, fetched_at")
      .order("market")
      .order("ticker")
      .order("source")
      .range(from, to),
  );
  return { ready: true, rows, status };
}

// ---- montagem dos Fundamentals a partir do cache --------------------------

export interface FundamentalsIndex {
  brStocks: Fundamentals[];
  fiis: Fundamentals[];
  us: Fundamentals[];
  byKey: Map<string, Fundamentals>;
}

export function fundamentalsKey(market: Market, ticker: string): string {
  return `${market}:${ticker.toUpperCase()}`;
}

function pick<T>(rows: CacheRow[], market: Market, source: string): Map<string, { row: T; fetchedAt: string }> {
  const out = new Map<string, { row: T; fetchedAt: string }>();
  for (const r of rows) {
    if (r.market === market && r.source === source) {
      out.set(r.ticker, { row: r.payload as unknown as T, fetchedAt: r.fetched_at });
    }
  }
  return out;
}

// extraUsSymbols: ativos americanos da carteira fora das listas estáticas
export function buildFundamentalsIndex(rows: CacheRow[], extraUsSymbols: string[] = []): FundamentalsIndex {
  const fStocks = pick<FundamentusStockRow>(rows, "BR", SOURCES.fundamentusStock);
  const fFiis = pick<FundamentusFiiRow>(rows, "BR", SOURCES.fundamentusFii);
  const details = pick<FundamentusDetails>(rows, "BR", SOURCES.fundamentusDetails);
  const bStocks = pick<BrapiListItem>(rows, "BR", SOURCES.brapiStock);
  const bFunds = pick<BrapiListItem>(rows, "BR", SOURCES.brapiFund);
  const finnhub = pick<FinnhubMetricPayload>(rows, "US", SOURCES.finnhubMetric);

  const brStocks: Fundamentals[] = [];
  const stockTickers = new Set([...fStocks.keys(), ...bStocks.keys()]);
  for (const ticker of stockTickers) {
    const b = bStocks.get(ticker);
    // BDRs e ETFs ficam fora do universo de ações BR (exposição não é Brasil)
    if (b && b.row.type !== "stock") continue;
    brStocks.push(normalizeBrStock(ticker, fStocks.get(ticker), b, details.get(ticker)));
  }

  const fiis: Fundamentals[] = [];
  for (const [ticker, f] of fFiis) {
    fiis.push(normalizeFii(ticker, f, bFunds.get(ticker)));
  }

  const us: Fundamentals[] = [];
  const usSymbols = new Set([...US_UNIVERSE.map((e) => e.symbol), ...extraUsSymbols.map((s) => s.toUpperCase())]);
  for (const symbol of usSymbols) {
    us.push(normalizeUs(universeEntryFor(symbol), finnhub.get(symbol)));
  }

  const byKey = new Map<string, Fundamentals>();
  for (const f of [...brStocks, ...fiis, ...us]) byKey.set(fundamentalsKey(f.market, f.ticker), f);
  return { brStocks, fiis, us, byKey };
}

// ---- escrita (service role) -----------------------------------------------

async function upsertRows(admin: SupabaseClient, rows: Omit<CacheRow, "fetched_at">[], fetchedAt: string) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400).map((r) => ({ ...r, fetched_at: fetchedAt }));
    const { error } = await admin
      .from("fundamentals_cache")
      .upsert(chunk, { onConflict: "market,ticker,source" });
    if (error) throw new Error(`fundamentals_cache: ${error.message}`);
  }
}

async function markRefreshed(admin: SupabaseClient, source: string, count: number, note: string | null, at: string) {
  const { error } = await admin
    .from("source_refresh")
    .upsert({ source, refreshed_at: at, item_count: count, note }, { onConflict: "source" });
  if (error) throw new Error(`source_refresh: ${error.message}`);
}

export interface RefreshBrResult {
  stocks: number;
  fiis: number;
  brapiStocks: number;
  brapiFunds: number;
  errors: string[];
}

// Fundamentus (2 páginas) + lista da brapi (stock e fund). Cada fonte é
// independente: uma falhar não impede as outras.
export async function refreshBr(admin: SupabaseClient, brapiToken: string): Promise<RefreshBrResult> {
  const at = new Date().toISOString();
  const result: RefreshBrResult = { stocks: 0, fiis: 0, brapiStocks: 0, brapiFunds: 0, errors: [] };

  const [stocks, fiis, bStocks, bFunds] = await Promise.allSettled([
    fetchFundamentusStocks(),
    fetchFundamentusFiis(),
    brapiToken ? fetchBrapiList("stock", brapiToken) : Promise.reject(new Error("BRAPI_TOKEN não configurado")),
    brapiToken ? fetchBrapiList("fund", brapiToken) : Promise.reject(new Error("BRAPI_TOKEN não configurado")),
  ]);

  const rowsOf = <T extends { ticker?: string; stock?: string }>(items: T[], source: string) =>
    items.map((item) => ({
      market: "BR" as const,
      ticker: String(item.ticker ?? item.stock).toUpperCase(),
      source,
      payload: item as unknown as Record<string, unknown>,
    }));

  if (stocks.status === "fulfilled") {
    await upsertRows(admin, rowsOf(stocks.value, SOURCES.fundamentusStock), at);
    await markRefreshed(admin, SOURCES.fundamentusStock, stocks.value.length, null, at);
    result.stocks = stocks.value.length;
  } else result.errors.push(`Fundamentus ações: ${stocks.reason?.message ?? "erro"}`);

  if (fiis.status === "fulfilled") {
    await upsertRows(admin, rowsOf(fiis.value, SOURCES.fundamentusFii), at);
    await markRefreshed(admin, SOURCES.fundamentusFii, fiis.value.length, null, at);
    result.fiis = fiis.value.length;
  } else result.errors.push(`Fundamentus FIIs: ${fiis.reason?.message ?? "erro"}`);

  if (bStocks.status === "fulfilled") {
    await upsertRows(admin, rowsOf(bStocks.value, SOURCES.brapiStock), at);
    await markRefreshed(admin, SOURCES.brapiStock, bStocks.value.length, null, at);
    result.brapiStocks = bStocks.value.length;
  } else result.errors.push(`brapi lista ações: ${bStocks.reason?.message ?? "erro"}`);

  if (bFunds.status === "fulfilled") {
    await upsertRows(admin, rowsOf(bFunds.value, SOURCES.brapiFund), at);
    await markRefreshed(admin, SOURCES.brapiFund, bFunds.value.length, null, at);
    result.brapiFunds = bFunds.value.length;
  } else result.errors.push(`brapi lista fundos: ${bFunds.reason?.message ?? "erro"}`);

  return result;
}

export interface RefreshUsResult {
  fetched: number;
  failed: number;
  remaining: number;
  total: number;
  errors: string[];
}

// Finnhub, uma chamada por símbolo, ~1/s (grátis: 60/min). Atualiza primeiro
// quem nunca foi buscado, depois os mais antigos, até `limit` símbolos ou o
// `deadlineMs` (relógio de parede) acabar.
export async function refreshUs(
  admin: SupabaseClient,
  token: string,
  symbols: string[],
  existing: CacheRow[],
  { limit, deadlineMs }: { limit: number; deadlineMs: number },
): Promise<RefreshUsResult> {
  const started = Date.now();
  const staleBefore = new Date(Date.now() - US_TTL_DAYS * 86_400_000).toISOString();
  const fetchedAtBySymbol = new Map<string, string>();
  for (const r of existing) {
    if (r.market === "US" && r.source === SOURCES.finnhubMetric) fetchedAtBySymbol.set(r.ticker, r.fetched_at);
  }
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const pending = unique
    .filter((s) => (fetchedAtBySymbol.get(s) ?? "") < staleBefore)
    .sort((a, b) => (fetchedAtBySymbol.get(a) ?? "").localeCompare(fetchedAtBySymbol.get(b) ?? ""));

  const result: RefreshUsResult = { fetched: 0, failed: 0, remaining: pending.length, total: unique.length, errors: [] };
  if (!token) {
    result.errors.push("FINNHUB_TOKEN não configurado");
    return result;
  }

  const batch: Omit<CacheRow, "fetched_at">[] = [];
  for (const symbol of pending.slice(0, limit)) {
    if (Date.now() - started > deadlineMs) break;
    try {
      const payload = await fetchFinnhubMetrics(symbol, token);
      if (payload) {
        batch.push({ market: "US", ticker: symbol, source: SOURCES.finnhubMetric, payload: payload as unknown as Record<string, unknown> });
        result.fetched++;
      } else {
        result.failed++;
      }
    } catch (e) {
      result.failed++;
      result.errors.push(`${symbol}: ${e instanceof Error ? e.message : "erro"}`);
      if (/limite de chamadas/.test(String(e))) break;
    }
    await sleep(1050);
  }

  const at = new Date().toISOString();
  if (batch.length > 0) await upsertRows(admin, batch, at);
  result.remaining = pending.length - result.fetched;
  await markRefreshed(
    admin,
    SOURCES.finnhubMetric,
    unique.length - result.remaining,
    result.remaining > 0 ? `${result.remaining} pendentes` : null,
    at,
  );
  return result;
}

// Página de detalhe do Fundamentus para as posições atuais (ações e FIIs da B3).
export async function refreshDetails(
  admin: SupabaseClient,
  tickers: string[],
  existing: CacheRow[],
): Promise<{ fetched: number; errors: string[] }> {
  const staleBefore = new Date(Date.now() - DETAILS_TTL_DAYS * 86_400_000).toISOString();
  const fresh = new Set(
    existing
      .filter((r) => r.market === "BR" && r.source === SOURCES.fundamentusDetails && r.fetched_at >= staleBefore)
      .map((r) => r.ticker),
  );
  const pending = [...new Set(tickers.map((t) => t.toUpperCase()))].filter((t) => !fresh.has(t));
  const errors: string[] = [];
  const batch: Omit<CacheRow, "fetched_at">[] = [];
  for (const ticker of pending) {
    try {
      const details = await fetchFundamentusDetails(ticker);
      batch.push({ market: "BR", ticker, source: SOURCES.fundamentusDetails, payload: details as unknown as Record<string, unknown> });
    } catch (e) {
      errors.push(`${ticker}: ${e instanceof Error ? e.message : "erro"}`);
    }
    await sleep(300);
  }
  const at = new Date().toISOString();
  if (batch.length > 0) {
    await upsertRows(admin, batch, at);
    await markRefreshed(admin, SOURCES.fundamentusDetails, fresh.size + batch.length, null, at);
  }
  return { fetched: batch.length, errors };
}

export function isStale(status: SourceStatus | undefined, ttlDays: number): boolean {
  if (!status) return true;
  return Date.now() - new Date(status.refreshed_at).getTime() > ttlDays * 86_400_000;
}

// Rodada diária chamada pelo cron de preços: B3 quando vence o TTL, EUA em
// lote dentro do orçamento de tempo, detalhe das posições B3 de todos os
// usuários. Devolve um resumo para o JSON do cron.
export async function refreshFundamentalsDaily(
  admin: SupabaseClient,
  { brapiToken, finnhubToken, deadlineMs }: { brapiToken: string; finnhubToken: string; deadlineMs: number },
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const data = await loadFundamentalsData(admin);
  if (!data.ready) return { skipped: `rode ${MIGRATION_FILE_0009}` };

  const summary: Record<string, unknown> = {};
  const brStale = [SOURCES.fundamentusStock, SOURCES.fundamentusFii, SOURCES.brapiStock].some((s) =>
    isStale(data.status.get(s), BR_TTL_DAYS - 1),
  );
  if (brStale) {
    try {
      summary.br = await refreshBr(admin, brapiToken);
    } catch (e) {
      summary.br = { error: e instanceof Error ? e.message : "erro" };
    }
  }

  const { data: held } = await admin
    .from("assets")
    .select("asset_classes(slug), market_instruments(ticker)");
  const brHeld: string[] = [];
  const usHeld: string[] = [];
  for (const row of (held ?? []) as unknown as {
    asset_classes: { slug: string } | null;
    market_instruments: { ticker: string | null } | null;
  }[]) {
    const ticker = row.market_instruments?.ticker?.toUpperCase();
    const slug = row.asset_classes?.slug;
    if (!ticker) continue;
    if (slug === "bolsa_eua") usHeld.push(ticker);
    else if (slug === "acoes" || slug === "fiis") brHeld.push(ticker);
  }

  const remaining = deadlineMs - (Date.now() - started);
  if (finnhubToken && remaining > 15_000) {
    try {
      summary.us = await refreshUs(
        admin,
        finnhubToken,
        [...US_UNIVERSE.map((e) => e.symbol), ...usHeld],
        data.rows,
        { limit: 150, deadlineMs: remaining - 10_000 },
      );
    } catch (e) {
      summary.us = { error: e instanceof Error ? e.message : "erro" };
    }
  }

  if (brHeld.length > 0 && deadlineMs - (Date.now() - started) > 10_000) {
    try {
      summary.details = await refreshDetails(admin, brHeld, data.rows);
    } catch (e) {
      summary.details = { error: e instanceof Error ? e.message : "erro" };
    }
  }
  summary.elapsedMs = Date.now() - started;
  return summary;
}
