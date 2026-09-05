"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseDecimal } from "@/lib/format";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  MIGRATION_FILE,
  isMissingTableError,
  slugify,
  suggestAllocation,
  type AllocationAssetRow,
} from "@/lib/allocation";

// Consultor de Alocação — categorias, metas, configurações e classificação
// dos ativos. Tudo individual: as queries filtram por user_id além do RLS
// (a policy de select deixa o parceiro ler, mas o consultor é por pessoa).

const HOME = "/consultor";
const CATEGORIAS = "/consultor/categorias";
const CLASSIFICAR = "/consultor/classificar";

function revalidateModule() {
  for (const path of [HOME, CATEGORIAS, CLASSIFICAR, "/assets"]) revalidatePath(path);
}

function fail(path: string, message: string): never {
  redirect(`${path}?erro=${encodeURIComponent(message)}`);
}

function describe(error: { code?: string; message: string }): string {
  return isMissingTableError(error)
    ? `Rode ${MIGRATION_FILE} no SQL editor do Supabase.`
    : error.message;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user: user! };
}

function optionalInt(formData: FormData, field: string): number | null | "invalid" {
  const raw = String(formData.get(field) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : "invalid";
}

function percent(formData: FormData, field: string): number | "invalid" {
  const n = parseDecimal(String(formData.get(field) ?? ""));
  if (n == null || n < 0 || n > 100) return "invalid";
  return Math.round(n * 100) / 100;
}

// ---- categorias padrão ----------------------------------------------------

export async function seedDefaults() {
  const { supabase, user } = await requireUser();

  const { count, error } = await supabase
    .from("allocation_categories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (error) fail(HOME, describe(error));

  if ((count ?? 0) === 0) {
    const { error: insertError } = await supabase
      .from("allocation_categories")
      .insert(DEFAULT_CATEGORIES.map((c) => ({ ...c, user_id: user.id })));
    if (insertError) fail(HOME, describe(insertError));
  }

  const { error: settingsError } = await supabase
    .from("allocation_settings")
    .upsert({ user_id: user.id, ...DEFAULT_SETTINGS }, { onConflict: "user_id", ignoreDuplicates: true });
  if (settingsError) fail(HOME, describe(settingsError));

  revalidateModule();
  redirect(CLASSIFICAR);
}

// ---- configurações --------------------------------------------------------

export async function saveSettings(formData: FormData) {
  const reserve = parseDecimal(String(formData.get("reserva") ?? ""));
  if (reserve == null || reserve < 0) fail(CATEGORIAS, "Valor da reserva inválido.");
  const maxTotal = optionalInt(formData, "teto");
  if (maxTotal === "invalid" || maxTotal == null) {
    fail(CATEGORIAS, "Teto de ativos deve ser um inteiro maior que zero.");
  }
  const mode = formData.get("modo") === "full" ? "full" : "standard";

  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("allocation_settings").upsert(
    {
      user_id: user.id,
      reserve_target_amount: reserve,
      max_total_assets: maxTotal,
      default_mode: mode,
    },
    { onConflict: "user_id" },
  );
  if (error) fail(CATEGORIAS, describe(error));

  revalidateModule();
  redirect(CATEGORIAS);
}

// ---- categorias -----------------------------------------------------------

export async function createCategory(formData: FormData) {
  const name = String(formData.get("nome") ?? "").trim();
  if (!name) fail(CATEGORIAS, "Dê um nome para a categoria.");
  const target = percent(formData, "meta");
  if (target === "invalid") fail(CATEGORIAS, "Meta deve estar entre 0 e 100%.");
  const maxAssets = optionalInt(formData, "subteto");
  if (maxAssets === "invalid") fail(CATEGORIAS, "Subteto deve ser um inteiro maior que zero.");

  const { supabase, user } = await requireUser();

  const { data: existing, error: readError } = await supabase
    .from("allocation_categories")
    .select("slug, sort_order")
    .eq("user_id", user.id);
  if (readError) fail(CATEGORIAS, describe(readError));

  const taken = new Set((existing ?? []).map((c) => String(c.slug)));
  const base = slugify(name);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}_${n}`;
  const sortOrder = Math.max(0, ...(existing ?? []).map((c) => Number(c.sort_order))) + 1;

  const { error } = await supabase.from("allocation_categories").insert({
    user_id: user.id,
    name,
    slug,
    target_pct: target,
    max_assets: maxAssets,
    sort_order: sortOrder,
  });
  if (error) fail(CATEGORIAS, describe(error));

  revalidateModule();
  redirect(CATEGORIAS);
}

export async function updateCategory(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("nome") ?? "").trim();
  if (!id || !name) fail(CATEGORIAS, "Dê um nome para a categoria.");
  const target = percent(formData, "meta");
  if (target === "invalid") fail(CATEGORIAS, "Meta deve estar entre 0 e 100%.");
  const maxAssets = optionalInt(formData, "subteto");
  if (maxAssets === "invalid") fail(CATEGORIAS, "Subteto deve ser um inteiro maior que zero.");
  const orderRaw = String(formData.get("ordem") ?? "").trim();
  const sortOrder = orderRaw ? Number(orderRaw) : 0;
  if (!Number.isInteger(sortOrder)) fail(CATEGORIAS, "Ordem deve ser um número inteiro.");

  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("allocation_categories")
    .update({ name, target_pct: target, max_assets: maxAssets, sort_order: sortOrder })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) fail(CATEGORIAS, describe(error));

  revalidateModule();
  redirect(CATEGORIAS);
}

export async function deleteCategory(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) fail(CATEGORIAS, "Categoria inválida.");

  const { supabase, user } = await requireUser();
  // os ativos vinculados voltam a "não classificado" (FK on delete set null)
  const { error } = await supabase
    .from("allocation_categories")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) fail(CATEGORIAS, describe(error));

  revalidateModule();
  redirect(CATEGORIAS);
}

// ---- classificação dos ativos ---------------------------------------------

export interface AssetAllocationInput {
  categoryId: string | null;
  excluded: boolean;
  reserve: boolean;
}

// Chamada do componente cliente (salva ao trocar o select): devolve o erro em
// vez de redirecionar.
export async function setAssetAllocation(
  assetId: string,
  next: AssetAllocationInput,
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();

  let categoryId = next.excluded ? null : next.categoryId;
  const reserve = next.excluded ? false : next.reserve;

  if (categoryId) {
    const { data: category } = await supabase
      .from("allocation_categories")
      .select("id")
      .eq("id", categoryId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!category) return { error: "Categoria inválida." };
  }

  // reserva sem categoria: cai em Renda Fixa, onde a reserva mora
  if (reserve && !categoryId) {
    const { data: rf } = await supabase
      .from("allocation_categories")
      .select("id")
      .eq("user_id", user.id)
      .eq("slug", "renda_fixa")
      .maybeSingle();
    if (!rf) return { error: "Escolha a categoria do ativo antes de marcá-lo como reserva." };
    categoryId = rf.id as string;
  }

  const { error } = await supabase
    .from("assets")
    .update({
      allocation_category_id: categoryId,
      allocation_excluded: next.excluded,
      is_emergency_reserve: reserve,
    })
    .eq("id", assetId)
    .eq("user_id", user.id);
  if (error) return { error: describe(error) };

  revalidateModule();
  return { error: null };
}

// Aplica a sugestão automática em todos os ativos ainda não classificados.
export async function applySuggestions() {
  const { supabase, user } = await requireUser();

  const [{ data: categoryRows, error: categoryError }, { data: assetRows, error: assetError }] =
    await Promise.all([
      supabase.from("allocation_categories").select("id, slug").eq("user_id", user.id),
      supabase
        .from("assets")
        .select(
          "id, name, quantity, average_price, purchase_date, metadata, allocation_category_id, is_emergency_reserve, allocation_excluded, asset_classes(name, slug), market_instruments(ticker, current_price, current_price_updated_at)",
        )
        .eq("user_id", user.id),
    ]);
  if (categoryError) fail(CLASSIFICAR, describe(categoryError));
  if (assetError) fail(CLASSIFICAR, describe(assetError));

  const idBySlug = new Map((categoryRows ?? []).map((c) => [String(c.slug), String(c.id)]));
  const assets = (assetRows ?? []) as unknown as AllocationAssetRow[];

  let applied = 0;
  for (const asset of assets) {
    if (asset.allocation_excluded || asset.allocation_category_id) continue;
    const suggestion = suggestAllocation(asset);
    const categoryId = suggestion.categorySlug ? idBySlug.get(suggestion.categorySlug) : null;
    if (!suggestion.excluded && !categoryId) continue;
    const { error } = await supabase
      .from("assets")
      .update({
        allocation_category_id: suggestion.excluded ? null : categoryId,
        allocation_excluded: suggestion.excluded,
        is_emergency_reserve: suggestion.excluded ? false : suggestion.reserve,
      })
      .eq("id", asset.id)
      .eq("user_id", user.id);
    if (error) fail(CLASSIFICAR, describe(error));
    applied++;
  }

  revalidateModule();
  redirect(`${CLASSIFICAR}?ok=${applied}`);
}
