"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createHousehold(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Dê um nome para o household.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existingMembership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle();
  if (existingMembership) {
    revalidatePath("/onboarding");
    return;
  }

  // Gera o id no cliente para não depender de RETURNING: a policy de select
  // de `households` só libera o registro depois que o usuário vira membro
  // (segunda query abaixo), então pedir o id de volta no insert falharia.
  const householdId = randomUUID();

  const { error } = await supabase.from("households").insert({ id: householdId, name });
  if (error) throw new Error(error.message);

  const { error: memberError } = await supabase
    .from("household_members")
    .insert({ household_id: householdId, user_id: user!.id, role: "owner" });
  if (memberError) throw new Error(memberError.message);

  revalidatePath("/onboarding");
  revalidatePath("/");
}

export async function linkPartner(formData: FormData) {
  const partnerEmail = String(formData.get("partner_email") ?? "").trim();
  if (!partnerEmail) throw new Error("Informe o e-mail do parceiro.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user!.id)
    .limit(1)
    .single();
  if (membershipError || !membership) {
    throw new Error("Crie o household antes de vincular o parceiro.");
  }

  const { data: partnerId, error: lookupError } = await supabase.rpc(
    "find_user_id_by_email",
    { target_email: partnerEmail },
  );
  if (lookupError) throw new Error(lookupError.message);
  if (!partnerId) {
    throw new Error(
      "Não encontramos essa conta. Peça para a pessoa se cadastrar primeiro.",
    );
  }

  const { error: insertError } = await supabase.from("household_members").insert({
    household_id: membership.household_id,
    user_id: partnerId,
    role: "member",
  });
  if (insertError) throw new Error(insertError.message);

  revalidatePath("/onboarding");
  revalidatePath("/");
}
