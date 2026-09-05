import { assetCurrentValue, type AssetRow } from "@/lib/portfolio";

// Consultor de Alocação — nível 1 (alocação por caixa vs meta), sem IA.
// Regras em docs/consultor-alocacao.md, seções 3 e 4.

export const MIGRATION_FILE = "supabase/migrations/0007_allocation.sql";

export interface AllocationCategory {
  id: string;
  name: string;
  slug: string;
  /** % da carteira (soma das categorias deve dar 100) */
  target_pct: number;
  /** subteto de ativos da categoria; nulo = sem limite próprio */
  max_assets: number | null;
  sort_order: number;
}

export interface AllocationSettings {
  /** valor fixo em R$ que a reserva de emergência precisa ter */
  reserve_target_amount: number;
  max_total_assets: number;
  default_mode: "standard" | "full";
}

export type AllocationAssetRow = AssetRow & {
  allocation_category_id: string | null;
  is_emergency_reserve: boolean;
  allocation_excluded: boolean;
};

// Dentro das faixas de referência do briefing (RF 25–30, BR 25–30, FIIs 10–15,
// EUA 10–15, internacional 5–10, cripto 2–5) e somando 100.
export const DEFAULT_CATEGORIES: Omit<AllocationCategory, "id">[] = [
  { slug: "renda_fixa", name: "Renda Fixa", target_pct: 30, max_assets: null, sort_order: 1 },
  { slug: "acoes_br", name: "Ações Brasileiras", target_pct: 30, max_assets: 12, sort_order: 2 },
  { slug: "fiis", name: "Fundos Imobiliários", target_pct: 15, max_assets: 8, sort_order: 3 },
  { slug: "acoes_eua", name: "Ações Americanas", target_pct: 15, max_assets: 10, sort_order: 4 },
  {
    slug: "internacional",
    name: "Internacional (fora EUA)",
    target_pct: 7,
    max_assets: 3,
    sort_order: 5,
  },
  { slug: "cripto", name: "Criptomoedas", target_pct: 3, max_assets: null, sort_order: 6 },
];

export const DEFAULT_SETTINGS: AllocationSettings = {
  reserve_target_amount: 0,
  max_total_assets: 30,
  default_mode: "standard",
};

export { isMissingTableError } from "@/lib/supabase/errors";

export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "categoria"
  );
}

// ---- contagem no teto -----------------------------------------------------

// Unidade que conta no teto: cada ticker é 1; toda a renda fixa (Tesouro etc.)
// é 1; reserva de emergência e conta corrente não contam.
export function countUnit(asset: AllocationAssetRow): string | null {
  if (asset.is_emergency_reserve) return null;
  const slug = asset.asset_classes?.slug;
  if (slug === "conta_corrente") return null;
  if (slug === "renda_fixa") return "renda_fixa";
  return (asset.market_instruments?.ticker ?? asset.name).trim().toUpperCase();
}

// ---- sugestão automática de classificação ---------------------------------

export interface AllocationSuggestion {
  categorySlug: string | null;
  reserve: boolean;
  excluded: boolean;
  reason: string;
}

// ETFs negociados na B3 classificados pela exposição econômica, não pelo
// local de negociação (decisão da spec). Lista curta e editável.
const US_ETFS = new Set(["IVVB11", "SPXI11", "NASD11", "USTK11", "TECK11", "SPXB11", "BDRX11"]);
const INTL_ETFS = new Set(["XINA11", "EURP11", "ASIA11", "EMER11", "ACWI11", "WRLD11"]);
// BDRs terminam em 31–35 ou 39 (ETFs de BDR)
const BDR_SUFFIX = /(31|32|33|34|35|39)$/;
// Listados nos EUA mas com exposição fora dos EUA: ETFs ex-US e ADRs comuns.
const INTL_US_LISTED = new Set([
  "VXUS", "VEA", "VWO", "IEMG", "EFA", "EEM", "IXUS", "ACWX", "VEU", "IEFA", "EWZ",
  "TSM", "ASML", "NVO", "SAP", "TM", "SONY", "BABA", "SHOP", "MELI", "NU",
]);

