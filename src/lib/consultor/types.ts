import type { Usage } from "./ai";
import type { RankingOutput } from "./schemas";

// Estado de uma rodada da análise (coluna analysis_runs.state).

export interface CompactAsset {
  ticker: string;
  name: string | null;
  sector: string | null;
  kind: string;
  currency: "BRL" | "USD";
  price: number | null;
  marketCap: number | null;
  liquidity: number | null;
  pe: number | null;
  pb: number | null;
  dy: number | null;
  roe: number | null;
  roic: number | null;
  netMargin: number | null;
  netDebtToEquity: number | null;
  currentRatio: number | null;
  revenueGrowth5y: number | null;
  earningsGrowth: number | null;
  segment: string | null;
  ffoYield: number | null;
  capRate: number | null;
  vacancy: number | null;
  properties: number | null;
  /** EPS anual, mais recente primeiro (só EUA) */
  epsHistory: number[] | null;
  flags: string[];
}

export interface CompactHolding extends CompactAsset {
  quantity: number;
  avgPrice: number | null;
  /** cotação atual na moeda do ativo */
  currentPrice: number | null;
  gainPct: number | null;
  valueBrl: number;
  /** peso dentro da categoria (%) */
  weightPct: number;
  heldButFailing: string | null;
}

export interface PreparedCategory {
  slug: string;
  name: string;
  /** quanto do aporte cai nesta caixa (R$) */
  aporte: number;
  /** vagas no subteto da categoria; null = sem subteto */
  capLeft: number | null;
  globalCapLeft: number;
  holdings: CompactHolding[];
  candidates: CompactAsset[];
  screen: { universe: number; passed: number; rejected: [string, number][] };
}

export interface Level1Category {
  slug: string;
  name: string;
  current: number;
  currentPct: number;
  targetPct: number;
  suggested: number;
  assetCount: number;
  maxAssets: number | null;
}

export interface Level1Summary {
  total: number;
  totalAfter: number;
  contribution: number;
  reserve: { current: number; target: number; gap: number; suggested: number };
  categories: Level1Category[];
  plan: { label: string; amount: number; reason: string }[];
  unclassified: number;
}

export interface PreparedState {
  level1: Level1Summary;
  fxRate: number | null;
  maxTotalAssets: number;
  totalAssetCount: number;
  categories: PreparedCategory[];
  skipped: { slug: string; name: string; reason: string }[];
}

export type ShoppingType = "buy" | "reinforce" | "trim" | "sell" | "watch" | "substitute" | "alternative";

export interface ShoppingItem {
  category: string;
  categoryName: string;
  ticker: string;
  market: "BR" | "US";
  type: ShoppingType;
  amountBrl: number | null;
  quantity: number | null;
  price: number | null;
  currency: "BRL" | "USD";
  rationale: string;
  flags: string[];
  taxNote: string | null;
}

export interface ShoppingState {
  items: ShoppingItem[];
  totalBuyBrl: number;
  unallocatedBrl: number;
  notes: string[];
}

export interface RunState {
  /** etapas na ordem: prepare, rank:<slug>..., shopping, narrative */
  plan: string[];
  done: string[];
  prepared?: PreparedState;
  rankings?: Record<string, RankingOutput>;
  shopping?: ShoppingState;
  narrative?: string;
  usage: Usage;
}

export interface RunSnapshot {
  id: string;
  status: "running" | "done" | "failed";
  step: string;
  stepLabel: string;
  progress: number;
  error: string | null;
  /** outra invocação está executando a etapa agora */
  busy: boolean;
}

export interface RunRow {
  id: string;
  user_id: string;
  status: "running" | "done" | "failed";
  mode: "standard" | "full";
  contribution_amount: number | string;
  fx_rate: number | string | null;
  step: string;
  progress: number;
  state: RunState;
  report: Record<string, unknown> | null;
  narrative: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | string;
  error: string | null;
  step_started_at: string | null;
  created_at: string;
  finished_at: string | null;
}
