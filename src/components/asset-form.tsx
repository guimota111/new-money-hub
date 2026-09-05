import { SubmitButton } from "@/components/submit-button";

const inputClass =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

interface AssetFormDefaults {
  id?: string;
  name?: string;
  ticker?: string | null;
  quantity?: number | string;
  average_price?: number | string | null;
  purchase_date?: string | null;
  metadata?: Record<string, unknown>;
}

interface AssetFormProps {
  classSlug: string;
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  defaults?: AssetFormDefaults;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

export function AssetForm({ classSlug, action, submitLabel, defaults }: AssetFormProps) {
  const meta = defaults?.metadata ?? {};

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="class" value={classSlug} />
      {defaults?.id && <input type="hidden" name="id" value={defaults.id} />}

      {(classSlug === "acoes" || classSlug === "fiis") && (
        <>
          <Field label="Ticker">
            <input
              name="ticker"
              required
              placeholder={classSlug === "acoes" ? "Ex: BBAS3" : "Ex: HGLG11"}
              defaultValue={defaults?.ticker ?? ""}
              className={`${inputClass} uppercase`}
            />
          </Field>
          <Field label="Quantidade">
            <input
              name="quantity"
              required
              inputMode="decimal"
              placeholder="Ex: 100"
              defaultValue={defaults?.quantity ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Preço médio (R$)">
            <input
              name="average_price"
              required
              inputMode="decimal"
              placeholder="Ex: 28,50"
              defaultValue={defaults?.average_price ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Data de compra (opcional)">
            <input
              name="purchase_date"
              type="date"
              defaultValue={defaults?.purchase_date ?? ""}
              className={inputClass}
            />
          </Field>
        </>
      )}

      {classSlug === "bolsa_eua" && (
        <>
          <Field label="Símbolo (ticker nos EUA)">
            <input
              name="ticker"
              required
              placeholder="Ex: AAPL, VOO, VXUS"
              defaultValue={defaults?.ticker ?? ""}
              className={`${inputClass} uppercase`}
            />
          </Field>
          <Field label="Quantidade (aceita fração)">
            <input
              name="quantity"
              required
              inputMode="decimal"
              placeholder="Ex: 2,5"
              defaultValue={defaults?.quantity ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Preço médio (US$)">
            <input
              name="average_price"
              required
              inputMode="decimal"
              placeholder="Ex: 187,40"
              defaultValue={defaults?.average_price ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Data de compra (opcional)">
            <input
              name="purchase_date"
              type="date"
              defaultValue={defaults?.purchase_date ?? ""}
              className={inputClass}
            />
          </Field>
          <p className="text-xs text-zinc-500">
            Cotação pela Finnhub e conversão para reais pela PTAX do dia. Se a
            exposição é EUA ou Internacional você define no Consultor.
          </p>
        </>
      )}

      {(classSlug === "bitcoin" || classSlug === "cripto") && (
        <>
          {classSlug === "cripto" && (
            <Field label="Moeda">
              <select
                name="moeda"
                required
                defaultValue={defaults?.ticker ?? "BTC"}
                className={inputClass}
              >
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
              </select>
            </Field>
          )}
          <Field label={classSlug === "cripto" ? "Quantidade" : "Quantidade de BTC"}>
            <input
              name="quantity"
              required
              inputMode="decimal"
              placeholder="Ex: 0,015"
              defaultValue={defaults?.quantity ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Preço médio pago por unidade (R$, opcional)">
            <input
              name="average_price"
              inputMode="decimal"
              placeholder="Ex: 350.000,00"
              defaultValue={defaults?.average_price ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Onde está guardado (opcional)">
            <input
              name="local"
              placeholder="Ex: Cold wallet"
              defaultValue={(meta.local as string) ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Data de compra (opcional)">
            <input
              name="purchase_date"
              type="date"
              defaultValue={defaults?.purchase_date ?? ""}
              className={inputClass}
            />
          </Field>
        </>
      )}

      {classSlug === "renda_fixa" && (
        <>
          <Field label="Nome do título">
            <input
              name="titulo"
              required
              placeholder="Ex: Tesouro IPCA+ 2035"
              defaultValue={defaults?.name ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Indexador">
            <select
              name="indexador"
              required
              defaultValue={(meta.indexador as string) ?? ""}
              className={inputClass}
            >
              <option value="" disabled>
                Selecione
              </option>
              <option value="selic">Selic</option>
              <option value="ipca">IPCA+</option>
              <option value="prefixado">Prefixado</option>
            </select>
          </Field>
          <Field label="Taxa contratada (% a.a., opcional)">
            <input
              name="taxa"
              inputMode="decimal"
              placeholder="Ex: 6,64"
              defaultValue={(meta.taxa_contratada as number) ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Quantidade de títulos">
            <input
              name="quantity"
              required
              inputMode="decimal"
              placeholder="Ex: 1,37"
              defaultValue={defaults?.quantity ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Preço médio pago (R$)">
            <input
              name="average_price"
              required
              inputMode="decimal"
              placeholder="Ex: 3.245,10"
              defaultValue={defaults?.average_price ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Data de compra (opcional)">
            <input
              name="purchase_date"
              type="date"
              defaultValue={defaults?.purchase_date ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Vencimento (opcional)">
            <input
              name="vencimento"
              type="date"
              defaultValue={(meta.vencimento as string) ?? ""}
              className={inputClass}
            />
          </Field>
        </>
      )}

      {classSlug === "conta_corrente" && (
        <>
          <Field label="Banco">
            <input
              name="banco"
              placeholder="Nubank"
              defaultValue={(meta.banco as string) ?? "Nubank"}
              className={inputClass}
            />
          </Field>
          <Field label="Nome">
            <input
              name="nome"
              required
              placeholder="Ex: Conta, Caixinha Viagem"
              defaultValue={defaults?.name ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Tipo">
            <select
              name="tipo"
              required
              defaultValue={(meta.tipo as string) ?? "conta"}
              className={inputClass}
            >
              <option value="conta">Conta corrente</option>
              <option value="caixinha">Caixinha</option>
            </select>
          </Field>
          <Field label="Saldo atual (R$)">
            <input
              name="saldo"
              required
              inputMode="decimal"
              placeholder="Ex: 1.250,00"
              defaultValue={defaults?.quantity ?? ""}
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              name="rende"
              type="checkbox"
              defaultChecked={Boolean(meta.rende_automaticamente)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            Rende automaticamente (100% do CDI)
          </label>
        </>
      )}

      <SubmitButton
        pendingText="Salvando..."
        className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
