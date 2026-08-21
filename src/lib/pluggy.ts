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
  balance: number;
  amountOriginal: number | null;
  rate: number | null;
  rateType: string | null;
  dueDate: string | null;
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
