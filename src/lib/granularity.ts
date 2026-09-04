// Agrupamento temporal dos gráficos: dia, semana (segunda-feira como chave),
// mês e ano. Usado no cliente pelos charts do dashboard.

export type Granularity = "dia" | "semana" | "mes" | "ano";

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function bucketKey(iso: string, g: Granularity): string {
  if (g === "dia") return iso;
  if (g === "mes") return iso.slice(0, 7);
  if (g === "ano") return iso.slice(0, 4);
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7; // 0 = segunda
  date.setUTCDate(date.getUTCDate() - dow);
  return date.toISOString().slice(0, 10);
}

export function bucketLabel(key: string, g: Granularity): string {
  if (g === "ano") return key;
  if (g === "mes") {
    const [y, m] = key.split("-");
    return `${MONTHS_PT[Number(m) - 1]}/${y.slice(2)}`;
  }
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

// hoje no fuso do Brasil, como yyyy-mm-dd
export function todayBR(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return date.toISOString().slice(0, 10);
}

// Lista contínua de buckets (mesmo os vazios) para o eixo X não "pular"
// períodos sem lançamentos. Janelas: 60 dias, 26 semanas, 12 meses, ou todos
// os anos desde o primeiro dado.
export function bucketRange(g: Granularity, firstIso: string | null): string[] {
  const today = todayBR();
  if (g === "dia") {
    return Array.from({ length: 60 }, (_, i) => shiftDays(today, i - 59));
  }
  if (g === "semana") {
    const monday = bucketKey(today, "semana");
    return Array.from({ length: 26 }, (_, i) => shiftDays(monday, (i - 25) * 7));
  }
  if (g === "mes") {
    const [y, m] = today.split("-").map(Number);
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 + (i - 11), 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    });
  }
  const firstYear = firstIso ? Number(firstIso.slice(0, 4)) : Number(today.slice(0, 4));
  const lastYear = Number(today.slice(0, 4));
  return Array.from({ length: Math.max(1, lastYear - firstYear + 1) }, (_, i) =>
    String(firstYear + i),
  );
}
