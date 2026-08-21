// Busca de cotações nas APIs externas (server-only).
// brapi.dev: ações/FIIs e Tesouro Direto (exige token, plano grátis existe).
// CoinGecko: Bitcoin em BRL (endpoint público sem chave).

const BRAPI_BASE = "https://brapi.dev/api";

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

export async function fetchBitcoinBRL(): Promise<number | null> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl",
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const price = data?.bitcoin?.brl;
  return typeof price === "number" && price > 0 ? price : null;
}
