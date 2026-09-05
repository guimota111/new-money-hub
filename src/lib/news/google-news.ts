import type { NewsHeadline, NewsTarget } from "@/lib/consultor/types";

// Google News RSS: sem chave, aceita o operador when:Nd para janela de tempo.
// Devolve até 100 itens por consulta; ficamos com os mais recentes.

export const NEWS_LOOKBACK_DAYS = 180;

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

export function parseGoogleNewsRss(xml: string, limit = 25): NewsHeadline[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const seen = new Set<string>();
  const out: NewsHeadline[] = [];
  for (const item of items) {
    let title = tag(item, "title");
    const url = tag(item, "link");
    const source = tag(item, "source");
    const pub = tag(item, "pubDate");
    if (!title || !url) continue;
    // o título do Google vem como "Manchete - Veículo"
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const key = title.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    const date = pub ? new Date(pub) : null;
    out.push({
      title,
      url,
      source: source ?? null,
      publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    });
  }
  out.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return out.slice(0, limit);
}

// Nome curto para a busca: tira sufixos societários e classes de ação.
export function searchName(name: string | null): string | null {
  if (!name) return null;
  const cleaned = name
    .replace(/\b(S\.?\s?A\.?|S\/A|LTDA\.?|CIA\.?|COMPANHIA|HOLDING|PARTICIPA[ÇC][ÕO]ES|ON|PN|PNA|PNB|UNT|N1|N2|NM|ETF|FII|FUNDO DE INVESTIMENTO IMOBILI[ÁA]RIO)\b/gi, " ")
    .replace(/[.,;:()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "WEG", "BHP" são nomes reais; abaixo de 3 letras vira ruído
  return cleaned.length >= 3 ? cleaned : null;
}

export function googleNewsUrl(target: NewsTarget): string {
  const name = searchName(target.name);
  const params = new URLSearchParams();
  if (target.market === "BR") {
    const q = name ? `${target.ticker} OR "${name}"` : target.ticker;
    params.set("q", `${q} when:${NEWS_LOOKBACK_DAYS}d`);
    params.set("hl", "pt-BR");
    params.set("gl", "BR");
    params.set("ceid", "BR:pt-419");
  } else {
    const q = name ? `"${name}" OR ${target.ticker} stock` : `${target.ticker} stock`;
    params.set("q", `${q} when:${NEWS_LOOKBACK_DAYS}d`);
    params.set("hl", "en-US");
    params.set("gl", "US");
    params.set("ceid", "US:en");
  }
  return `https://news.google.com/rss/search?${params.toString()}`;
}

export async function fetchGoogleNews(target: NewsTarget): Promise<NewsHeadline[]> {
  const res = await fetch(googleNewsUrl(target), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; new-money-hub/1.0)" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`google news ${target.ticker}: HTTP ${res.status}`);
  return parseGoogleNewsRss(await res.text());
}
