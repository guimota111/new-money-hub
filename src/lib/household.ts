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
  // uma query só: a policy de select de household_members já devolve todas as
  // linhas dos households do usuário, então dá para achar a membership e os
  // demais membros de uma vez
  const { data: rows } = await supabase
    .from("household_members")
    .select("household_id, user_id");

  const mine = (rows ?? []).find((r) => r.user_id === userId);
  if (!mine) {
    return {
      hasHousehold: false,
      casal: false,
      canToggle: false,
      userIds: [userId],
      nameOf: () => "—",
    };
  }

  const memberIds = [
    ...new Set(
      (rows ?? [])
        .filter((r) => r.household_id === mine.household_id)
        .map((r) => r.user_id as string),
    ),
  ];

  const canToggle = memberIds.length >= 2;
  const casal = visao === "casal" && canToggle;

  // nomes só são exibidos na visão casal — evita a query no caso comum.
  // household_members não tem FK direta para profiles, daí a query separada.
  let names = new Map<string, string>();
  if (casal) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", memberIds);
    names = new Map((profiles ?? []).map((p) => [p.id as string, String(p.name)]));
  }

  return {
    hasHousehold: true,
    casal,
    canToggle,
    userIds: casal ? memberIds : [userId],
    nameOf: (id) => names.get(id)?.split(" ")[0] ?? "—",
  };
}
