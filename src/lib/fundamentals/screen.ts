import type { Fundamentals } from "./types";

// Pré-filtro determinístico (nível 2, etapa 2 da spec). Não decide nada: só
// tira quem não tem dado suficiente, liquidez mínima ou passa longe dos
// critérios centrais, e corta o universo para um tamanho que a IA consegue
// ler. Posições atuais nunca são removidas — vão marcadas.

export type ScreenCategory = "acoes_br" | "fiis" | "acoes_eua" | "internacional";

export const SCREEN_CATEGORIES: ScreenCategory[] = ["acoes_br", "fiis", "acoes_eua", "internacional"];

export interface ScreenedAsset {
  f: Fundamentals;
  held: boolean;
  /** só para posições atuais que falhariam no filtro */
  heldButFailing: string | null;
  score: number;
}

export interface ScreenResult {
  category: ScreenCategory;
  universe: number;
  passed: ScreenedAsset[];
  /** motivo → quantidade de ativos removidos por ele */
  rejected: Map<string, number>;
  cap: number;
  rules: string[];
}

interface Rules {
  cap: number;
  labels: string[];
  reject: (f: Fundamentals) => string | null;
  score: (f: Fundamentals, all: Fundamentals[]) => number;
}

// posição percentil de v em values (maior = melhor quando higherIsBetter)
function percentile(v: number | null, values: number[], higherIsBetter: boolean): number {
  if (v == null || values.length === 0) return 0.5;
  let below = 0;
  for (const x of values) if (x < v) below++;
  const p = below / values.length;
  return higherIsBetter ? p : 1 - p;
}

function nums(all: Fundamentals[], pick: (f: Fundamentals) => number | null): number[] {
  return all.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
}

