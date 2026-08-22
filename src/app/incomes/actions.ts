"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/parse-amount";

export async function createIncome(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const amount = parseAmount(String(formData.get("valor") ?? ""));
  const description = String(formData.get("descricao") ?? "").trim();
  const categoryId = String(formData.get("categoria") ?? "");
  const receivedAt = String(formData.get("data") ?? "");
  if (!amount || !categoryId || !/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) {
    throw new Error("Preencha valor, categoria e data.");
  }

  const { error } = await supabase.from("incomes").insert({
    user_id: user.id,
    income_category_id: categoryId,
    amount,
    description: description || null,
    received_at: receivedAt,
    source: "manual",
  });
  if (error) throw new Error(error.message);

  revalidatePath("/incomes");
  revalidatePath("/months");
  revalidatePath("/");
}

export async function deleteIncome(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // só lançamentos manuais podem ser apagados pela lista — os importados são
  // regravados pelos imports/crons e sumiriam e voltariam
  const { error } = await supabase
    .from("incomes")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("source", "manual");
  if (error) throw new Error(error.message);

  revalidatePath("/incomes");
  revalidatePath("/months");
  revalidatePath("/");
}
