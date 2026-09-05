import sp500 from "@/data/sp500.json";

// Universo americano: S&P 500 (lista estática, atualizar trimestralmente com
// o script em docs) + ETFs curados + ADRs de exposição fora dos EUA. Os
// ativos que o usuário já tem entram sempre, mesmo fora destas listas.

export interface UsUniverseEntry {
  symbol: string;
  name: string;
  sector: string | null;
  subIndustry: string | null;
  kind: "stock" | "etf" | "adr";
  /** exposição econômica: decide a categoria do consultor */
  exposure: "us" | "intl";
}

const US_ETFS: UsUniverseEntry[] = [
  ["VOO", "Vanguard S&P 500 ETF"],
  ["VTI", "Vanguard Total Stock Market ETF"],
  ["IVV", "iShares Core S&P 500 ETF"],
  ["QQQ", "Invesco QQQ Trust"],
  ["SCHD", "Schwab US Dividend Equity ETF"],
  ["VIG", "Vanguard Dividend Appreciation ETF"],
  ["VUG", "Vanguard Growth ETF"],
  ["VTV", "Vanguard Value ETF"],
].map(([symbol, name]) => ({
  symbol,
  name,
  sector: "ETF",
  subIndustry: null,
  kind: "etf" as const,
  exposure: "us" as const,
}));

const INTL_ETFS: UsUniverseEntry[] = [
  ["VXUS", "Vanguard Total International Stock ETF"],
  ["VEA", "Vanguard FTSE Developed Markets ETF"],
  ["VWO", "Vanguard FTSE Emerging Markets ETF"],
  ["IEMG", "iShares Core MSCI Emerging Markets ETF"],
  ["IEFA", "iShares Core MSCI EAFE ETF"],
  ["EFA", "iShares MSCI EAFE ETF"],
  ["IXUS", "iShares Core MSCI Total International Stock ETF"],
  ["VEU", "Vanguard FTSE All-World ex-US ETF"],
  ["ACWX", "iShares MSCI ACWI ex U.S. ETF"],
  ["EEM", "iShares MSCI Emerging Markets ETF"],
].map(([symbol, name]) => ({
  symbol,
  name,
  sector: "ETF",
  subIndustry: null,
  kind: "etf" as const,
  exposure: "intl" as const,
}));

const INTL_ADRS: UsUniverseEntry[] = (
  [
    ["TSM", "Taiwan Semiconductor", "Information Technology"],
    ["ASML", "ASML Holding", "Information Technology"],
    ["SAP", "SAP SE", "Information Technology"],
    ["NVO", "Novo Nordisk", "Health Care"],
    ["AZN", "AstraZeneca", "Health Care"],
    ["NVS", "Novartis", "Health Care"],
    ["TM", "Toyota Motor", "Consumer Discretionary"],
    ["SONY", "Sony Group", "Consumer Discretionary"],
    ["MELI", "MercadoLibre", "Consumer Discretionary"],
    ["BABA", "Alibaba Group", "Consumer Discretionary"],
    ["SHOP", "Shopify", "Information Technology"],
    ["NU", "Nu Holdings", "Financials"],
    ["HSBC", "HSBC Holdings", "Financials"],
    ["UL", "Unilever", "Consumer Staples"],
    ["NSRGY", "Nestlé", "Consumer Staples"],
    ["BHP", "BHP Group", "Materials"],
    ["RIO", "Rio Tinto", "Materials"],
    ["SHEL", "Shell", "Energy"],
    ["TTE", "TotalEnergies", "Energy"],
    ["LVMUY", "LVMH", "Consumer Discretionary"],
  ] as const
).map(([symbol, name, sector]) => ({
  symbol,
  name,
  sector,
  subIndustry: null,
  kind: "adr" as const,
  exposure: "intl" as const,
}));

interface Sp500File {
  source: string;
  fetchedAt: string;
  items: { symbol: string; name: string; sector: string; subIndustry: string }[];
}

const SP500: UsUniverseEntry[] = (sp500 as Sp500File).items.map((i) => ({
  symbol: i.symbol,
  name: i.name,
  sector: i.sector,
  subIndustry: i.subIndustry,
  kind: "stock" as const,
  exposure: "us" as const,
}));

export const US_UNIVERSE: UsUniverseEntry[] = [...SP500, ...US_ETFS, ...INTL_ETFS, ...INTL_ADRS];
export const US_UNIVERSE_BY_SYMBOL = new Map(US_UNIVERSE.map((e) => [e.symbol, e]));
export const SP500_FETCHED_AT = (sp500 as Sp500File).fetchedAt;

// Ativo americano que o usuário tem mas não está nas listas: entra como ação
// de exposição EUA, sem setor (a Finnhub não dá setor no grátis sem outra chamada).
export function universeEntryFor(symbol: string): UsUniverseEntry {
  return (
    US_UNIVERSE_BY_SYMBOL.get(symbol) ?? {
      symbol,
      name: symbol,
      sector: null,
      subIndustry: null,
      kind: "stock",
      exposure: "us",
    }
  );
}
