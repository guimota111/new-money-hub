import type { BrapiListItem } from "./brapi-list";
import type { FinnhubMetricPayload } from "./finnhub";
import type { FundamentusDetails, FundamentusFiiRow, FundamentusStockRow } from "./fundamentus";
import { emptyFundamentals, SOURCES, type Fundamentals } from "./types";
import type { UsUniverseEntry } from "./universe";

// Junta os payloads das fontes num Fundamentals só. Cada função recebe o que
// existir (qualquer fonte pode estar ausente) e preenche o que der.

function oldest(...dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d)).sort();
  return valid[0] ?? null;
}

export function normalizeBrStock(
  ticker: string,
  fundamentus: { row: FundamentusStockRow; fetchedAt: string } | undefined,
  brapi: { row: BrapiListItem; fetchedAt: string } | undefined,
  details: { row: FundamentusDetails; fetchedAt: string } | undefined,
): Fundamentals {
  const f = emptyFundamentals(ticker, "BR", "stock");
  if (brapi) {
    f.name = brapi.row.name;
    f.sector = brapi.row.sector;
    f.subsector = brapi.row.subsector;
    f.marketCap = brapi.row.market_cap;
    f.price = brapi.row.close;
    f.sources.push(SOURCES.brapiStock);
  }
  if (fundamentus) {
    const r = fundamentus.row;
    f.price = r.price ?? f.price;
    f.liquidity = r.liquidity;
    f.pe = r.pe;
    f.pb = r.pb;
    f.psr = r.psr;
    f.evEbitda = r.evEbitda;
    f.dy = r.dy;
    f.roe = r.roe;
    f.roic = r.roic;
    f.grossMargin = r.grossMargin;
    f.ebitMargin = r.ebitMargin;
    f.netMargin = r.netMargin;
    f.netDebtToEquity = r.netDebtToEquity;
    f.currentRatio = r.currentRatio;
    f.revenueGrowth5y = r.revenueGrowth5y;
    f.equity = r.equity;
    f.sources.push(SOURCES.fundamentusStock);
  }
  if (details) {
    const d = details.row;
    f.sector = f.sector ?? d.sector;
    f.subsector = f.subsector ?? d.subsector;
    f.marketCap = f.marketCap ?? d.marketCap;
    f.equity = f.equity ?? d.equity;
    f.sources.push(SOURCES.fundamentusDetails);
  }
  f.fetchedAt = oldest(fundamentus?.fetchedAt, brapi?.fetchedAt);
  return f;
}

export function normalizeFii(
  ticker: string,
  fundamentus: { row: FundamentusFiiRow; fetchedAt: string } | undefined,
  brapi: { row: BrapiListItem; fetchedAt: string } | undefined,
): Fundamentals {
  const f = emptyFundamentals(ticker, "BR", "fii");
  f.sector = "Fundos Imobiliários";
  if (brapi) {
    f.name = brapi.row.name !== brapi.row.stock ? brapi.row.name : null;
    f.sources.push(SOURCES.brapiFund);
  }
  if (fundamentus) {
    const r = fundamentus.row;
    f.segment = r.segment;
    f.subsector = r.segment;
    f.price = r.price;
    f.dy = r.dy;
    f.pb = r.pb;
    f.ffoYield = r.ffoYield;
    f.capRate = r.capRate;
    f.vacancy = r.vacancy;
    f.properties = r.properties;
    f.marketCap = r.marketCap;
    f.liquidity = r.liquidity;
    f.sources.push(SOURCES.fundamentusFii);
  }
  f.fetchedAt = oldest(fundamentus?.fetchedAt, brapi?.fetchedAt);
  return f;
}

export function normalizeUs(
  entry: UsUniverseEntry,
  finnhub: { row: FinnhubMetricPayload; fetchedAt: string } | undefined,
): Fundamentals {
  const f = emptyFundamentals(entry.symbol, "US", entry.kind);
  f.name = entry.name;
  f.sector = entry.sector;
  f.subsector = entry.subIndustry;
  if (finnhub && !finnhub.row.empty) {
    const m = finnhub.row.metric;
    // marketCapitalization vem em milhões de US$
    f.marketCap = m.marketCapitalization != null ? m.marketCapitalization * 1e6 : null;
    f.pe = m.peBasicExclExtraTTM;
    f.pb = m.pbQuarterly ?? m.pbAnnual;
    f.psr = m.psTTM;
    f.dy = m.dividendYieldIndicatedAnnual ?? m.currentDividendYieldTTM;
    f.roe = m.roeTTM;
    f.roic = m.roiTTM;
    f.grossMargin = m.grossMarginTTM;
    f.ebitMargin = m.operatingMarginTTM;
    f.netMargin = m.netProfitMarginTTM;
    // Finnhub dá dívida total / PL (não líquida); é o que existe no grátis
    f.netDebtToEquity = m["totalDebt/totalEquityQuarterly"] ?? m["totalDebt/totalEquityAnnual"];
    f.currentRatio = m.currentRatioQuarterly;
    f.revenueGrowth5y = m.revenueGrowth5Y ?? m.revenueGrowth3Y;
    f.earningsGrowth = m.epsGrowth5Y ?? m.epsGrowth3Y;
    f.annual = finnhub.row.annual.map((a) => ({
      period: a.period,
      eps: a.eps,
      netMargin: a.netMargin != null ? a.netMargin * 100 : null,
      roe: a.roe != null ? a.roe * 100 : null,
      debtToEquity: a.totalDebtToEquity,
    }));
    f.sources.push(SOURCES.finnhubMetric);
    f.fetchedAt = finnhub.fetchedAt;
  } else if (finnhub) {
    f.sources.push(SOURCES.finnhubMetric);
    f.fetchedAt = finnhub.fetchedAt;
  }
  return f;
}
