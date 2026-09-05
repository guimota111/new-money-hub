// Aceita "1.234,56" (pt-BR) e "1234.56". Se tem vírgula, trata como pt-BR;
// senão o ponto é separador decimal.
export function parseDecimal(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const normalized = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatUSD(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)}%`;
}

export function formatQuantity(value: number, maxDecimals = 8): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: maxDecimals,
  }).format(value);
}
