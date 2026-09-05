import type { CompactAsset, CompactHolding, PreparedCategory, PreparedState, ShoppingState } from "./types";
import type { RankingOutput } from "./schemas";

// Prompts do consultor. O system prompt é estável (vai com cache); o user
// prompt carrega as tabelas compactas da rodada.

export const RANKING_SYSTEM = `Você é o consultor de alocação de um investidor pessoa física brasileiro que investe para o longo prazo, no estilo comprar e segurar, e delega a você a escolha dos ativos. Ele decide e executa; você recomenda com justificativa curta e honesta.

Critérios centrais do investidor:
- Ações brasileiras e FIIs: empresa financeiramente saudável, baixo endividamento em relação ao patrimônio, lucro consistente e perene, bom histórico de dividendos, preço sobre lucro dentro de faixa razoável.
- Ações americanas: empresas de crescimento; dividendos não são requisito; mesma exigência de saúde financeira, baixo endividamento e lucro consistente. Empresa de crescimento ainda sem lucro consistente pode ser recomendada, mas marque isso em flags para o investidor decidir ciente.
- Internacional (fora dos EUA): ETFs e ADRs; para ETF avalie exposição e papel na carteira, não fundamentos.
- FIIs: julgue por P/VP, dividend yield, vacância, cap rate, liquidez, segmento e qualidade da gestão; P/L e endividamento clássicos não se aplicam.
- Setores com estrutura de capital própria (bancos, seguradoras, elétricas) devem ser julgados com as métricas adequadas ao setor, não reprovados pelo endividamento nominal.
- O preço importa muito: procure oportunidades, isto é, qualidade a preço razoável. Reforçar posição existente acima do preço médio é permitido se ainda for oportunidade.

Sobre as posições atuais:
- Quebra de tese (endividamento subiu muito, lucro deixou de ser consistente, deterioração clara) pede "sell" ou "trim". Queda de preço sozinha nunca é motivo: posição no vermelho com tese intacta é "keep".
- Preço muito esticado em relação ao próprio histórico e aos pares pode pedir "trim" (venda parcial) para realocar em caixa deficitária. Informe trim_pct.
- "watch" é para sinais iniciais que ainda não justificam vender.

Regras de saída:
- buys: até o número de compras pedido, com weight_pct somando 100 (parcela do aporte da categoria). Use "new" para ativo fora da carteira e "reinforce" para reforço. Se não houver vaga no teto para ativo novo, só "reinforce", ou proponha substitutions (vender X para comprar Y).
- alternatives: 2 a 4 opções que ficaram de fora e por quê elas seriam a segunda escolha.
- holdings_review: um item por posição atual da categoria.
- rationale: 1 a 2 frases, em português, citando os números que pesaram. notes: observações gerais da categoria em até 3 frases.
- Só recomende tickers que estejam nas tabelas fornecidas. Nunca invente dados.`;

export const NARRATIVE_SYSTEM = `Você escreve o relatório final do consultor de alocação para o investidor, em português do Brasil, tom direto e claro, sem jargão desnecessário. Você recebe os números já fechados: não invente nem recalcule valores, só explique e priorize. Formato: texto corrido em parágrafos curtos, com listas simples usando "-" quando ajudar. Sem títulos em markdown, sem negrito. Entre 250 e 450 palavras. Termine com os cuidados que o investidor deve ter antes de executar (impostos, câmbio, ativos marcados com flags).`;

const fmt = (n: number | null | undefined, digits = 1): string =>
  n == null || !Number.isFinite(n) ? "-" : n.toFixed(digits);
const bi = (n: number | null | undefined): string => (n == null ? "-" : (n / 1e9).toFixed(1));
const mi = (n: number | null | undefined): string => (n == null ? "-" : (n / 1e6).toFixed(1));

function assetLine(a: CompactAsset, category: string): string {
  const base = `${a.ticker}\t${(a.name ?? "-").slice(0, 28)}\t${(a.sector ?? a.segment ?? "-").slice(0, 26)}`;
  if (category === "fiis") {
    return [
      base,
      fmt(a.price, 2),
      mi(a.marketCap),
      fmt(a.dy),
      fmt(a.pb, 2),
      fmt(a.ffoYield),
      fmt(a.capRate),
      fmt(a.vacancy),
      a.properties == null ? "-" : String(a.properties),
      mi(a.liquidity),
    ].join("\t");
  }
  if (category === "acoes_br") {
    return [
      base,
      fmt(a.price, 2),
      bi(a.marketCap),
      fmt(a.pe),
      fmt(a.pb, 2),
      fmt(a.dy),
      fmt(a.roe),
      fmt(a.roic),
      fmt(a.netMargin),
      fmt(a.netDebtToEquity, 2),
      fmt(a.currentRatio, 2),
      fmt(a.revenueGrowth5y),
      mi(a.liquidity),
    ].join("\t");
  }
  // EUA e internacional
  return [
    base,
    a.kind,
    bi(a.marketCap),
    fmt(a.pe),
    fmt(a.pb, 2),
    fmt(a.dy),
    fmt(a.roe),
    fmt(a.netMargin),
    fmt(a.revenueGrowth5y),
    fmt(a.earningsGrowth),
    fmt(a.netDebtToEquity, 2),
    fmt(a.currentRatio, 2),
    a.epsHistory && a.epsHistory.length > 0 ? a.epsHistory.map((v) => fmt(v, 2)).join(";") : "-",
  ].join("\t");
}

