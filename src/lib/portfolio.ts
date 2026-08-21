export interface AssetRow {
  id: string;
  name: string;
  quantity: number | string;
  average_price: number | string | null;
  purchase_date: string | null;
  metadata: Record<string, unknown>;
  asset_classes: { name: string; slug: string } | null;
  market_instruments: {
    ticker: string | null;
    current_price: number | string | null;
    current_price_updated_at: string | null;
  } | null;
}

export const CLASS_ORDER = [
  "conta_corrente",
  "renda_fixa",
  "acoes",
  "fiis",
  "bitcoin",
] as const;

// Valor atual da posição. Conta corrente guarda o saldo direto em quantity;
// as demais classes usam cotação de mercado quando existe, senão o preço
// médio pago (até a fase de preços automáticos popular as cotações).
export function assetCurrentValue(asset: AssetRow): number {
  const quantity = Number(asset.quantity);
  if (asset.asset_classes?.slug === "conta_corrente") return quantity;

  const marketPrice = asset.market_instruments?.current_price;
  const price =
    marketPrice != null
      ? Number(marketPrice)
      : asset.average_price != null
        ? Number(asset.average_price)
        : null;
  return price != null ? quantity * price : 0;
}
