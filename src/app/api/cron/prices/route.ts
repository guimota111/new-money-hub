import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBrapiQuote,
  fetchCryptoBRL,
  fetchFinnhubQuote,
  fetchPtaxUsdBrl,
  fetchTesouroDiretoPrices,
} from "@/lib/prices";
import { isCryptoClass, isUsClass } from "@/lib/portfolio";
import { isMissingTableError } from "@/lib/supabase/errors";
import { refreshFundamentalsDaily } from "@/lib/fundamentals/cache";

// preços (~1 min) + fundamentos em lote (orçamento de 150 s); o plano Hobby
// permite até 300 s e só 2 crons, por isso tudo roda aqui
export const maxDuration = 300;

interface InstrumentRow {
  id: string;
  ticker: string | null;
  external_id: string | null;
  asset_classes: { slug: string } | null;
}

// current_price é sempre BRL; native é o preço na moeda do ativo (igual ao
// BRL para tudo que não é bolsa americana)
interface PriceUpdate {
  id: string;
  price: number;
  native: number;
  currency: "BRL" | "USD";
  source: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const brapiToken = process.env.BRAPI_TOKEN ?? "";
  const finnhubToken = process.env.FINNHUB_TOKEN ?? "";
  const summary = {
    quotes: 0,
    treasury: 0,
    us: 0,
    crypto: 0,
    fx: null as number | null,
    snapshots: 0,
    errors: [] as string[],
  };

  // ---- garante instrumentos para ativos do Tesouro ------------------------
  const { data: classes } = await admin.from("asset_classes").select("id, slug");
  const classIdBySlug = Object.fromEntries((classes ?? []).map((c) => [c.slug, c.id]));

  const { data: treasuryAssets } = await admin
    .from("assets")
    .select("id, name, instrument_id")
    .is("instrument_id", null)
    .ilike("name", "Tesouro%");
  for (const asset of treasuryAssets ?? []) {
    const { data: existing } = await admin
      .from("market_instruments")
      .select("id")
      .eq("external_id", asset.name)
      .limit(1)
      .maybeSingle();
    let instrumentId = existing?.id;
    if (!instrumentId) {
      const { data: created, error } = await admin
        .from("market_instruments")
        .insert({
          asset_class_id: classIdBySlug["renda_fixa"],
          external_id: asset.name,
          name: asset.name,
        })
        .select("id")
        .single();
      if (error) {
        summary.errors.push(`instrumento tesouro ${asset.name}: ${error.message}`);
        continue;
      }
      instrumentId = created.id;
    }
    await admin.from("assets").update({ instrument_id: instrumentId }).eq("id", asset.id);
  }

  // ---- carrega instrumentos ----------------------------------------------
  const { data: instrumentData } = await admin
    .from("market_instruments")
    .select("id, ticker, external_id, asset_classes(slug)");
  const instruments = (instrumentData ?? []) as unknown as InstrumentRow[];

  const now = new Date().toISOString();
  const priceUpdates: PriceUpdate[] = [];

  // ---- migração 0008 (fx_rates + colunas de moeda) já rodou? --------------
  const fxProbe = await admin.from("fx_rates").select("pair").limit(1);
  const fxReady = !isMissingTableError(fxProbe.error);

  // ---- câmbio PTAX (Banco Central) ----------------------------------------
  let usdBrl: number | null = null;
  if (fxReady) {
    try {
      const ptax = await fetchPtaxUsdBrl();
      if (ptax) {
        usdBrl = ptax.rate;
        summary.fx = ptax.rate;
        const { error } = await admin.from("fx_rates").upsert(
          { pair: "USDBRL", rate: ptax.rate, rate_date: ptax.date, source: "bcb_ptax", fetched_at: now },
          { onConflict: "pair" },
        );
        if (error) summary.errors.push(`fx_rates: ${error.message}`);
      } else {
        summary.errors.push("PTAX indisponível no Banco Central");
      }
    } catch (e) {
      summary.errors.push(`ptax: ${e instanceof Error ? e.message : "erro"}`);
    }
    if (usdBrl == null) {
      // sem PTAX nova, usa a última gravada
      const { data: last } = await admin
        .from("fx_rates")
        .select("rate")
        .eq("pair", "USDBRL")
        .maybeSingle();
      if (last?.rate != null) usdBrl = Number(last.rate);
    }
  }

  // ---- ações / FIIs via brapi --------------------------------------------
  const tickerInstruments = instruments.filter(
    (i) =>
      i.ticker &&
      (i.asset_classes?.slug === "acoes" || i.asset_classes?.slug === "fiis"),
  );
  if (brapiToken && tickerInstruments.length > 0) {
    for (const instrument of tickerInstruments) {
      try {
        const price = await fetchBrapiQuote(instrument.ticker!, brapiToken);
        if (price != null) {
          priceUpdates.push({ id: instrument.id, price, native: price, currency: "BRL", source: "brapi" });
          summary.quotes++;
        } else {
          summary.errors.push(`sem cotação: ${instrument.ticker}`);
        }
      } catch (e) {
        summary.errors.push(
          `brapi ${instrument.ticker}: ${e instanceof Error ? e.message : "erro"}`,
        );
      }
    }
  } else if (tickerInstruments.length > 0) {
    summary.errors.push("BRAPI_TOKEN não configurado — ações/FIIs não atualizados");
  }

