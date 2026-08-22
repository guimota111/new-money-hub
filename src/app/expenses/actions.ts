"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/parse-amount";

export async function createExpense(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const amount = parseAmount(String(formData.get("valor") ?? ""));
  const description = String(formData.get("descricao") ?? "").trim();
  const categoryId = String(formData.get("categoria") ?? "");
  const spentAt = String(formData.get("data") ?? "");
  if (!amount || !categoryId || !/^\d{4}-\d{2}-\d{2}$/.test(spentAt)) {
    throw new Error("Preencha valor, categoria e data.");
  }

  const { error } = await supabase.from("expenses").insert({
    user_id: user.id,
    expense_category_id: categoryId,
    amount,
    description: description || null,
    spent_at: spentAt,
    source: "manual",
  });
  if (error) throw new Error(error.message);

  revalidatePath("/expenses");
  revalidatePath("/months");
}

export async function deleteExpense(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("source", "manual");
  if (error) throw new Error(error.message);

  revalidatePath("/expenses");
  revalidatePath("/months");
}