export function suggestAllocation(asset: AssetRow): AllocationSuggestion {
  const slug = asset.asset_classes?.slug;
  const meta = asset.metadata ?? {};
  const name = asset.name ?? "";
  const ticker = (asset.market_instruments?.ticker ?? name).trim().toUpperCase();
  const reserveName = /reserva|emerg/i.test(name);
  const keep = { reserve: false, excluded: false };

  switch (slug) {
    case "conta_corrente":
      if (meta.tipo === "caixinha" && reserveName) {
        return {
          categorySlug: "renda_fixa",
          reserve: true,
          excluded: false,
          reason: "caixinha com nome de reserva",
        };
      }
      return {
        categorySlug: null,
        reserve: false,
        excluded: true,
        reason:
          meta.tipo === "caixinha"
            ? "caixinha de consumo fica fora da carteira"
            : "saldo livre fica fora da carteira",
      };
    case "renda_fixa": {
      const selic = /selic/i.test(name) || String(meta.indexador ?? "") === "selic";
      return {
        categorySlug: "renda_fixa",
        reserve: selic || reserveName,
        excluded: false,
        reason: selic ? "Tesouro Selic costuma ser reserva" : "renda fixa",
      };
    }
    case "fiis":
      return { categorySlug: "fiis", ...keep, reason: "fundo imobiliário" };
    case "bitcoin":
    case "cripto":
      return { categorySlug: "cripto", ...keep, reason: "cripto" };
    case "bolsa_eua":
      if (INTL_US_LISTED.has(ticker)) {
        return {
          categorySlug: "internacional",
          ...keep,
          reason: "listado nos EUA com exposição a outros mercados",
        };
      }
      return { categorySlug: "acoes_eua", ...keep, reason: "ativo da bolsa americana" };
    case "acoes":
      if (US_ETFS.has(ticker)) {
        return { categorySlug: "acoes_eua", ...keep, reason: "ETF de mercado americano" };
      }
      if (INTL_ETFS.has(ticker)) {
        return { categorySlug: "internacional", ...keep, reason: "ETF de mercado fora dos EUA" };
      }
      if (BDR_SUFFIX.test(ticker)) {
        return {
          categorySlug: "acoes_eua",
          ...keep,
          reason: "BDR: exposição a empresa estrangeira (confira se é EUA)",
        };
      }
      return { categorySlug: "acoes_br", ...keep, reason: "ação ou ETF brasileiro" };
    default:
      return { categorySlug: null, ...keep, reason: "sem regra para esta classe" };
  }
}

// ---- nível 1: alocação vs meta --------------------------------------------

export interface CategoryReport {
  category: AllocationCategory;
  current: number;
  /** % da carteira hoje */
  currentPct: number;
  /** valor alvo depois do aporte */
  targetAfter: number;
  /** alvo pós-aporte menos valor atual (positivo = falta dinheiro) */
  gap: number;
  /** pontos percentuais acima (+) ou abaixo (−) da meta */
  deviationPts: number;
  /** quanto do aporte cai nesta caixa */
  suggested: number;
  assetCount: number;
  /** meta 0% e sem valor: some do relatório */
  hidden: boolean;
}

export interface PlanStep {
  kind: "reserve" | "category" | "spread";
  label: string;
  amount: number;
  reason: string;
  slug?: string;
}

export interface AllocationReport {
  total: number;
  totalAfter: number;
  contribution: number;
  /** na ordem de sort_order, inclui as ocultas (hidden) */
  categories: CategoryReport[];
  reserve: {
    current: number;
    target: number;
    gap: number;
    suggested: number;
    /** categoria que abriga a reserva (normalmente Renda Fixa) */
    categoryName: string | null;
  };
  /** distribuição do aporte, na ordem em que o dinheiro entra */
  plan: PlanStep[];
  /** caixas abaixo da meta, da mais defasada para a menos (independe do aporte) */
  priority: CategoryReport[];
  leftover: number;
  unclassified: AllocationAssetRow[];
  excludedCount: number;
  countedCount: number;
  totalAssetCount: number;
  targetSum: number;
}

const EPS = 0.005;

