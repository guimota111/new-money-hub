import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMissingTableError,
  type AllocationAssetRow,
  type AllocationCategory,
  type AllocationSettings,
} from "@/lib/allocation";

export interface AllocationData {
  /** false enquanto a migração 0007 não foi rodada */
  ready: boolean;
  categories: AllocationCategory[];
  settings: AllocationSettings | null;
  assets: AllocationAssetRow[];
}

// Carrega tudo que o consultor precisa para o usuário logado. A policy de
// select libera também as linhas do parceiro, por isso todo filtro é por
// user_id explícito: o consultor é individual.
export async function loadAllocationData(
  supabase: SupabaseClient,
  userId: string,
): Promise<AllocationData> {
  const [categoriesRes, settingsRes, assetsRes] = await Promise.all([
    supabase
      .from("allocation_categories")
      .select("id, name, slug, target_pct, max_assets, sort_order")
      .eq("user_id", userId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("allocation_settings")
      .select("reserve_target_amount, max_total_assets, default_mode")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("assets")
      .select(
        "id, name, quantity, average_price, purchase_date, metadata, allocation_category_id, is_emergency_reserve, allocation_excluded, asset_classes(name, slug), market_instruments(ticker, current_price, current_price_updated_at)",
      )
      .eq("user_id", userId)
      .order("name"),
  ]);

  const ready =
    !isMissingTableError(categoriesRes.error) &&
    !isMissingTableError(settingsRes.error) &&
    !isMissingTableError(assetsRes.error);
  if (!ready) return { ready: false, categories: [], settings: null, assets: [] };

  const categories = ((categoriesRes.data ?? []) as Record<string, unknown>[]).map(
    (c): AllocationCategory => ({
      id: String(c.id),
      name: String(c.name),
      slug: String(c.slug),
      target_pct: Number(c.target_pct),
      max_assets: c.max_assets == null ? null : Number(c.max_assets),
      sort_order: Number(c.sort_order),
    }),
  );

  const s = settingsRes.data as Record<string, unknown> | null;
  const settings: AllocationSettings | null = s
    ? {
        reserve_target_amount: Number(s.reserve_target_amount),
        max_total_assets: Number(s.max_total_assets),
        default_mode: s.default_mode === "full" ? "full" : "standard",
      }
    : null;

  const assets = (assetsRes.data ?? []) as unknown as AllocationAssetRow[];

  return { ready: true, categories, settings, assets };
}
