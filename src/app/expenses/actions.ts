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

export async function updateExpenseCategory(
  id: string,
  categoryId: string,
  makeRule: boolean,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: expense } = await supabase
    .from("expenses")
    .select("description")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!expense) throw new Error("Despesa não encontrada.");

  const { error } = await supabase
    .from("expenses")
    .update({ expense_category_id: categoryId })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  if (makeRule && expense.description) {
    // regra para futuras importações do cartão + aplica ao histórico
    const { error: ruleError } = await supabase.from("expense_category_rules").upsert(
      {
        user_id: user.id,
        matcher: expense.description.trim().toLowerCase(),
        expense_category_id: categoryId,
      },
      { onConflict: "user_id,matcher" },
    );
    // tabela pode ainda não existir (migração 0004 pendente) — o update
    // pontual e o retroativo abaixo funcionam mesmo assim
    if (ruleError && !/does not exist|schema cache/i.test(ruleError.message)) {
      throw new Error(ruleError.message);
    }
    await supabase
      .from("expenses")
      .update({ expense_category_id: categoryId })
      .eq("user_id", user.id)
      .eq("description", expense.description);
  }

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
