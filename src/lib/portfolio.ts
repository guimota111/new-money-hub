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
    /** sempre em BRL — é o que vale para patrimônio e snapshots */
    current_price: number | string | null;
    current_price_updated_at: string | null;
    /** só vêm quando a página pede INSTRUMENT_SELECT_FULL (migração 0008) */
    currency?: string | null;
    current_price_native?: number | string | null;
  } | null;
}

// "bitcoin" fica na lista até a migração 0008 renomear a classe para "cripto".
export const CLASS_ORDER = [
  "conta_corrente",
  "renda_fixa",
  "acoes",
  "fiis",
  "bolsa_eua",
  "bitcoin",
  "cripto",
] as const;

export function isCryptoClass(slug: string | null | undefined): boolean {
  return slug === "bitcoin" || slug === "cripto";
}

// Negociado nos EUA, em dólar (Finnhub + PTAX). A exposição econômica (EUA
// vs internacional) é decidida na categoria do consultor, não aqui.
export function isUsClass(slug: string | null | undefined): boolean {
  return slug === "bolsa_eua";
}

export const INSTRUMENT_SELECT = "ticker, current_price, current_price_updated_at";
export const INSTRUMENT_SELECT_FULL = `${INSTRUMENT_SELECT}, currency, current_price_native`;

// Valor atual da posição em BRL. Conta corrente guarda o saldo direto em
// quantity; as demais classes usam cotação de mercado (já em BRL) quando
// existe, senão o preço médio pago. Para ativos em dólar sem cotação ainda o
// preço médio está em US$ e o valor sai subestimado até o próximo cron.
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
