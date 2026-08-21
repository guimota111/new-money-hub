import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBrapiQuote,
  fetchTesouroDiretoPrices,
  fetchBitcoinBRL,
} from "@/lib/prices";

export const maxDuration = 120;

interface InstrumentRow {
  id: string;
  ticker: string | null;
  external_id: string | null;
  asset_classes: { slug: string } | null;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const brapiToken = process.env.BRAPI_TOKEN ?? "";
  const summary = {
    quotes: 0,
    treasury: 0,
    bitcoin: 0,
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
  const priceUpdates: { id: string; price: number; source: string }[] = [];

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
          priceUpdates.push({ id: instrument.id, price, source: "brapi" });
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
          priceUpdates.push({ id: instrument.id, price, source: "tesouro_transparente" });
          summary.treasury++;
        } else {
          summary.errors.push(`título não encontrado no CSV: ${instrument.external_id}`);
        }
      }
    } catch (e) {
      summary.errors.push(`tesouro csv: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  // ---- Bitcoin via CoinGecko ---------------------------------------------
  const btcInstrument = instruments.find(
    (i) => i.asset_classes?.slug === "bitcoin" && i.ticker === "BTC",
  );
  if (btcInstrument) {
    try {
      const price = await fetchBitcoinBRL();
      if (price != null) {
        priceUpdates.push({ id: btcInstrument.id, price, source: "coingecko" });
        summary.bitcoin++;
      }
    } catch (e) {
      summary.errors.push(`coingecko: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  // ---- grava preços + histórico ------------------------------------------
  for (const update of priceUpdates) {
    await admin
      .from("market_instruments")
      .update({ current_price: update.price, current_price_updated_at: now })
      .eq("id", update.id);
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

  return NextResponse.json(summary);
}
