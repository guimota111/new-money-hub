// Finnhub /stock/metric (plano grátis): múltiplos e rentabilidade TTM mais
// série anual de ~6 anos (EPS, margem, ROE, dívida/PL). Guardamos só as chaves
// usadas para o payload no cache ficar pequeno. ETF ou símbolo desconhecido
// voltam metric vazio.

const METRIC_KEYS = [
  "marketCapitalization",
  "peBasicExclExtraTTM",
  "pbQuarterly",
  "pbAnnual",
  "psTTM",
  "roeTTM",
  "roiTTM",
  "netProfitMarginTTM",
  "grossMarginTTM",
  "operatingMarginTTM",
  "revenueGrowth5Y",
  "revenueGrowth3Y",
  "revenueGrowthTTMYoy",
  "epsGrowth5Y",
  "epsGrowth3Y",
  "epsGrowthTTMYoy",
  "dividendYieldIndicatedAnnual",
  "currentDividendYieldTTM",
  "payoutRatioTTM",
  "currentRatioQuarterly",
  "totalDebt/totalEquityQuarterly",
  "totalDebt/totalEquityAnnual",
  "epsTTM",
  "beta",
  "3MonthAverageTradingVolume",
  "52WeekHigh",
  "52WeekLow",
  "enterpriseValue",
] as const;

export interface FinnhubAnnualRow {
  period: string;
  eps: number | null;
  netMargin: number | null;
  roe: number | null;
  totalDebtToEquity: number | null;
  pe: number | null;
  pb: number | null;
}

export interface FinnhubMetricPayload {
  symbol: string;
  /** true para ETF ou símbolo sem cobertura */
  empty: boolean;
  metric: Record<string, number | null>;
  annual: FinnhubAnnualRow[];
}

interface SeriesPoint {
  period: string;
  v: number;
}

function seriesMap(series: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(series)) return out;
  for (const p of series as SeriesPoint[]) {
    if (p && typeof p.period === "string" && typeof p.v === "number") out.set(p.period, p.v);
  }
  return out;
}

export async function fetchFinnhubMetrics(
  symbol: string,
  token: string,
): Promise<FinnhubMetricPayload | null> {
  const res = await fetch(
    `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`,
    { headers: { "X-Finnhub-Token": token }, cache: "no-store" },
  );
  if (res.status === 429) throw new Error("finnhub: limite de chamadas por minuto");
  if (!res.ok) return null;
  const data = await res.json();
  const raw = (data?.metric ?? {}) as Record<string, unknown>;

  const metric: Record<string, number | null> = {};
  for (const key of METRIC_KEYS) {
    const v = raw[key];
    metric[key] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  const annualRaw = (data?.series?.annual ?? {}) as Record<string, unknown>;
  const eps = seriesMap(annualRaw.eps);
  const netMargin = seriesMap(annualRaw.netMargin);
  const roe = seriesMap(annualRaw.roe);
  const debt = seriesMap(annualRaw.totalDebtToEquity);
  const pe = seriesMap(annualRaw.pe);
  const pb = seriesMap(annualRaw.pb);
  const periods = [...new Set([...eps.keys(), ...netMargin.keys(), ...roe.keys()])].sort().reverse();
  const annual: FinnhubAnnualRow[] = periods.slice(0, 8).map((period) => ({
    period,
    eps: eps.get(period) ?? null,
    netMargin: netMargin.get(period) ?? null,
    roe: roe.get(period) ?? null,
    totalDebtToEquity: debt.get(period) ?? null,
    pe: pe.get(period) ?? null,
    pb: pb.get(period) ?? null,
  }));

  // ETF/desconhecido: só beta, volume e faixa de 52 semanas, sem fundamentos
  const empty = metric.marketCapitalization == null && metric.peBasicExclExtraTTM == null && annual.length === 0;

  return { symbol: symbol.toUpperCase(), empty, metric, annual };
}
