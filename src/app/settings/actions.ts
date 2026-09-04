"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Gestão de categorias (Opções). Categorias globais (household_id nulo) são
// os padrões do app e ficam intocáveis; as do household podem ser criadas,
// renomeadas e excluídas — o RLS garante isso no banco também.

const TABLE = {
  despesa: "expense_categories",
  receita: "income_categories",
} as const;

type Kind = keyof typeof TABLE;

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "categoria"
  );
}

function kindOf(formData: FormData): Kind {
  return formData.get("tipo") === "receita" ? "receita" : "despesa";
}

function fail(message: string): never {
  redirect(`/settings?erro=${encodeURIComponent(message)}`);
}

async function requireUserAndHousehold() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: member } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!member) redirect("/onboarding");
  return { supabase, householdId: member.household_id as string };
}

export async function createCategory(formData: FormData) {
  const kind = kindOf(formData);
  const name = String(formData.get("nome") ?? "").trim();
  if (!name) fail("Dê um nome para a categoria.");

  const { supabase, householdId } = await requireUserAndHousehold();
  const table = TABLE[kind];

  // slug único entre as categorias visíveis (globais + do household)
  const { data: existing } = await supabase.from(table).select("slug");
  const taken = new Set((existing ?? []).map((c) => c.slug));
  const base = slugify(name);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}_${n}`;

  const { error } = await supabase
    .from(table)
    .insert({ household_id: householdId, name, slug });
  if (error) {
    if (kind === "receita" && /household_id|column|schema cache/i.test(error.message)) {
      fail(
        "Categorias de receita personalizadas precisam da migração 0006 — rode supabase/migrations/0006_income_category_households.sql no SQL editor do Supabase.",
      );
    }
    fail(error.message);
  }
  revalidatePath("/settings");
  redirect("/settings");
}

export async function renameCategory(formData: FormData) {
  const kind = kindOf(formData);
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("nome") ?? "").trim();
  if (!id || !name) fail("Dê um nome para a categoria.");

  const { supabase } = await requireUserAndHousehold();
  // o RLS só deixa alterar categorias do próprio household — as globais
  // simplesmente não são afetadas
  const { error } = await supabase.from(TABLE[kind]).update({ name }).eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/settings");
  redirect("/settings");
}

export async function deleteCategory(formData: FormData) {
  const kind = kindOf(formData);
  const id = String(formData.get("id") ?? "");
  if (!id) fail("Categoria inválida.");

  const { supabase } = await requireUserAndHousehold();
  const { error } = await supabase.from(TABLE[kind]).delete().eq("id", id);
  if (error) {
    if (error.code === "23503" || /foreign key/i.test(error.message)) {
      fail(
        "Esta categoria tem lançamentos — recategorize-os antes de excluir.",
      );
    }
    fail(error.message);
  }
  revalidatePath("/settings");
  redirect("/settings");
}