function header(category: string): string {
  if (category === "fiis") {
    return "ticker\tnome\tsegmento\tpreço R$\tvalor mercado R$ mi\tDY %\tP/VP\tFFO yield %\tcap rate %\tvacância %\timóveis\tliquidez R$ mi/dia";
  }
  if (category === "acoes_br") {
    return "ticker\tnome\tsetor\tpreço R$\tvalor mercado R$ bi\tP/L\tP/VP\tDY %\tROE %\tROIC %\tmargem líq %\tdív líq/PL\tliq corrente\tcresc receita 5a %\tliquidez R$ mi/dia";
  }
  return "ticker\tnome\tsetor\ttipo\tvalor mercado US$ bi\tP/L\tP/VP\tDY %\tROE %\tmargem líq %\tcresc receita 5a %\tcresc EPS 5a %\tdív total/PL\tliq corrente\tEPS anual (recente→antigo)";
}

function holdingLine(h: CompactHolding, category: string): string {
  const cur = h.currency === "USD" ? "US$" : "R$";
  return `${assetLine(h, category)}\t| posição: ${fmt(h.quantity, 4)} un · preço médio ${cur} ${fmt(h.avgPrice, 2)} · atual ${cur} ${fmt(h.currentPrice, 2)} · resultado ${fmt(h.gainPct)}% · R$ ${fmt(h.valueBrl, 0)} · ${fmt(h.weightPct)}% da caixa${h.heldButFailing ? ` · atenção: ${h.heldButFailing}` : ""}${h.flags.length ? ` · ${h.flags.join("; ")}` : ""}`;
}

const CATEGORY_HINT: Record<string, string> = {
  acoes_br: "Ações Brasileiras (B3). Valores em reais.",
  fiis: "Fundos Imobiliários (B3). Valores em reais.",
  acoes_eua: "Ações Americanas (listadas nos EUA, em dólar). Empresas de crescimento são bem-vindas.",
  internacional: "Internacional fora dos EUA (ETFs ex-EUA e ADRs listados nos EUA, em dólar).",
};

export function buildRankingPrompt(prepared: PreparedState, cat: PreparedCategory, mode: "standard" | "full"): string {
  const newSlots = cat.capLeft == null ? cat.globalCapLeft : Math.min(cat.capLeft, cat.globalCapLeft);
  const maxBuys = Math.max(1, Math.min(6, cat.candidates.length + cat.holdings.length));
  const lines: string[] = [];
  lines.push(`Categoria: ${cat.name} (${cat.slug}). ${CATEGORY_HINT[cat.slug] ?? ""}`);
  lines.push(`Modo da análise: ${mode === "full" ? "completo (varra tudo, inclusive oportunidades fora do desbalanceamento)" : "padrão (foco no que está em déficit)"}.`);
  lines.push(
    cat.aporte > 0
      ? `Aporte destinado a esta categoria nesta rodada: R$ ${cat.aporte.toFixed(2)} (de um aporte total de R$ ${prepared.level1.contribution.toFixed(2)}).`
      : "Sem aporte para esta categoria nesta rodada: ainda assim revise as posições e aponte em buys as melhores oportunidades caso sobre dinheiro (weight_pct somando 100).",
  );
  lines.push(
    `Teto de ativos: ${newSlots > 0 ? `${newSlots} vaga(s) para ativo novo` : "sem vaga para ativo novo (só reforço ou substituição)"}${cat.capLeft != null ? `; subteto da categoria: ${cat.capLeft} vaga(s)` : ""}; teto global restante: ${cat.globalCapLeft}.`,
  );
  lines.push(`Recomende no máximo ${maxBuys} compras. Câmbio de referência USD/BRL: ${prepared.fxRate ? prepared.fxRate.toFixed(4) : "indisponível"}.`);
  lines.push("");
  lines.push(`POSIÇÕES ATUAIS NA CATEGORIA (${cat.holdings.length}):`);
  if (cat.holdings.length === 0) lines.push("(nenhuma)");
  else {
    lines.push(header(cat.slug));
    for (const h of cat.holdings) lines.push(holdingLine(h, cat.slug));
  }
  lines.push("");
  lines.push(
    `CANDIDATOS APROVADOS NO PRÉ-FILTRO (${cat.candidates.length} de ${cat.screen.universe} do universo; cortes: ${cat.screen.rejected.map(([r, n]) => `${n} ${r}`).join(", ") || "nenhum"}):`,
  );
  if (cat.candidates.length === 0) lines.push("(nenhum candidato com dados; recomende só entre as posições atuais ou deixe buys vazio)");
  else {
    lines.push(header(cat.slug));
    for (const c of cat.candidates) lines.push(assetLine(c, cat.slug));
  }
  lines.push("");
  lines.push("Responda no formato JSON pedido.");
  return lines.join("\n");
}

