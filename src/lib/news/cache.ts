import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewsHeadline, NewsTarget, NewsVerdict } from "@/lib/consultor/types";
import { isMissingTableError } from "@/lib/supabase/errors";
import { fetchBraveNews } from "./brave";
import { fetchGoogleNews } from "./google-news";

// Cache de manchetes e vereditos por ativo (7 dias). Leitura com o client do
// usuário; escrita com service role.

export const NEWS_TTL_DAYS = 7;
export const MIGRATION_FILE_0011 = "supabase/migrations/0011_news_cache.sql";

export interface NewsCacheRow {
  market: "BR" | "US";
  ticker: string;
  items: NewsHeadline[];
  fetched_at: string;
  verdict: Omit<NewsVerdict, "headlines" | "cached"> | null;
  verdict_at: string | null;
}

export function newsKey(market: string, ticker: string): string {
  return `${market}:${ticker.toUpperCase()}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fresh(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < NEWS_TTL_DAYS * 86_400_000;
}

export async function loadNewsCache(
  supabase: SupabaseClient,
  targets: NewsTarget[],
): Promise<{ ready: boolean; rows: Map<string, NewsCacheRow> }> {
  const rows = new Map<string, NewsCacheRow>();
  if (targets.length === 0) {
    const probe = await supabase.from("news_cache").select("ticker").limit(1);
    return { ready: !isMissingTableError(probe.error), rows };
  }
  const tickers = [...new Set(targets.map((t) => t.ticker.toUpperCase()))];
  const { data, error } = await supabase
    .from("news_cache")
    .select("market, ticker, items, fetched_at, verdict, verdict_at")
    .in("ticker", tickers);
  if (isMissingTableError(error)) return { ready: false, rows };
  for (const r of (data ?? []) as NewsCacheRow[]) rows.set(newsKey(r.market, r.ticker), r);
  return { ready: true, rows };
}

function mergeHeadlines(a: NewsHeadline[], b: NewsHeadline[], limit = 25): NewsHeadline[] {
  const seen = new Set<string>();
  const out: NewsHeadline[] = [];
  for (const h of [...a, ...b]) {
    const key = h.title.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  out.sort((x, y) => (y.publishedAt ?? "").localeCompare(x.publishedAt ?? ""));
  return out.slice(0, limit);
}

export interface HeadlinesResult {
  /** chave → manchetes */
  headlines: Map<string, NewsHeadline[]>;
  /** chaves com veredito ainda válido no cache */
  cachedVerdicts: Map<string, NewsCacheRow["verdict"]>;
  errors: string[];
}

// Usa o cache quando as manchetes têm menos de 7 dias; senão busca (Google
// News e, com chave, Brave) e grava. Vereditos válidos vêm junto para poupar IA.
export async function collectHeadlines(
  admin: SupabaseClient,
  targets: NewsTarget[],
  cache: Map<string, NewsCacheRow>,
): Promise<HeadlinesResult> {
  const braveKey = process.env.BRAVE_API_KEY ?? "";
  const result: HeadlinesResult = { headlines: new Map(), cachedVerdicts: new Map(), errors: [] };
  const toUpsert: { market: string; ticker: string; items: NewsHeadline[]; fetched_at: string }[] = [];
  const now = new Date().toISOString();

  for (const target of targets) {
    const key = newsKey(target.market, target.ticker);
    const row = cache.get(key);
    if (row && fresh(row.fetched_at)) {
      result.headlines.set(key, row.items ?? []);
      if (row.verdict && fresh(row.verdict_at)) result.cachedVerdicts.set(key, row.verdict);
      continue;
    }
    let items: NewsHeadline[] = [];
    try {
      items = await fetchGoogleNews(target);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : `google news ${target.ticker}`);
    }
    if (braveKey) {
      try {
        items = mergeHeadlines(items, await fetchBraveNews(target, braveKey));
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : `brave ${target.ticker}`);
      }
    }
    result.headlines.set(key, items);
    toUpsert.push({ market: target.market, ticker: target.ticker.toUpperCase(), items, fetched_at: now });
    await sleep(250);
  }

  if (toUpsert.length > 0) {
    // upsert só das colunas de manchete: o veredito antigo fica até ser refeito
    const { error } = await admin.from("news_cache").upsert(toUpsert, { onConflict: "market,ticker" });
    if (error) result.errors.push(`news_cache: ${error.message}`);
  }
  return result;
}

export async function saveVerdicts(
  admin: SupabaseClient,
  verdicts: Map<string, NewsVerdict>,
): Promise<void> {
  const now = new Date().toISOString();
  const rows = [...verdicts.entries()].map(([key, v]) => {
    const [market, ticker] = key.split(":");
    return {
      market,
      ticker,
      verdict: { level: v.level, recurring: v.recurring, summary: v.summary, themes: v.themes },
      verdict_at: now,
    };
  });
  if (rows.length === 0) return;
  // a linha já existe (collectHeadlines gravou as manchetes), então só atualiza
  for (const row of rows) {
    await admin
      .from("news_cache")
      .update({ verdict: row.verdict, verdict_at: row.verdict_at })
      .eq("market", row.market)
      .eq("ticker", row.ticker);
  }
}
