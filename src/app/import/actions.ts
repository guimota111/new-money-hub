"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseB3Xlsx,
  incomeCategorySlug,
  movementKey,
  POSITION_TYPES,
  type B3Movement,
} from "@/lib/b3";

export async function importB3(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/import?erro=${encodeURIComponent("Selecione o arquivo .xlsx exportado da B3.")}`);
  }

  let parsed: B3Movement[];
  try {
    parsed = parseB3Xlsx(await file.arrayBuffer());
  } catch (e) {
    redirect(`/import?erro=${encodeURIComponent(e instanceof Error ? e.message : "Arquivo inválido.")}`);
  }

  // tickers geridos pela sincronização automática do Nubank ficam de fora —
  // lá o cron é a fonte da verdade (evita contagem dupla de compra/provento)
  const { data: managedAssets } = await supabase
    .from("assets")
    .select("name")
    .eq("user_id", user.id)
    .not("metadata->>pluggy_investment_id", "is", null);
  const managed = new Set((managedAssets ?? []).map((a) => a.name));
  const skippedAuto = parsed.filter((m) => m.ticker && managed.has(m.ticker)).length;
  parsed = parsed.filter((m) => !(m.ticker && managed.has(m.ticker)));

  // ---- movements novos (dedup contra o que já existe) ----------------------
  const known = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data: rows } = await supabase
      .from("movements")
      .select("moved_at, direction, movement_type, ticker, quantity, total_value")
      .eq("user_id", user.id)
      .range(offset, offset + 999);
    for (const r of rows ?? []) known.add(movementKey(r));
    if (!rows || rows.length < 1000) break;
  }

  // extratos podem repetir linhas idênticas legítimas (ex: 2 JCP iguais no
  // mesmo dia) — dedup respeita multiplicidade dentro do próprio arquivo
  const seenInFile = new Map<string, number>();
  const knownCount = new Map<string, number>();
  for (const k of known) knownCount.set(k, (knownCount.get(k) ?? 0) + 1);

  const newMovements = parsed.filter((m) => {
    const key = movementKey(m);
    const nthInFile = (seenInFile.get(key) ?? 0) + 1;
    seenInFile.set(key, nthInFile);
    return nthInFile > (knownCount.get(key) ?? 0);
  });

  if (newMovements.length > 0) {
    const { error } = await supabase.from("movements").insert(
      newMovements.map((m) => ({ ...m, user_id: user.id, source: "b3_import" })),
    );
    if (error) redirect(`/import?erro=${encodeURIComponent(error.message)}`);
  }

  // ---- proventos das linhas novas -> incomes -------------------------------
  const { data: cats } = await supabase.from("income_categories").select("id, slug");
  const catId = (slug: string) => (cats ?? []).find((c) => c.slug === slug)?.id;
  const newIncomes = newMovements
    .map((m) => ({ m, slug: incomeCategorySlug(m) }))
    .filter((x): x is { m: B3Movement; slug: string } => x.slug != null)
    .map(({ m, slug }) => ({
      user_id: user.id,
      income_category_id: catId(slug),
      amount: m.total_value,
      description: `${m.ticker ?? m.product} — ${m.movement_type}`,
      received_at: m.moved_at,
      source: "b3_import",
    }));
  if (newIncomes.length > 0) {
    const { error } = await supabase.from("incomes").insert(newIncomes);
    if (error) redirect(`/import?erro=${encodeURIComponent(error.message)}`);
  }

  // ---- recomputa posições dos tickers afetados -----------------------------
  const affected = [
    ...new Set(
      newMovements
        .filter((m) => POSITION_TYPES.has(m.movement_type) && m.ticker)
        .map((m) => m.ticker as string),
    ),
  ];
  const updatedPositions: string[] = [];
  if (affected.length > 0) {
    const { data: allMovs } = await supabase
      .from("movements")
      .select("moved_at, direction, movement_type, ticker, quantity, unit_price, total_value")
      .eq("user_id", user.id)
      .in("ticker", affected)
      .order("moved_at", { ascending: true })
      .limit(10000);

    const { data: classes } = await supabase.from("asset_classes").select("id, slug");
    const classId = (slug: string) => (classes ?? []).find((c) => c.slug === slug)?.id;

    for (const ticker of affected) {
      let qty = 0;
      let cost = 0;
      for (const m of (allMovs ?? []).filter((m) => m.ticker === ticker)) {
        if (!POSITION_TYPES.has(m.movement_type)) continue;
        const q = Number(m.quantity ?? 0);
        const value = Number(m.total_value ?? q * Number(m.unit_price ?? 0));
        if (m.direction === "credito") {
          qty += q;
          cost += value;
        } else {
          const avg = qty > 0 ? cost / qty : 0;
          qty -= q;
          cost -= avg * q;
        }
      }
      qty = Math.round(qty * 1e8) / 1e8;
      if (qty <= 0) continue;
      const avgPrice = Math.round((cost / qty) * 1e6) / 1e6;

      const isTesouro = ticker.startsWith("Tesouro");
      const slug = isTesouro ? "renda_fixa" : /11$/.test(ticker) ? "fiis" : "acoes";

      const { data: existingAsset } = await supabase
        .from("assets")
        .select("id")
        .eq("user_id", user.id)
        .eq("name", ticker)
        .limit(1)
        .maybeSingle();

      if (existingAsset) {
        await supabase
          .from("assets")
          .update({ quantity: qty, average_price: avgPrice })
          .eq("id", existingAsset.id);
      } else {
        // instrumento: por ticker (ações/FIIs) ou external_id (Tesouro).
        // a criação usa service role — RLS só libera leitura para usuários
        const admin = createAdminClient();
        let instrumentId: string | null = null;
        const instQuery = supabase.from("market_instruments").select("id").limit(1);
        const { data: inst } = isTesouro
          ? await instQuery.eq("external_id", ticker).maybeSingle()
          : await instQuery.eq("ticker", ticker).maybeSingle();
        instrumentId = inst?.id ?? null;
        if (!instrumentId) {
          const { data: created } = await admin
            .from("market_instruments")
            .insert(
              isTesouro
                ? { asset_class_id: classId("renda_fixa"), external_id: ticker, name: ticker }
                : { asset_class_id: classId(slug), ticker, name: ticker },
            )
            .select("id")
            .single();
          instrumentId = created?.id ?? null;
        }
        await supabase.from("assets").insert({
          user_id: user.id,
          asset_class_id: classId(slug),
          instrument_id: instrumentId,
          name: ticker,
          quantity: qty,
          average_price: avgPrice,
          metadata: isTesouro ? { indexador: "ipca" } : {},
        });
      }
      updatedPositions.push(ticker);
    }
  }

  revalidatePath("/movements");
  revalidatePath("/incomes");
  revalidatePath("/assets");
  revalidatePath("/");

  const params = new URLSearchParams({
    mov: String(newMovements.length),
    inc: String(newIncomes.length),
    dup: String(parsed.length - newMovements.length),
  });
  if (skippedAuto > 0) params.set("auto", String(skippedAuto));
  if (updatedPositions.length > 0) params.set("pos", updatedPositions.join(","));
  redirect(`/import?${params.toString()}`);
}
