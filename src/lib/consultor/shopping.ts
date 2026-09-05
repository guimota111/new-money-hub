import type { RankingOutput } from "./schemas";
import type {
  CompactAsset,
  CompactHolding,
  PreparedState,
  ShoppingItem,
  ShoppingState,
} from "./types";

// Lista de compras (etapa 5 da spec): converte os pesos da IA em reais e
// quantidade aproximada na cotação disponível. Determinístico e sem IA.
// B3: cotas inteiras (fracionário = 1). EUA: fração com 2 casas (Avenue).

export function marketOf(slug: string): "BR" | "US" {
  return slug === "acoes_br" || slug === "fiis" ? "BR" : "US";
}

function taxNoteFor(slug: string, market: "BR" | "US"): string {
  if (market === "US") return "ganho de capital tributável no Brasil; considere IOF e spread do câmbio";
  if (slug === "fiis") return "IR de 20% sobre o ganho, sem isenção";
  return "isento de IR se as vendas do mês ficarem até R$ 20 mil; acima disso, 15% sobre o ganho";
}

export function buildShoppingList(
  prepared: PreparedState,
  rankings: Record<string, RankingOutput>,
  /** "US:AAPL" → preço em US$ buscado na hora para candidatos sem cotação */
  priceOverrides: Map<string, number>,
): ShoppingState {
  const items: ShoppingItem[] = [];
  const notes: string[] = [];
  let totalBuy = 0;
  let totalAporte = 0;

  for (const cat of prepared.categories) {
    const ranking = rankings[cat.slug];
    totalAporte += cat.aporte;
    if (!ranking) continue;
    const market = marketOf(cat.slug);
    const currency: "BRL" | "USD" = market === "US" ? "USD" : "BRL";

    const lookup = (ticker: string): CompactAsset | CompactHolding | undefined =>
      cat.holdings.find((h) => h.ticker === ticker) ?? cat.candidates.find((c) => c.ticker === ticker);
    const priceOf = (ticker: string): number | null => {
      const override = priceOverrides.get(`${market}:${ticker}`);
      if (override != null) return override;
      const asset = lookup(ticker);
      if (!asset) return null;
      if ("currentPrice" in asset && asset.currentPrice != null) return asset.currentPrice;
      return asset.price;
    };
    const toBrl = (price: number | null): number | null => {
      if (price == null) return null;
      if (currency === "BRL") return price;
      return prepared.fxRate ? price * prepared.fxRate : null;
    };

    const buys = ranking.buys.filter((b) => b.weight_pct > 0);
    const weightSum = buys.reduce((s, b) => s + b.weight_pct, 0);
    if (cat.aporte > 0.005 && weightSum > 0) {
      for (const buy of buys) {
        const amount = (cat.aporte * buy.weight_pct) / weightSum;
        const price = priceOf(buy.ticker);
        const priceBrl = toBrl(price);
        const flags = [...buy.flags];
        let quantity: number | null = null;
        if (priceBrl != null && priceBrl > 0) {
          quantity =
            market === "BR"
              ? Math.floor(amount / priceBrl)
              : Math.round((amount / priceBrl) * 100) / 100;
          if (market === "BR" && quantity === 0) flags.push("valor abaixo de 1 cota ao preço atual");
        } else {
          flags.push("sem cotação para estimar a quantidade");
        }
        items.push({
          category: cat.slug,
          categoryName: cat.name,
          ticker: buy.ticker,
          market,
          type: buy.action === "new" ? "buy" : "reinforce",
          amountBrl: Math.round(amount * 100) / 100,
          quantity,
          price,
          currency,
          rationale: buy.rationale,
          flags,
          taxNote: null,
        });
        totalBuy += amount;
      }
    } else if (cat.aporte > 0.005) {
      notes.push(`${cat.name}: a IA não indicou compras, então R$ ${cat.aporte.toFixed(2)} ficam sem destino nesta caixa.`);
    }

    for (const alt of ranking.alternatives) {
      items.push({
        category: cat.slug,
        categoryName: cat.name,
        ticker: alt.ticker,
        market,
        type: "alternative",
        amountBrl: null,
        quantity: null,
        price: priceOf(alt.ticker),
        currency,
        rationale: alt.rationale,
        flags: [],
        taxNote: null,
      });
    }

    for (const review of ranking.holdings_review) {
      if (review.verdict === "keep") continue;
      const holding = cat.holdings.find((h) => h.ticker === review.ticker);
      const pct = review.verdict === "sell" ? 100 : review.verdict === "trim" ? Math.min(100, Math.max(0, review.trim_pct)) : 0;
      const amount = holding && pct > 0 ? (holding.valueBrl * pct) / 100 : null;
      const price = priceOf(review.ticker);
      const priceBrl = toBrl(price);
      const quantity =
        amount != null && priceBrl != null && priceBrl > 0
          ? market === "BR"
            ? Math.floor(amount / priceBrl)
            : Math.round((amount / priceBrl) * 100) / 100
          : null;
      items.push({
        category: cat.slug,
        categoryName: cat.name,
        ticker: review.ticker,
        market,
        type: review.verdict,
        amountBrl: amount == null ? null : Math.round(amount * 100) / 100,
        quantity,
        price,
        currency,
        rationale: review.rationale,
        flags: pct > 0 && pct < 100 ? [`vender ${pct.toFixed(0)}% da posição`] : [],
        taxNote: pct > 0 ? taxNoteFor(cat.slug, market) : null,
      });
    }

    for (const sub of ranking.substitutions) {
      items.push({
        category: cat.slug,
        categoryName: cat.name,
        ticker: sub.buy,
        market,
        type: "substitute",
        amountBrl: null,
        quantity: null,
        price: priceOf(sub.buy),
        currency,
        rationale: `Vender ${sub.sell} para comprar ${sub.buy}: ${sub.rationale}`,
        flags: [`vende ${sub.sell}`],
        taxNote: taxNoteFor(cat.slug, market),
      });
    }
  }

  return {
    items,
    totalBuyBrl: Math.round(totalBuy * 100) / 100,
    unallocatedBrl: Math.max(0, Math.round((totalAporte - totalBuy) * 100) / 100),
    notes,
  };
}
