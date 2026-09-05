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

// Ativo que merece checagem de notícias: toda posição atual com ticker nas
// categorias selecionáveis, mesmo fora das caixas analisadas nesta rodada.
export interface NewsTarget {
  ticker: string;
  market: "BR" | "US";
  name: string | null;
  categorySlug: string;
  categoryName: string;
  /** true quando a categoria não entrou no ranking (só alerta de notícia) */
  outsideAnalysis: boolean;
}

export interface NewsHeadline {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
}

export interface NewsVerdict {
  level: "neutral" | "attention" | "concerning";
  recurring: boolean;
  summary: string;
  themes: string[];
  headlines: NewsHeadline[];
  /** true quando veio do cache (classificado em rodada anterior, < 7 dias) */
  cached: boolean;
}

/** quantidade por "MERCADO:TICKER" no momento da rodada; base da detecção de acatamento */
export type PositionSnapshot = Record<string, { quantity: number; valueBrl: number }>;

export type RecommendationStatus = "pending" | "executed" | "partial" | "ignored";

export interface PreviousRecommendation {
  type: ShoppingType;
  category: string | null;
  ticker: string;
  amountBrl: number | null;
  quantity: number | null;
  rationale: string | null;
  status: RecommendationStatus;
  statusSource: "auto" | "manual";
}

// Resumo da última rodada concluída, para a IA não se repetir e para o
// relatório mostrar o que foi acatado.
export interface PreviousRunSummary {
  runId: string;
  createdAt: string;
  contribution: number;
  mode: "standard" | "full";
  recommendations: PreviousRecommendation[];
  counts: Record<RecommendationStatus, number>;
  narrativeExcerpt: string | null;
}

export interface PreparedState {
  level1: Level1Summary;
  fxRate: number | null;
  maxTotalAssets: number;
  totalAssetCount: number;
  categories: PreparedCategory[];
  skipped: { slug: string; name: string; reason: string }[];
  watchlist: NewsTarget[];
  positions: PositionSnapshot;
  previous: PreviousRunSummary | null;
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
  /** etapas na ordem: prepare, news, rank:<slug>..., [news_finalists], shopping, narrative */
  plan: string[];
  done: string[];
  prepared?: PreparedState;
  /** veredito de notícias por "MERCADO:TICKER" (posições e, no modo completo, finalistas) */
  news?: Record<string, NewsVerdict>;
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
