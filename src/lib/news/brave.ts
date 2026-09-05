import type { NewsHeadline, NewsTarget } from "@/lib/consultor/types";
import { NEWS_LOOKBACK_DAYS, searchName } from "./google-news";

// Brave News Search (opcional: precisa de BRAVE_API_KEY; US$ 5 por mil
// consultas com US$ 5 de crédito grátis por mês). Complementa o Google News.

interface BraveResult {
  title?: string;
  url?: string;
  page_age?: string;
  age?: string;
  meta_url?: { hostname?: string };
}

export async function fetchBraveNews(target: NewsTarget, apiKey: string): Promise<NewsHeadline[]> {
  const name = searchName(target.name);
  const q = target.market === "BR" ? `${target.ticker} ${name ?? ""}`.trim() : `${name ?? target.ticker} stock`;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date();
  const from = new Date(to.getTime() - NEWS_LOOKBACK_DAYS * 86_400_000);
  const params = new URLSearchParams({
    q,
    count: "20",
    freshness: `${fmt(from)}to${fmt(to)}`,
    search_lang: target.market === "BR" ? "pt-br" : "en",
    country: target.market === "BR" ? "BR" : "US",
  });
  const res = await fetch(`https://api.search.brave.com/res/v1/news/search?${params.toString()}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`brave news ${target.ticker}: HTTP ${res.status}`);
  const data = (await res.json()) as { results?: BraveResult[] };
  return (data.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: String(r.title),
      url: String(r.url),
      source: r.meta_url?.hostname ?? null,
      publishedAt: r.page_age ?? null,
    }));
}
