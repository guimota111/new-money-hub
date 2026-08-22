// Converte valores digitados em pt-BR ("1.234,56", "R$ 50", "50.30") em número.
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/R\$\s?/i, "").trim();
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
