// Cliente mínimo da API Pluggy (server-only). Docs: https://docs.pluggy.ai

const BASE = "https://api.pluggy.ai";

export interface PluggyAccount {
  id: string;
  type: "BANK" | "CREDIT";
  subtype: string;
  name: string;
  balance: number;
  creditData?: {
    creditLimit?: number;
    availableCreditLimit?: number;
    balanceDueDate?: string;
  };
}

export interface PluggyInvestment {
  id: string;
  type: string; // FIXED_INCOME | EQUITY | ...
  subtype: string; // CDB | TREASURY | STOCK | REAL_ESTATE_FUND | ...
  name: string;
  code: string | null; // ticker (ex: BBAS3) para EQUITY
  balance: number;
  quantity: number | null;
  value: number | null; // preço unitário atual
  amountOriginal: number | null;
  rate: number | null;
  rateType: string | null;
  dueDate: string | null;
}

export interface PluggyInvestmentTransaction {
  id: string;
  type: string; // BUY | SELL | INTEREST | ...
  date: string;
  quantity: number | null;
  value: number | null; // preço unitário
  amount: number | null; // valor total
}

export interface PluggyTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "DEBIT" | "CREDIT";
  status: "POSTED" | "PENDING";
  category: string | null;
}

export async function pluggyAuth(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`pluggy auth: ${res.status}`);
  const data = await res.json();
  return data.apiKey;
}

// token de curta duração usado pelo widget Pluggy Connect no navegador
export async function createConnectToken(apiKey: string): Promise<string> {
  const res = await fetch(`${BASE}/connect_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({}),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`pluggy connect_token: ${res.status}`);
  const data = await res.json();
  return data.accessToken;
}

// o item pertence à aplicação que o criou — usado para descobrir qual par de
// credenciais enxerga cada conexão quando há mais de uma aplicação Pluggy
export async function itemVisible(apiKey: string, itemId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/items/${itemId}`, {
    headers: { "X-API-KEY": apiKey },
    cache: "no-store",
  });
  return res.ok;
}

async function get(apiKey: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-API-KEY": apiKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`pluggy GET ${path}: ${res.status}`);
  return res.json();
}

export async function fetchAccounts(
  apiKey: string,
  itemId: string,
): Promise<PluggyAccount[]> {
  const data = await get(apiKey, `/accounts?itemId=${itemId}`);
  return data.results ?? [];
}

export async function fetchInvestments(
  apiKey: string,
  itemId: string,
): Promise<PluggyInvestment[]> {
  const data = await get(apiKey, `/investments?itemId=${itemId}`);
  return data.results ?? [];
}

export async function fetchInvestmentTransactions(
  apiKey: string,
  investmentId: string,
): Promise<PluggyInvestmentTransaction[]> {
  const data = await get(
    apiKey,
    `/investments/${investmentId}/transactions?pageSize=500`,
  );
  return data.results ?? [];
}

// /v2/transactions usa paginação por cursor (campo `next`).
export async function fetchAllTransactions(
  apiKey: string,
  accountId: string,
): Promise<PluggyTransaction[]> {
  const all: PluggyTransaction[] = [];
  let path: string | null = `/v2/transactions?accountId=${accountId}`;
  let guard = 0;
  while (path && guard < 50) {
    guard++;
    const data: { results?: PluggyTransaction[]; next?: string | null } =
      await get(apiKey, path);
    all.push(...(data.results ?? []));
    if (data.next) {
      // `next` vem como querystring pronta (ex: "?accountId=...&after=...")
      const next = String(data.next);
      path = next.startsWith("http")
        ? next.replace(BASE, "")
        : `/v2/transactions${next.startsWith("?") ? next : `?${next}`}`;
    } else {
      path = null;
    }
  }
  return all;
}
