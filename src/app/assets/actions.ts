"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDecimal } from "@/lib/format";
import { isCryptoClass } from "@/lib/portfolio";
import { fetchFinnhubQuote, fetchPtaxUsdBrl } from "@/lib/prices";

const INDEXADORES = new Set(["selic", "ipca", "prefixado"]);
const TIPOS_CONTA = new Set(["conta", "caixinha"]);
const CRYPTO_COINS: Record<string, string> = { BTC: "Bitcoin", ETH: "Ethereum" };

interface AssetPayload {
  name: string;
  quantity: number;
  average_price: number | null;
  purchase_date: string | null;
  instrument_id: string | null;
  metadata: Record<string, unknown>;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user: user! };
}

async function findOrCreateInstrument(
  assetClassId: string,
  ticker: string,
  name: string,
  currency?: "USD",
): Promise<string> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("market_instruments")
    .select("id")
    .eq("asset_class_id", assetClassId)
    .eq("ticker", ticker)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("market_instruments")
    .insert({ asset_class_id: assetClassId, ticker, name, ...(currency ? { currency } : {}) })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

// Primeira cotação em BRL de um instrumento americano recém-criado, para a
// posição não ficar subestimada até o cron das 21h. Melhor esforço: qualquer
// falha aqui é coberta pelo cron.
async function primeUsInstrumentPrice(instrumentId: string, usdQuote: number) {
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("market_instruments")
      .select("current_price")
      .eq("id", instrumentId)
      .maybeSingle();
    if (existing?.current_price != null) return;

    const { data: fx } = await admin
      .from("fx_rates")
      .select("rate")
      .eq("pair", "USDBRL")
      .maybeSingle();
    const rate = fx?.rate != null ? Number(fx.rate) : (await fetchPtaxUsdBrl())?.rate;
    if (!rate) return;

    await admin
      .from("market_instruments")
      .update({
        current_price: usdQuote * rate,
        current_price_native: usdQuote,
        currency: "USD",
        current_price_updated_at: new Date().toISOString(),
      })
      .eq("id", instrumentId);
  } catch {
    // cron cobre depois
  }
}

function requiredDecimal(formData: FormData, field: string, label: string): number {
  const value = parseDecimal(String(formData.get(field) ?? ""));
  if (value == null || value < 0) throw new Error(`${label} inválido(a).`);
  return value;
}

function optionalDate(formData: FormData, field: string): string | null {
  const value = String(formData.get(field) ?? "").trim();
  return value || null;
}

