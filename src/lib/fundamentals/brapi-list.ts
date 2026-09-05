// Lista de ativos da B3 na brapi (disponível em qualquer plano): setor,
// subsetor, tipo/subtipo, market cap e volume. É o universo B3 do consultor
// e a fonte de setor, que o Fundamentus não traz na tabela geral.

export interface BrapiListItem {
  stock: string;
  name: string;
  close: number | null;
  volume: number | null;
  market_cap: number | null;
  sector: string | null;
  subsector: string | null;
  type: "stock" | "fund" | "bdr";
  subType: string | null;
}

export async function fetchBrapiList(
  type: "stock" | "fund" | "bdr",
  token: string,
): Promise<BrapiListItem[]> {
  const items: BrapiListItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://brapi.dev/api/quote/list?type=${type}&limit=500&page=${page}&sortBy=volume&sortOrder=desc`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`brapi list ${type} p${page}: HTTP ${res.status}`);
    const body = await res.json();
    for (const s of body?.stocks ?? []) {
      items.push({
        stock: String(s.stock).toUpperCase(),
        name: String(s.name ?? s.stock),
        close: typeof s.close === "number" ? s.close : null,
        volume: typeof s.volume === "number" ? s.volume : null,
        market_cap: typeof s.market_cap === "number" ? s.market_cap : null,
        sector: s.sector ?? null,
        subsector: s.subsector ?? null,
        type,
        subType: s.subType ?? null,
      });
    }
    if (!body?.hasNextPage) break;
  }
  return items;
}
