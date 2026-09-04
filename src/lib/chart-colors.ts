// Slots de cor fixos por entidade (nunca por ordem de aparição) — a cor
// acompanha a classe/categoria mesmo quando um filtro muda quais aparecem.

export const CLASS_COLOR: Record<string, string> = {
  acoes: "var(--series-1)",
  fiis: "var(--series-2)",
  renda_fixa: "var(--series-3)",
  conta_corrente: "var(--series-4)",
  bitcoin: "var(--series-5)",
};

export const INCOME_COLOR: Record<string, string> = {
  rendimento_fii: "var(--series-1)",
  dividendos: "var(--series-2)",
  jcp: "var(--series-3)",
  outros: "var(--series-4)",
  rendimento_renda_fixa: "var(--series-5)",
  salario: "var(--series-6)",
};

export const EXPENSE_COLOR: Record<string, string> = {
  moradia: "var(--series-1)",
  alimentacao: "var(--series-2)",
  transporte: "var(--series-3)",
  lazer: "var(--series-4)",
  saude: "var(--series-5)",
  educacao: "var(--series-6)",
  assinaturas: "var(--series-7)",
  outros: "var(--series-8)",
};

// A ordem dos slots é o mecanismo validado contra daltonismo — fatias de
// pizza/donut devem ser renderizadas nesta ordem fixa, nunca por valor.
export function slotIndex(color: string): number {
  const match = color.match(/--series-(\d)/);
  return match ? Number(match[1]) : 99;
}

// Categorias criadas pelo usuário não têm slot fixo — o hash do slug escolhe
// um slot estável (a mesma categoria sempre ganha a mesma cor).
export function colorForSlug(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return `var(--series-${(h % 8) + 1})`;
}