  // ---- Tesouro via CSV oficial do Tesouro Transparente --------------------
  const treasuryInstruments = instruments.filter(
    (i) => i.asset_classes?.slug === "renda_fixa" && i.external_id,
  );
  if (treasuryInstruments.length > 0) {
    try {
      const treasuryPrices = await fetchTesouroDiretoPrices();
      for (const instrument of treasuryInstruments) {
        const price = treasuryPrices.get(instrument.external_id!.trim());
        if (price != null) {
          priceUpdates.push({ id: instrument.id, price, native: price, currency: "BRL", source: "tesouro_transparente" });
          summary.treasury++;
        } else {
          summary.errors.push(`título não encontrado no CSV: ${instrument.external_id}`);
        }
      }
    } catch (e) {
      summary.errors.push(`tesouro csv: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  // ---- bolsa americana via Finnhub (US$ → BRL pela PTAX) -----------------
  const usInstruments = instruments.filter((i) => i.ticker && isUsClass(i.asset_classes?.slug));
  if (usInstruments.length > 0) {
    if (!fxReady) {
      summary.errors.push("bolsa americana: rode supabase/migrations/0008_bolsa_eua_fx_cripto.sql");
    } else if (!finnhubToken) {
      summary.errors.push("FINNHUB_TOKEN não configurado — bolsa americana não atualizada");
    } else if (usdBrl == null) {
      summary.errors.push("sem câmbio USD/BRL — bolsa americana não atualizada");
    } else {
      for (const instrument of usInstruments) {
        try {
          const usd = await fetchFinnhubQuote(instrument.ticker!, finnhubToken);
          if (usd != null) {
            priceUpdates.push({
              id: instrument.id,
              price: usd * usdBrl,
              native: usd,
              currency: "USD",
              source: "finnhub",
            });
            summary.us++;
          } else {
            summary.errors.push(`sem cotação: ${instrument.ticker}`);
          }
        } catch (e) {
          summary.errors.push(
            `finnhub ${instrument.ticker}: ${e instanceof Error ? e.message : "erro"}`,
          );
        }
        // plano grátis: 60 chamadas/min
        await sleep(150);
      }
    }
  }

  // ---- cripto (BTC, ETH) via CoinGecko -----------------------------------
  const cryptoInstruments = instruments.filter(
    (i) => i.ticker && isCryptoClass(i.asset_classes?.slug),
  );
  if (cryptoInstruments.length > 0) {
    try {
      const cryptoPrices = await fetchCryptoBRL(cryptoInstruments.map((i) => i.ticker!));
      for (const instrument of cryptoInstruments) {
        const price = cryptoPrices.get(instrument.ticker!);
        if (price != null) {
          priceUpdates.push({ id: instrument.id, price, native: price, currency: "BRL", source: "coingecko" });
          summary.crypto++;
        } else {
          summary.errors.push(`sem cotação cripto: ${instrument.ticker}`);
        }
      }
    } catch (e) {
      summary.errors.push(`coingecko: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  // ---- grava preços + histórico ------------------------------------------
  for (const update of priceUpdates) {
    const patch: Record<string, unknown> = {
      current_price: update.price,
      current_price_updated_at: now,
    };
    if (fxReady) {
      patch.current_price_native = update.native;
      patch.currency = update.currency;
    }
    await admin.from("market_instruments").update(patch).eq("id", update.id);
  }
  if (priceUpdates.length > 0) {
    await admin.from("instrument_price_history").insert(
      priceUpdates.map((u) => ({
        instrument_id: u.id,
        price: u.price,
        source: u.source,
        fetched_at: now,
      })),
    );
  }

  // ---- snapshots do dia (todos os usuários) ------------------------------
  const { data: allAssets } = await admin
    .from("assets")
    .select(
      "id, quantity, average_price, asset_classes(slug), market_instruments(current_price)",
    );
  const today = now.slice(0, 10);
  const snapshotRows = (allAssets ?? []).map((asset) => {
    const slug = (asset.asset_classes as unknown as { slug: string } | null)?.slug;
    const quantity = Number(asset.quantity);
    const marketPrice = (
      asset.market_instruments as unknown as { current_price: number | null } | null
    )?.current_price;
    const value =
      slug === "conta_corrente"
        ? quantity
        : quantity *
          (marketPrice != null
            ? Number(marketPrice)
            : asset.average_price != null
              ? Number(asset.average_price)
              : 0);
    return { asset_id: asset.id, total_value: value, snapshot_date: today };
  });
  if (snapshotRows.length > 0) {
    const { error } = await admin
      .from("asset_snapshots")
      .upsert(snapshotRows, { onConflict: "asset_id,snapshot_date" });
    if (error) summary.errors.push(`snapshots: ${error.message}`);
    else summary.snapshots = snapshotRows.length;
  }

  // ---- fundamentos (Consultor): B3 semanal, EUA em lotes diários ---------
  let fundamentals: Record<string, unknown> = {};
  try {
    fundamentals = await refreshFundamentalsDaily(admin, {
      brapiToken,
      finnhubToken,
      deadlineMs: 150_000,
    });
  } catch (e) {
    summary.errors.push(`fundamentos: ${e instanceof Error ? e.message : "erro"}`);
  }

  return NextResponse.json({ ...summary, fundamentals });
}