export function computeAllocation(
  assets: AllocationAssetRow[],
  categories: AllocationCategory[],
  settings: AllocationSettings,
  contribution: number,
): AllocationReport {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const counted: AllocationAssetRow[] = [];
  const unclassified: AllocationAssetRow[] = [];
  let excludedCount = 0;
  for (const asset of assets) {
    if (asset.allocation_excluded) {
      excludedCount++;
      continue;
    }
    if (asset.allocation_category_id && byId.has(asset.allocation_category_id)) {
      counted.push(asset);
    } else {
      unclassified.push(asset);
    }
  }

  const currentById = new Map<string, number>();
  const reserveById = new Map<string, number>();
  const unitsById = new Map<string, Set<string>>();
  let total = 0;
  let reserveCurrent = 0;
  for (const asset of counted) {
    const id = asset.allocation_category_id!;
    const value = assetCurrentValue(asset);
    total += value;
    currentById.set(id, (currentById.get(id) ?? 0) + value);
    if (asset.is_emergency_reserve) {
      reserveCurrent += value;
      reserveById.set(id, (reserveById.get(id) ?? 0) + value);
    }
    const unit = countUnit(asset);
    if (unit) {
      if (!unitsById.has(id)) unitsById.set(id, new Set());
      unitsById.get(id)!.add(unit);
    }
  }

  // a reserva mora na categoria que concentra os ativos marcados como reserva;
  // sem nenhum marcado, assume Renda Fixa
  let reserveCategory: AllocationCategory | null = null;
  let best = 0;
  for (const [id, value] of reserveById) {
    if (value > best) {
      best = value;
      reserveCategory = byId.get(id) ?? null;
    }
  }
  if (!reserveCategory) reserveCategory = categories.find((c) => c.slug === "renda_fixa") ?? null;

  const totalAfter = total + contribution;
  const reserveTarget = settings.reserve_target_amount;
  const reserveGap = Math.max(0, reserveTarget - reserveCurrent);

  // 1) reserva de emergência tem prioridade automática até completar o valor
  const reserveFill = Math.min(contribution, reserveGap);
  let remaining = contribution - reserveFill;
  const filled = new Map<string, number>();
  if (reserveCategory && reserveFill > EPS) filled.set(reserveCategory.id, reserveFill);

  const plan: PlanStep[] = [];
  if (reserveFill > EPS) {
    plan.push({
      kind: "reserve",
      label: "Reserva de emergência",
      amount: reserveFill,
      reason: `reserva em ${formatPts((reserveCurrent / reserveTarget) * 100, 0)}% do valor definido`,
    });
  }

  const sorted = [...categories].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );

  interface Work {
    category: AllocationCategory;
    current: number;
    targetAfter: number;
    /** falta depois de descontar o que já entrou pela reserva */
    gapLeft: number;
  }
  const work: Work[] = sorted.map((category) => {
    const current = currentById.get(category.id) ?? 0;
    const targetAfter = (category.target_pct / 100) * totalAfter;
    return {
      category,
      current,
      targetAfter,
      gapLeft: targetAfter - current - (filled.get(category.id) ?? 0),
    };
  });

  // 2) demais caixas pelo desvio relativo (gap / alvo), maior primeiro
  const candidates = work
    .filter((w) => w.gapLeft > EPS && w.targetAfter > 0)
    .sort((a, b) => b.gapLeft / b.targetAfter - a.gapLeft / a.targetAfter);
  for (const w of candidates) {
    if (remaining <= EPS) break;
    const amount = Math.min(remaining, w.gapLeft);
    filled.set(w.category.id, (filled.get(w.category.id) ?? 0) + amount);
    remaining -= amount;
    plan.push({
      kind: "category",
      slug: w.category.slug,
      label: w.category.name,
      amount,
      reason: `${formatPts((w.gapLeft / w.targetAfter) * 100, 0)}% abaixo da meta`,
    });
  }

  // 3) sobrou dinheiro com todas as caixas na meta: reparte na proporção das metas
  if (remaining > EPS) {
    const pctSum = sorted.reduce((sum, c) => sum + c.target_pct, 0);
    if (pctSum > 0) {
      for (const category of sorted) {
        if (category.target_pct <= 0) continue;
        const amount = (remaining * category.target_pct) / pctSum;
        filled.set(category.id, (filled.get(category.id) ?? 0) + amount);
      }
      plan.push({
        kind: "spread",
        label: "Todas as caixas na meta",
        amount: remaining,
        reason: "repartido na proporção das metas",
      });
      remaining = 0;
    }
  }

  const reports: CategoryReport[] = work.map((w) => {
    const currentPct = total > 0 ? (w.current / total) * 100 : 0;
    return {
      category: w.category,
      current: w.current,
      currentPct,
      targetAfter: w.targetAfter,
      gap: w.targetAfter - w.current,
      deviationPts: currentPct - w.category.target_pct,
      suggested: filled.get(w.category.id) ?? 0,
      assetCount: unitsById.get(w.category.id)?.size ?? 0,
      hidden: w.category.target_pct === 0 && w.current === 0,
    };
  });

  const priority = reports
    .filter((r) => !r.hidden && r.gap > EPS && r.targetAfter > 0)
    .sort((a, b) => b.gap / b.targetAfter - a.gap / a.targetAfter);

  return {
    total,
    totalAfter,
    contribution,
    categories: reports,
    reserve: {
      current: reserveCurrent,
      target: reserveTarget,
      gap: reserveTarget - reserveCurrent,
      suggested: reserveFill,
      categoryName: reserveCategory?.name ?? null,
    },
    plan,
    priority,
    leftover: remaining,
    unclassified,
    excludedCount,
    countedCount: counted.length,
    totalAssetCount: reports.reduce((sum, r) => sum + r.assetCount, 0),
    targetSum: categories.reduce((sum, c) => sum + c.target_pct, 0),
  };
}

function formatPts(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}