export function buildNarrativePrompt(
  prepared: PreparedState,
  rankings: Record<string, RankingOutput>,
  shopping: ShoppingState,
  mode: "standard" | "full",
): string {
  const l1 = prepared.level1;
  const lines: string[] = [];
  lines.push(`Aporte: R$ ${l1.contribution.toFixed(2)}. Carteira considerada: R$ ${l1.total.toFixed(2)}. Modo: ${mode === "full" ? "completo" : "padrão"}.`);
  lines.push(
    `Reserva de emergência: R$ ${l1.reserve.current.toFixed(2)} de R$ ${l1.reserve.target.toFixed(2)} definidos${l1.reserve.suggested > 0 ? `; recebe R$ ${l1.reserve.suggested.toFixed(2)} deste aporte` : ""}.`,
  );
  lines.push("Caixas vs meta (atual % → meta %, aporte sugerido):");
  for (const c of l1.categories) {
    lines.push(`- ${c.name}: ${c.currentPct.toFixed(1)}% → ${c.targetPct.toFixed(0)}%, aporte R$ ${c.suggested.toFixed(2)}, ${c.assetCount}${c.maxAssets != null ? `/${c.maxAssets}` : ""} ativos`);
  }
  if (l1.unclassified > 0) lines.push(`Ativos ainda não classificados (fora da análise): ${l1.unclassified}.`);
  if (prepared.skipped.length > 0) {
    lines.push(`Categorias não analisadas pela IA: ${prepared.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.`);
  }
  lines.push("");
  for (const cat of prepared.categories) {
    const r = rankings[cat.slug];
    if (!r) continue;
    lines.push(`${cat.name}: aporte R$ ${cat.aporte.toFixed(2)}.`);
    for (const b of r.buys) lines.push(`- compra ${b.action === "new" ? "nova" : "reforço"} ${b.ticker} (${b.weight_pct.toFixed(0)}%): ${b.rationale}${b.flags.length ? ` [${b.flags.join("; ")}]` : ""}`);
    for (const h of r.holdings_review.filter((x) => x.verdict !== "keep")) lines.push(`- posição ${h.ticker}: ${h.verdict}${h.trim_pct > 0 ? ` ${h.trim_pct}%` : ""} — ${h.rationale}`);
    for (const s of r.substitutions) lines.push(`- substituição: vender ${s.sell}, comprar ${s.buy} — ${s.rationale}`);
    if (r.notes) lines.push(`- notas: ${r.notes}`);
    lines.push("");
  }
  lines.push("Lista de compras consolidada:");
  for (const it of shopping.items.filter((i) => i.type === "buy" || i.type === "reinforce")) {
    lines.push(`- ${it.ticker} (${it.categoryName}): R$ ${(it.amountBrl ?? 0).toFixed(2)}${it.quantity != null ? `, ~${it.quantity} un a ${it.currency === "USD" ? "US$" : "R$"} ${(it.price ?? 0).toFixed(2)}` : ""}`);
  }
  lines.push(`Total em compras: R$ ${shopping.totalBuyBrl.toFixed(2)}; não alocado: R$ ${shopping.unallocatedBrl.toFixed(2)}.`);
  const sales = shopping.items.filter((i) => i.type === "trim" || i.type === "sell");
  if (sales.length > 0) {
    lines.push("Vendas sugeridas:");
    for (const s of sales) lines.push(`- ${s.type === "sell" ? "vender" : "reduzir"} ${s.ticker}: R$ ${(s.amountBrl ?? 0).toFixed(2)} — ${s.rationale}${s.taxNote ? ` (${s.taxNote})` : ""}`);
  }
  if (shopping.notes.length > 0) lines.push(`Observações: ${shopping.notes.join(" ")}`);
  lines.push("");
  lines.push("Escreva o relatório.");
  return lines.join("\n");
}
