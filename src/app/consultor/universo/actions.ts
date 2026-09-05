"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadFundamentalsData,
  MIGRATION_FILE_0009,
  refreshBr,
  refreshDetails,
  refreshUs,
} from "@/lib/fundamentals/cache";
import { US_UNIVERSE } from "@/lib/fundamentals/universe";
import { isCryptoClass, isUsClass } from "@/lib/portfolio";

// Atualização manual das fontes de fundamentos. Roda com service role depois
// de confirmar a sessão; o cron diário faz o mesmo sem clique.

const PATH = "/consultor/universo";

function done(message: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?ok=${encodeURIComponent(message)}`);
}

function fail(message: string): never {
  redirect(`${PATH}?erro=${encodeURIComponent(message)}`);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user: user! };
}

interface HeldRow {
  asset_classes: { slug: string } | null;
  market_instruments: { ticker: string | null } | null;
}

// tickers da carteira do usuário separados por mercado
async function heldTickers(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("assets")
    .select("asset_classes(slug), market_instruments(ticker)")
    .eq("user_id", userId);
  const br: string[] = [];
  const us: string[] = [];
  for (const row of (data ?? []) as unknown as HeldRow[]) {
    const ticker = row.market_instruments?.ticker?.toUpperCase();
    const slug = row.asset_classes?.slug;
    if (!ticker || isCryptoClass(slug)) continue;
    if (isUsClass(slug)) us.push(ticker);
    else if (slug === "acoes" || slug === "fiis") br.push(ticker);
  }
  return { br, us };
}

export async function refreshBrAction() {
  await requireUser();
  const admin = createAdminClient();
  const data = await loadFundamentalsData(admin);
  if (!data.ready) fail(`Rode ${MIGRATION_FILE_0009} no SQL editor do Supabase.`);

  let result;
  try {
    result = await refreshBr(admin, process.env.BRAPI_TOKEN ?? "");
  } catch (e) {
    fail(e instanceof Error ? e.message : "Erro ao atualizar B3.");
  }
  const parts = [
    `${result.stocks} ações e ${result.fiis} FIIs do Fundamentus`,
    `${result.brapiStocks + result.brapiFunds} ativos na lista da brapi`,
  ];
  if (result.errors.length > 0) parts.push(`falhas: ${result.errors.join("; ")}`);
  done(`B3 atualizada: ${parts.join(" · ")}.`);
}

export async function refreshUsAction() {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const data = await loadFundamentalsData(admin);
  if (!data.ready) fail(`Rode ${MIGRATION_FILE_0009} no SQL editor do Supabase.`);
  const token = process.env.FINNHUB_TOKEN ?? "";
  if (!token) fail("FINNHUB_TOKEN não configurado.");

  const held = await heldTickers(user.id);
  const symbols = [...US_UNIVERSE.map((e) => e.symbol), ...held.us];
  let result;
  try {
    result = await refreshUs(admin, token, symbols, data.rows, { limit: 60, deadlineMs: 80_000 });
  } catch (e) {
    fail(e instanceof Error ? e.message : "Erro ao atualizar EUA.");
  }
  const parts = [`${result.fetched} símbolos atualizados na Finnhub`];
  if (result.failed > 0) parts.push(`${result.failed} sem resposta`);
  parts.push(
    result.remaining > 0
      ? `${result.remaining} ainda pendentes (clique de novo ou espere o cron)`
      : "todos em dia",
  );
  if (result.errors.length > 0) parts.push(`erros: ${result.errors.slice(0, 3).join("; ")}`);
  done(`EUA: ${parts.join(" · ")}.`);
}

export async function refreshDetailsAction() {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const data = await loadFundamentalsData(admin);
  if (!data.ready) fail(`Rode ${MIGRATION_FILE_0009} no SQL editor do Supabase.`);

  const held = await heldTickers(user.id);
  if (held.br.length === 0) done("Nenhuma ação ou FII da B3 na carteira para detalhar.");
  let result;
  try {
    result = await refreshDetails(admin, held.br, data.rows);
  } catch (e) {
    fail(e instanceof Error ? e.message : "Erro ao buscar detalhes.");
  }
  const parts = [`${result.fetched} páginas de detalhe atualizadas`];
  if (result.errors.length > 0) parts.push(`erros: ${result.errors.join("; ")}`);
  done(`Posições: ${parts.join(" · ")}.`);
}