async function buildPayload(
  assetClass: { id: string; slug: string },
  formData: FormData,
): Promise<AssetPayload> {
  const slug = assetClass.slug;

  if (slug === "acoes" || slug === "fiis") {
    const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,10}$/.test(ticker)) {
      throw new Error("Ticker inválido (ex: BBAS3, HGLG11).");
    }
    const quantity = requiredDecimal(formData, "quantity", "Quantidade");
    if (quantity <= 0) throw new Error("Quantidade deve ser maior que zero.");
    const averagePrice = requiredDecimal(formData, "average_price", "Preço médio");
    const instrumentId = await findOrCreateInstrument(assetClass.id, ticker, ticker);
    return {
      name: ticker,
      quantity,
      average_price: averagePrice,
      purchase_date: optionalDate(formData, "purchase_date"),
      instrument_id: instrumentId,
      metadata: {},
    };
  }

  if (slug === "bolsa_eua") {
    const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
      throw new Error("Símbolo inválido (ex: AAPL, VOO, BRK.B).");
    }
    const quantity = requiredDecimal(formData, "quantity", "Quantidade");
    if (quantity <= 0) throw new Error("Quantidade deve ser maior que zero.");
    const averagePrice = requiredDecimal(formData, "average_price", "Preço médio (US$)");
    // com token da Finnhub, valida o símbolo e já grava a primeira cotação
    const token = process.env.FINNHUB_TOKEN ?? "";
    const usdQuote = token ? await fetchFinnhubQuote(ticker, token) : null;
    if (token && usdQuote == null) {
      throw new Error(`Símbolo ${ticker} não encontrado na bolsa americana.`);
    }
    const instrumentId = await findOrCreateInstrument(assetClass.id, ticker, ticker, "USD");
    if (usdQuote != null) await primeUsInstrumentPrice(instrumentId, usdQuote);
    return {
      name: ticker,
      quantity,
      average_price: averagePrice,
      purchase_date: optionalDate(formData, "purchase_date"),
      instrument_id: instrumentId,
      metadata: { currency: "USD" },
    };
  }

  if (isCryptoClass(slug)) {
    // a classe antiga "bitcoin" só tem BTC; "cripto" (migração 0008) tem BTC e ETH
    const coin =
      slug === "cripto" ? String(formData.get("moeda") ?? "BTC").trim().toUpperCase() : "BTC";
    const coinName = CRYPTO_COINS[coin];
    if (!coinName) throw new Error("Moeda inválida.");
    const quantity = requiredDecimal(formData, "quantity", `Quantidade de ${coin}`);
    if (quantity <= 0) throw new Error("Quantidade deve ser maior que zero.");
    const averagePrice = parseDecimal(String(formData.get("average_price") ?? ""));
    const local = String(formData.get("local") ?? "").trim();
    const instrumentId = await findOrCreateInstrument(assetClass.id, coin, coinName);
    return {
      name: coinName,
      quantity,
      average_price: averagePrice,
      purchase_date: optionalDate(formData, "purchase_date"),
      instrument_id: instrumentId,
      metadata: local ? { local } : {},
    };
  }

  if (slug === "renda_fixa") {
    const titulo = String(formData.get("titulo") ?? "").trim();
    if (!titulo) throw new Error("Informe o nome do título.");
    const indexador = String(formData.get("indexador") ?? "");
    if (!INDEXADORES.has(indexador)) throw new Error("Indexador inválido.");
    const quantity = requiredDecimal(formData, "quantity", "Quantidade de títulos");
    if (quantity <= 0) throw new Error("Quantidade deve ser maior que zero.");
    const averagePrice = requiredDecimal(formData, "average_price", "Preço médio");
    const taxa = parseDecimal(String(formData.get("taxa") ?? ""));
    const vencimento = optionalDate(formData, "vencimento");
    return {
      name: titulo,
      quantity,
      average_price: averagePrice,
      purchase_date: optionalDate(formData, "purchase_date"),
      instrument_id: null,
      metadata: {
        indexador,
        ...(taxa != null ? { taxa_contratada: taxa } : {}),
        ...(vencimento ? { vencimento } : {}),
      },
    };
  }

  if (slug === "conta_corrente") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) throw new Error("Informe o nome da conta/caixinha.");
    const banco = String(formData.get("banco") ?? "").trim() || "Nubank";
    const tipo = String(formData.get("tipo") ?? "");
    if (!TIPOS_CONTA.has(tipo)) throw new Error("Tipo inválido.");
    const saldo = requiredDecimal(formData, "saldo", "Saldo");
    const rende = formData.get("rende") === "on";
    return {
      name: nome,
      quantity: saldo,
      average_price: null,
      purchase_date: null,
      instrument_id: null,
      metadata: { banco, tipo, rende_automaticamente: rende },
    };
  }

  throw new Error("Classe de ativo não suportada.");
}

export async function createAsset(formData: FormData) {
  const classSlug = String(formData.get("class") ?? "");
  const backPath = `/assets/new?class=${encodeURIComponent(classSlug)}`;
  const { supabase, user } = await requireUser();

  const { data: assetClass } = await supabase
    .from("asset_classes")
    .select("id, slug")
    .eq("slug", classSlug)
    .maybeSingle();
  if (!assetClass) redirect("/assets/new?error=Classe%20inv%C3%A1lida");

  let errorMessage: string | null = null;
  try {
    const payload = await buildPayload(assetClass!, formData);
    const { error } = await supabase.from("assets").insert({
      ...payload,
      user_id: user.id,
      asset_class_id: assetClass!.id,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : "Erro ao salvar o ativo.";
  }
  if (errorMessage) redirect(`${backPath}&error=${encodeURIComponent(errorMessage)}`);

  revalidatePath("/assets");
  redirect("/assets");
}

export async function updateAsset(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/assets");
  const backPath = `/assets/${id}/edit`;
  const { supabase } = await requireUser();

  const { data: asset } = await supabase
    .from("assets")
    .select("id, asset_class_id, asset_classes(id, slug)")
    .eq("id", id)
    .maybeSingle();
  if (!asset) redirect("/assets");

  const assetClass = asset!.asset_classes as unknown as { id: string; slug: string };

  let errorMessage: string | null = null;
  try {
    const payload = await buildPayload(assetClass, formData);
    const { error } = await supabase.from("assets").update(payload).eq("id", id);
    if (error) throw new Error(error.message);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : "Erro ao salvar o ativo.";
  }
  if (errorMessage) redirect(`${backPath}?error=${encodeURIComponent(errorMessage)}`);

  revalidatePath("/assets");
  redirect("/assets");
}

export async function deleteAsset(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("assets").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/assets");
}
