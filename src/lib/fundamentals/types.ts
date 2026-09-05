// Fundamentos normalizados — a mesma forma para B3 (Fundamentus + brapi) e
// EUA (Finnhub), para o pré-filtro e a IA lerem uma tabela só.
// Percentuais em pontos percentuais (12,3 = 12,3%). Valores absolutos na
// moeda do ativo (BRL ou USD).

export type Market = "BR" | "US";
export type InstrumentKind = "stock" | "fii" | "etf" | "adr";

export interface Fundamentals {
  ticker: string;
  market: Market;
  kind: InstrumentKind;
  currency: "BRL" | "USD";
  name: string | null;
  sector: string | null;
  subsector: string | null;

  price: number | null;
  marketCap: number | null;
  /** volume médio diário negociado, na moeda do ativo */
  liquidity: number | null;

  pe: number | null;
  pb: number | null;
  psr: number | null;
  evEbitda: number | null;
  dy: number | null;
  roe: number | null;
  roic: number | null;
  grossMargin: number | null;
  ebitMargin: number | null;
  netMargin: number | null;
  /** dívida líquida / patrimônio líquido (múltiplo, não %) */
  netDebtToEquity: number | null;
  currentRatio: number | null;
  revenueGrowth5y: number | null;
  /** crescimento do lucro (EUA: EPS 5 anos; BR: não disponível na foto atual) */
  earningsGrowth: number | null;
  /** patrimônio líquido */
  equity: number | null;

  // só FII
  segment: string | null;
  ffoYield: number | null;
  capRate: number | null;
  vacancy: number | null;
  properties: number | null;

  /** histórico anual (mais recente primeiro) quando a fonte dá — hoje só EUA */
  annual: AnnualPoint[] | null;

  sources: string[];
  /** mais antigo entre os payloads usados */
  fetchedAt: string | null;
}

export interface AnnualPoint {
  /** fim do exercício, yyyy-mm-dd */
  period: string;
  eps: number | null;
  /** fração (0,27 = 27%) na fonte; aqui em % */
  netMargin: number | null;
  roe: number | null;
  debtToEquity: number | null;
}

export function emptyFundamentals(
  ticker: string,
  market: Market,
  kind: InstrumentKind,
): Fundamentals {
  return {
    ticker,
    market,
    kind,
    currency: market === "BR" ? "BRL" : "USD",
    name: null,
    sector: null,
    subsector: null,
    price: null,
    marketCap: null,
    liquidity: null,
    pe: null,
    pb: null,
    psr: null,
    evEbitda: null,
    dy: null,
    roe: null,
    roic: null,
    grossMargin: null,
    ebitMargin: null,
    netMargin: null,
    netDebtToEquity: null,
    currentRatio: null,
    revenueGrowth5y: null,
    earningsGrowth: null,
    equity: null,
    segment: null,
    ffoYield: null,
    capRate: null,
    vacancy: null,
    properties: null,
    annual: null,
    sources: [],
    fetchedAt: null,
  };
}

// Linha do cache: payload bruto de uma fonte para um ativo.
export interface CacheRow {
  market: Market;
  ticker: string;
  source: string;
  payload: Record<string, unknown>;
  fetched_at: string;
}

export const SOURCES = {
  fundamentusStock: "fundamentus_stock",
  fundamentusFii: "fundamentus_fii",
  fundamentusDetails: "fundamentus_details",
  brapiStock: "brapi_stock",
  brapiFund: "brapi_fund",
  finnhubMetric: "finnhub_metric",
} as const;

export type Source = (typeof SOURCES)[keyof typeof SOURCES];
