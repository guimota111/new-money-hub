// Filtro de período das listas (Movimentações, Receitas, Despesas):
// "mes" (padrão, mês atual), "ano", "personalizado" (de/até) ou "total".

export interface PeriodSearchParams {
  periodo?: string;
  mes?: string;
  ano?: string;
  de?: string;
  ate?: string;
}

export type PeriodMode = "mes" | "ano" | "personalizado" | "total";

export interface ResolvedPeriod {
  mode: PeriodMode;
  mes: string; // sempre preenchido (p/ o input do filtro)
  ano: string; // idem
  de?: string; // limites efetivos da consulta (ausentes no "total")
  ate?: string;
  label: string;
}

function currentMonthBR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function monthLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function resolvePeriod(params: PeriodSearchParams): ResolvedPeriod {
  const nowMes = currentMonthBR();
  const mes = /^\d{4}-\d{2}$/.test(params.mes ?? "") ? params.mes! : nowMes;
  const ano = /^\d{4}$/.test(params.ano ?? "") ? params.ano! : nowMes.slice(0, 4);

  const mode: PeriodMode =
    params.periodo === "ano" ||
    params.periodo === "personalizado" ||
    params.periodo === "total"
      ? params.periodo
      : "mes";

  if (mode === "total") {
    return { mode, mes, ano, label: "todo o período" };
  }
  if (mode === "ano") {
    return { mode, mes, ano, de: `${ano}-01-01`, ate: `${ano}-12-31`, label: ano };
  }
  if (mode === "personalizado") {
    const de = /^\d{4}-\d{2}-\d{2}$/.test(params.de ?? "") ? params.de : undefined;
    const ate = /^\d{4}-\d{2}-\d{2}$/.test(params.ate ?? "") ? params.ate : undefined;
    const label =
      de && ate
        ? `${formatDateBR(de)} a ${formatDateBR(ate)}`
        : de
          ? `desde ${formatDateBR(de)}`
          : ate
            ? `até ${formatDateBR(ate)}`
            : "personalizado";
    return { mode, mes, ano, de, ate, label };
  }
  const [y, m] = mes.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    mode,
    mes,
    ano,
    de: `${mes}-01`,
    ate: `${mes}-${String(lastDay).padStart(2, "0")}`,
    label: monthLabel(mes),
  };
}

// parâmetros a preservar nos links de paginação
export function periodParams(period: ResolvedPeriod): Record<string, string> {
  const out: Record<string, string> = { periodo: period.mode };
  if (period.mode === "mes") out.mes = period.mes;
  if (period.mode === "ano") out.ano = period.ano;
  if (period.mode === "personalizado") {
    if (period.de) out.de = period.de;
    if (period.ate) out.ate = period.ate;
  }
  return out;
}
