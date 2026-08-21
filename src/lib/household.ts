import type { SupabaseClient } from "@supabase/supabase-js";

export interface HouseholdScope {
  hasHousehold: boolean;
  /** visão consolidada ativa (?visao=casal e household com 2+ membros) */
  casal: boolean;
  /** household tem 2+ membros — controla se o toggle Meu/Casal aparece */
  canToggle: boolean;
  /** user_ids cujos dados as queries devem trazer */
  userIds: string[];
  /** primeiro nome do dono de uma linha (coluna "Quem" na visão casal) */
  nameOf: (userId: string) => string;
}

// Resolve o escopo de dados da página: só o usuário logado ou o casal todo.
// As policies de RLS (is_household_partner) já liberam a leitura dos dados do
// parceiro — aqui só decidimos quais user_ids pedir.
export async function getHouseholdScope(
  supabase: SupabaseClient,
  userId: string,
  visao: string | undefined,
): Promise<HouseholdScope> {
  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return {
      hasHousehold: false,
      casal: false,
      canToggle: false,
      userIds: [userId],
      nameOf: () => "—",
    };
  }

  const { data: members } = await supabase
    .from("household_members")
    .select("user_id")
    .eq("household_id", membership.household_id);
  const memberIds = (members ?? []).map((m) => m.user_id as string);

  // household_members não tem FK direta para profiles, então o nome vem em
  // uma segunda query em vez de um embed do PostgREST.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", memberIds);
  const names = new Map((profiles ?? []).map((p) => [p.id as string, String(p.name)]));

  const canToggle = memberIds.length >= 2;
  const casal = visao === "casal" && canToggle;
  return {
    hasHousehold: true,
    casal,
    canToggle,
    userIds: casal ? memberIds : [userId],
    nameOf: (id) => names.get(id)?.split(" ")[0] ?? "—",
  };
}
