// Fundamentus (fundamentus.com.br): tabelas HTML em latin1, sem API.
// resultado.php traz ~1000 ações com 22 indicadores; fii_resultado.php ~560
// FIIs com 14 colunas; detalhes.php?papel=X traz ~58 campos de uma empresa.
// Se o layout mudar, os parsers falham com erro explícito em vez de devolver
// números errados.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const BASE = "https://www.fundamentus.com.br";

async function fetchLatin1(path: string): Promise<string> {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`fundamentus ${path}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  return new TextDecoder("latin1").decode(buffer);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// "1.234,56" -> 1234.56; "12,3%" -> 12.3; "-" ou vazio -> null
export function parseBrNumber(raw: string): number | null {
  const s = raw.replace(/%/g, "").replace(/\./g, "").replace(",", ".").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

// Linhas de dados: primeira célula é um link para detalhes.php?papel=XXXX
function parseTable(html: string): { headers: string[]; rows: string[][] } {
  const headers = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]));
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (!/detalhes\.php\?papel=/i.test(tr[1])) continue;
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    if (cells.length >= 3) rows.push(cells);
  }
  return { headers, rows };
}

function columnIndex(headers: string[], wanted: Record<string, string>): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const [field, header] of Object.entries(wanted)) {
    const i = normalized.indexOf(normalizeHeader(header));
    if (i === -1) missing.push(header);
    else index[field] = i;
  }
  if (missing.length > 0) {
    throw new Error(`fundamentus: layout mudou, colunas não encontradas: ${missing.join(", ")}`);
  }
  return index;
}

export interface FundamentusStockRow {
  ticker: string;
  price: number | null;
  pe: number | null;
  pb: number | null;
  psr: number | null;
  dy: number | null;
  pEbit: number | null;
  evEbit: number | null;
  evEbitda: number | null;
  grossMargin: number | null;
  ebitMargin: number | null;
  netMargin: number | null;
  currentRatio: number | null;
  roic: number | null;
  roe: number | null;
  /** volume médio diário dos últimos 2 meses, em R$ */
  liquidity: number | null;
  equity: number | null;
  netDebtToEquity: number | null;
  revenueGrowth5y: number | null;
}

const STOCK_COLUMNS: Record<keyof FundamentusStockRow, string> = {
  ticker: "Papel",
  price: "Cotação",
  pe: "P/L",
  pb: "P/VP",
  psr: "PSR",
  dy: "Div.Yield",
  pEbit: "P/EBIT",
  evEbit: "EV/EBIT",
  evEbitda: "EV/EBITDA",
  grossMargin: "Mrg Bruta",
  ebitMargin: "Mrg Ebit",
  netMargin: "Mrg. Líq.",
  currentRatio: "Liq. Corr.",
  roic: "ROIC",
  roe: "ROE",
  liquidity: "Liq.2meses",
  equity: "Patrim. Líq",
  netDebtToEquity: "Dív.Líq/ Patrim.",
  revenueGrowth5y: "Cresc. Rec.5a",
};

export async function fetchFundamentusStocks(): Promise<FundamentusStockRow[]> {
  const html = await fetchLatin1("resultado.php");
  const { headers, rows } = parseTable(html);
  const idx = columnIndex(headers, STOCK_COLUMNS);
  const out: FundamentusStockRow[] = [];
  for (const cells of rows) {
    const ticker = cells[idx.ticker]?.toUpperCase();
    if (!ticker) continue;
    const num = (field: keyof FundamentusStockRow) => parseBrNumber(cells[idx[field]] ?? "");
    out.push({
      ticker,
      price: num("price"),
      pe: num("pe"),
      pb: num("pb"),
      psr: num("psr"),
      dy: num("dy"),
      pEbit: num("pEbit"),
      evEbit: num("evEbit"),
      evEbitda: num("evEbitda"),
      grossMargin: num("grossMargin"),
      ebitMargin: num("ebitMargin"),
      netMargin: num("netMargin"),
      currentRatio: num("currentRatio"),
      roic: num("roic"),
      roe: num("roe"),
      liquidity: num("liquidity"),
      equity: num("equity"),
      netDebtToEquity: num("netDebtToEquity"),
      revenueGrowth5y: num("revenueGrowth5y"),
    });
  }
  if (out.length < 300) throw new Error(`fundamentus: só ${out.length} ações, esperado ~1000`);
  return out;
}

export interface FundamentusFiiRow {
  ticker: string;
  segment: string | null;
  price: number | null;
  ffoYield: number | null;
  dy: number | null;
  pb: number | null;
  marketCap: number | null;
  /** volume médio diário, em R$ */
  liquidity: number | null;
  properties: number | null;
  capRate: number | null;
  vacancy: number | null;
}

const FII_COLUMNS: Record<keyof FundamentusFiiRow, string> = {
  ticker: "Papel",
  segment: "Segmento",
  price: "Cotação",
  ffoYield: "FFO Yield",
  dy: "Dividend Yield",
  pb: "P/VP",
  marketCap: "Valor de Mercado",
  liquidity: "Liquidez",
  properties: "Qtd de imóveis",
  capRate: "Cap Rate",
  vacancy: "Vacância Média",
};

export async function fetchFundamentusFiis(): Promise<FundamentusFiiRow[]> {
  const html = await fetchLatin1("fii_resultado.php");
  const { headers, rows } = parseTable(html);
  const idx = columnIndex(headers, FII_COLUMNS);
  const out: FundamentusFiiRow[] = [];
  for (const cells of rows) {
    const ticker = cells[idx.ticker]?.toUpperCase();
    if (!ticker) continue;
    const num = (field: keyof FundamentusFiiRow) => parseBrNumber(cells[idx[field]] ?? "");
    out.push({
      ticker,
      segment: cells[idx.segment]?.trim() || null,
      price: num("price"),
      ffoYield: num("ffoYield"),
      dy: num("dy"),
      pb: num("pb"),
      marketCap: num("marketCap"),
      liquidity: num("liquidity"),
      properties: num("properties"),
      capRate: num("capRate"),
      vacancy: num("vacancy"),
    });
  }
  if (out.length < 200) throw new Error(`fundamentus: só ${out.length} FIIs, esperado ~500`);
  return out;
}

// Página de uma empresa: pares label/valor. Alguns rótulos aparecem duas vezes
// (12 meses e depois 3 meses), por isso a segunda ocorrência ganha sufixo _3m.
export interface FundamentusDetails {
  ticker: string;
  sector: string | null;
  subsector: string | null;
  marketCap: number | null;
  shares: number | null;
  avgVolume2m: number | null;
  revenue12m: number | null;
  ebit12m: number | null;
  netIncome12m: number | null;
  revenue3m: number | null;
  netIncome3m: number | null;
  grossDebt: number | null;
  netDebt: number | null;
  equity: number | null;
  raw: Record<string, string>;
}

export async function fetchFundamentusDetails(ticker: string): Promise<FundamentusDetails> {
  const html = await fetchLatin1(`detalhes.php?papel=${encodeURIComponent(ticker)}`);
  const pairs = [
    ...html.matchAll(
      /<td class="label[^"]*"[^>]*>([\s\S]*?)<\/td>\s*<td class="data[^"]*"[^>]*>([\s\S]*?)<\/td>/gi,
    ),
  ].map((m) => [stripTags(m[1]).replace(/^\?/, ""), stripTags(m[2])] as const);
  if (pairs.length < 20) throw new Error(`fundamentus detalhes ${ticker}: página sem dados`);

  const raw: Record<string, string> = {};
  for (const [label, value] of pairs) {
    if (!label) continue;
    if (label in raw) {
      if (!(`${label}_3m` in raw)) raw[`${label}_3m`] = value;
    } else raw[label] = value;
  }
  const num = (label: string) => (label in raw ? parseBrNumber(raw[label]) : null);

  return {
    ticker: ticker.toUpperCase(),
    sector: raw["Setor"] || null,
    subsector: raw["Subsetor"] || null,
    marketCap: num("Valor de mercado"),
    shares: num("Nro. Ações"),
    avgVolume2m: num("Vol $ méd (2m)"),
    revenue12m: num("Receita Líquida"),
    ebit12m: num("EBIT"),
    netIncome12m: num("Lucro Líquido"),
    revenue3m: num("Receita Líquida_3m"),
    netIncome3m: num("Lucro Líquido_3m"),
    grossDebt: num("Dív. Bruta"),
    netDebt: num("Dív. Líquida"),
    equity: num("Patrim. Líq"),
    raw,
  };
}