const RULES: Record<ScreenCategory, Rules> = {
  acoes_br: {
    cap: 80,
    labels: [
      "só ações e units da B3 com dados no Fundamentus",
      "liquidez média diária ≥ R$ 1 milhão",
      "patrimônio líquido positivo",
      "lucro positivo nos últimos 12 meses (P/L > 0)",
      "dívida líquida / patrimônio disponível",
      "corte para 80 pela combinação de ROE, dividend yield, endividamento, P/L e crescimento de receita",
    ],
    reject: (f) => {
      if (f.kind !== "stock") return "não é ação";
      if (!f.sources.includes("fundamentus_stock")) return "sem dados no Fundamentus";
      if (f.liquidity == null || f.liquidity < 1_000_000) return "liquidez abaixo de R$ 1 mi/dia";
      if (f.equity == null || f.equity <= 0) return "patrimônio líquido negativo";
      if (f.pe == null || f.pe <= 0) return "prejuízo nos últimos 12 meses";
      if (f.netDebtToEquity == null) return "sem dívida/patrimônio";
      return null;
    },
    score: (f, all) => {
      const roe = nums(all, (x) => x.roe);
      const dy = nums(all, (x) => x.dy);
      const debt = nums(all, (x) => x.netDebtToEquity);
      const pe = nums(all, (x) => x.pe);
      const growth = nums(all, (x) => x.revenueGrowth5y);
      return (
        percentile(f.roe, roe, true) * 0.3 +
        percentile(f.dy, dy, true) * 0.2 +
        percentile(f.netDebtToEquity, debt, false) * 0.2 +
        percentile(f.pe, pe, false) * 0.15 +
        percentile(f.revenueGrowth5y, growth, true) * 0.15
      );
    },
  },
  fiis: {
    cap: 60,
    labels: [
      "só FIIs com dados no Fundamentus",
      "liquidez média diária ≥ R$ 200 mil",
      "P/VP entre 0,4 e 1,6",
      "dividend yield positivo",
      "vacância média ≤ 30% (quando informada)",
      "corte para 60 pela combinação de dividend yield, P/VP perto de 1, liquidez e FFO yield",
    ],
    reject: (f) => {
      if (f.kind !== "fii") return "não é FII";
      if (!f.sources.includes("fundamentus_fii")) return "sem dados no Fundamentus";
      if (f.liquidity == null || f.liquidity < 200_000) return "liquidez abaixo de R$ 200 mil/dia";
      if (f.pb == null || f.pb < 0.4 || f.pb > 1.6) return "P/VP fora de 0,4–1,6";
      if (f.dy == null || f.dy <= 0) return "sem dividend yield";
      if (f.vacancy != null && f.vacancy > 30) return "vacância acima de 30%";
      return null;
    },
    score: (f, all) => {
      const dy = nums(all, (x) => x.dy);
      const pbDist = nums(all, (x) => (x.pb == null ? null : Math.abs(x.pb - 1)));
      const liq = nums(all, (x) => x.liquidity);
      const ffo = nums(all, (x) => x.ffoYield);
      return (
        percentile(f.dy, dy, true) * 0.35 +
        percentile(f.pb == null ? null : Math.abs(f.pb - 1), pbDist, false) * 0.25 +
        percentile(f.liquidity, liq, true) * 0.2 +
        percentile(f.ffoYield, ffo, true) * 0.2
      );
    },
  },
  acoes_eua: {
    cap: 80,
    labels: [
      "S&P 500 e ETFs de mercado americano; ETFs passam direto",
      "métricas disponíveis na Finnhub",
      "valor de mercado ≥ US$ 5 bilhões",
      "dívida total / patrimônio disponível",
      "sem exigência de lucro (empresa de crescimento é permitida e será destacada pela IA)",
      "corte para 80 pela combinação de crescimento de receita, crescimento de lucro, margem líquida, ROE e endividamento",
    ],
    reject: (f) => {
      if (f.kind === "etf") return null;
      if (!f.sources.includes("finnhub_metric")) return "ainda sem métricas da Finnhub";
      if (f.marketCap == null) return "sem métricas na Finnhub";
      if (f.marketCap < 5e9) return "valor de mercado abaixo de US$ 5 bi";
      if (f.netDebtToEquity == null) return "sem dívida/patrimônio";
      return null;
    },
    score: (f, all) => {
      if (f.kind === "etf") return 0.5;
      const rev = nums(all, (x) => x.revenueGrowth5y);
      const eps = nums(all, (x) => x.earningsGrowth);
      const margin = nums(all, (x) => x.netMargin);
      const roe = nums(all, (x) => x.roe);
      const debt = nums(all, (x) => x.netDebtToEquity);
      return (
        percentile(f.revenueGrowth5y, rev, true) * 0.3 +
        percentile(f.earningsGrowth, eps, true) * 0.2 +
        percentile(f.netMargin, margin, true) * 0.2 +
        percentile(f.roe, roe, true) * 0.15 +
        percentile(f.netDebtToEquity, debt, false) * 0.15
      );
    },
  },
  internacional: {
    cap: 30,
    labels: [
      "ETFs ex-EUA e ADRs curados; ETFs passam direto",
      "ADRs precisam de métricas na Finnhub",
      "corte para 30 pela combinação de crescimento, margem, ROE e endividamento",
    ],
    reject: (f) => {
      if (f.kind === "etf") return null;
      if (!f.sources.includes("finnhub_metric")) return "ainda sem métricas da Finnhub";
      if (f.marketCap == null) return "sem métricas na Finnhub";
      return null;
    },
    score: (f, all) => {
      if (f.kind === "etf") return 0.5;
      const rev = nums(all, (x) => x.revenueGrowth5y);
      const margin = nums(all, (x) => x.netMargin);
      const roe = nums(all, (x) => x.roe);
      const debt = nums(all, (x) => x.netDebtToEquity);
      return (
        percentile(f.revenueGrowth5y, rev, true) * 0.3 +
        percentile(f.netMargin, margin, true) * 0.25 +
        percentile(f.roe, roe, true) * 0.25 +
        percentile(f.netDebtToEquity, debt, false) * 0.2
      );
    },
  },
};

export function screenCategory(
  category: ScreenCategory,
  universe: Fundamentals[],
  heldTickers: Set<string>,
): ScreenResult {
  const rules = RULES[category];
  const rejected = new Map<string, number>();
  const survivors: Fundamentals[] = [];
  const heldFailing = new Map<string, string>();

  for (const f of universe) {
    const reason = rules.reject(f);
    const held = heldTickers.has(f.ticker);
    if (reason && !held) {
      rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
      continue;
    }
    if (reason && held) heldFailing.set(f.ticker, reason);
    survivors.push(f);
  }

  const scored: ScreenedAsset[] = survivors.map((f) => ({
    f,
    held: heldTickers.has(f.ticker),
    heldButFailing: heldFailing.get(f.ticker) ?? null,
    score: rules.score(f, survivors),
  }));
  scored.sort((a, b) => b.score - a.score || a.f.ticker.localeCompare(b.f.ticker));

  // corte pelo teto, mas posições atuais ficam sempre
  const passed: ScreenedAsset[] = [];
  let cut = 0;
  for (const s of scored) {
    if (passed.length < rules.cap || s.held) passed.push(s);
    else cut++;
  }
  if (cut > 0) rejected.set(`fora do corte de ${rules.cap} por nota`, cut);

  return {
    category,
    universe: universe.length,
    passed,
    rejected,
    cap: rules.cap,
    rules: rules.labels,
  };
}
