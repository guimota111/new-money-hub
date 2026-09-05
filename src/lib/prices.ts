// Busca de cotações nas APIs externas (server-only).
// brapi.dev: ações/FIIs da B3 (exige token, plano grátis serve para cotação).
// Tesouro Transparente: PU dos títulos do Tesouro (CSV oficial).
// Finnhub: ativos listados nos EUA, em US$ (grátis, 60 chamadas/min).
// Banco Central: PTAX USD/BRL (sem chave).
// CoinGecko: BTC e ETH em BRL (endpoint público sem chave).

const BRAPI_BASE = "https://brapi.dev/api";

// Cotação atual de um símbolo americano. Símbolo desconhecido volta tudo
// zerado, por isso c <= 0 conta como "sem cotação".
export async function fetchFinnhubQuote(symbol: string, token: string): Promise<number | null> {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`,
    { headers: { "X-Finnhub-Token": token }, cache: "no-store" },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const price = data?.c;
  return typeof price === "number" && price > 0 ? price : null;
}

export interface FxQuote {
  rate: number;
  /** data da cotação (yyyy-mm-dd) */
  date: string;
}

// Última PTAX de venda dos últimos 10 dias: fim de semana e feriado não têm
// cotação, então pedimos um período e ficamos com a mais recente.
export async function fetchPtaxUsdBrl(): Promise<FxQuote | null> {
  const fmt = (d: Date) =>
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
  const end = new Date();
  const start = new Date(end.getTime() - 10 * 86_400_000);
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@dataInicial='${fmt(start)}'&@dataFinalCotacao='${fmt(end)}'` +
    "&$top=1&$orderby=dataHoraCotacao%20desc&$format=json";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  const row = data?.value?.[0];
  const rate = Number(row?.cotacaoVenda);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { rate, date: String(row.dataHoraCotacao).slice(0, 10) };
}

const COINGECKO_IDS: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum" };
export const CRYPTO_TICKERS = Object.keys(COINGECKO_IDS);

// Preço em BRL por ticker (BTC, ETH) numa chamada só.
export async function fetchCryptoBRL(tickers: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(tickers.map((t) => COINGECKO_IDS[t]).filter(Boolean))];
  if (ids.length === 0) return out;
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=brl`,
    { cache: "no-store" },
  );
  if (!res.ok) return out;
  const data = await res.json();
  for (const [ticker, id] of Object.entries(COINGECKO_IDS)) {
    const price = data?.[id]?.brl;
    if (typeof price === "number" && price > 0) out.set(ticker, price);
  }
  return out;
}

export async function fetchBrapiQuote(
  ticker: string,
  token: string,
): Promise<number | null> {
  const res = await fetch(
    `${BRAPI_BASE}/quote/${encodeURIComponent(ticker)}?token=${token}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const price = data?.results?.[0]?.regularMarketPrice;
  return typeof price === "number" && price > 0 ? price : null;
}

// CSV oficial diário do Tesouro Transparente (o endpoint de Tesouro da brapi
// virou plano pago). ~14MB com histórico completo; escaneamos tudo e guardamos
// o PU de venda (marcação a mercado) mais recente por título.
const TESOURO_CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";

// Retorna mapa "Tipo AnoVencimento" (ex: "Tesouro IPCA+ 2032") -> PU de venda
// mais recente.
export async function fetchTesouroDiretoPrices(): Promise<Map<string, number>> {
  const res = await fetch(TESOURO_CSV_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!res.ok) return new Map();
  const text = await res.text();

  const latest = new Map<string, { date: string; price: number }>();
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(";");
    if (parts.length < 8) continue;
    const tipo = parts[0].trim();
    const vencimento = parts[1].trim(); // dd/mm/yyyy
    const dataBase = parts[2].trim(); // dd/mm/yyyy
    const puVenda = Number(parts[6].trim().replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(puVenda) || puVenda <= 0) continue;

    const key = `${tipo} ${vencimento.slice(-4)}`;
    const [d, m, y] = dataBase.split("/");
    const isoBase = `${y}-${m}-${d}`;
    const current = latest.get(key);
    if (!current || isoBase > current.date) {
      latest.set(key, { date: isoBase, price: puVenda });
    }
  }
  return new Map([...latest.entries()].map(([key, v]) => [key, v.price]));
}

