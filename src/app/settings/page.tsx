import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { SubmitButton } from "@/components/submit-button";
import { createCategory, renameCategory, deleteCategory } from "./actions";

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  household_id: string | null;
}

const inputClass =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

function CategorySection({
  title,
  kind,
  categories,
  canCustomize,
  notice,
}: {
  title: string;
  kind: "despesa" | "receita";
  categories: CategoryRow[];
  canCustomize: boolean;
  notice?: string;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h2>
      {notice && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {notice}
        </p>
      )}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
        {categories.map((cat) =>
          cat.household_id ? (
            <li key={cat.id} className="flex items-center gap-2 py-2">
              <form action={renameCategory} className="flex flex-1 items-center gap-2">
                <input type="hidden" name="tipo" value={kind} />
                <input type="hidden" name="id" value={cat.id} />
                <input
                  name="nome"
                  defaultValue={cat.name}
                  required
                  className={`${inputClass} w-full max-w-64`}
                />
                <SubmitButton
                  pendingText="..."
                  className="text-sm text-zinc-500 underline hover:text-zinc-950 dark:hover:text-zinc-50"
                >
                  Renomear
                </SubmitButton>
              </form>
              <form action={deleteCategory}>
                <input type="hidden" name="tipo" value={kind} />
                <input type="hidden" name="id" value={cat.id} />
                <SubmitButton
                  pendingText="..."
                  title="Excluir categoria (só sem lançamentos)"
                  className="px-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  ×
                </SubmitButton>
              </form>
            </li>
          ) : (
            <li key={cat.id} className="flex items-center gap-2 py-2.5">
              <span className="text-sm text-zinc-950 dark:text-zinc-50">{cat.name}</span>
              <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-400 dark:border-zinc-800">
                padrão
              </span>
            </li>
          ),
        )}
      </ul>
      {canCustomize && (
        <form
          action={createCategory}
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"
        >
          <input type="hidden" name="tipo" value={kind} />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">Nova categoria</label>
            <input
              name="nome"
              required
              placeholder={kind === "despesa" ? "Ex: Pets" : "Ex: Freelas"}
              className={`${inputClass} w-56`}
            />
          </div>
          <SubmitButton
            pendingText="Adicionando..."
            className="rounded-md bg-zinc-950 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Adicionar
          </SubmitButton>
        </form>
      )}
    </section>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, expenseRes, incomeRes] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    supabase.from("expense_categories").select("id, name, slug, household_id").order("name"),
    supabase.from("income_categories").select("id, name, slug, household_id").order("name"),
  ]);

  const expenseCats = (expenseRes.data ?? []) as CategoryRow[];

  // antes da migração 0006, income_categories não tem household_id — lista
  // mesmo assim, só sem permitir personalização
  let incomeCats = (incomeRes.data ?? []) as CategoryRow[];
  const incomeReady = !incomeRes.error;
  if (!incomeReady) {
    const { data } = await supabase
      .from("income_categories")
      .select("id, name, slug")
      .order("name");
    incomeCats = ((data ?? []) as Omit<CategoryRow, "household_id">[]).map((c) => ({
      ...c,
      household_id: null,
    }));
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full max-w-3xl flex-1 space-y-6 px-6 py-10">
        <div>
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Opções</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Categorias personalizadas valem para o casal inteiro e aparecem nos
            lançamentos, filtros e gráficos. As padrão não podem ser alteradas.
          </p>
        </div>

        {erro && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {erro}
          </p>
        )}

        <CategorySection
          title="Categorias de despesas"
          kind="despesa"
          categories={expenseCats}
          canCustomize
        />
        <CategorySection
          title="Categorias de receitas"
          kind="receita"
          categories={incomeCats}
          canCustomize={incomeReady}
          notice={
            incomeReady
              ? undefined
              : "Para criar categorias de receita, rode supabase/migrations/0006_income_category_households.sql no SQL editor do Supabase."
          }
        />
      </main>
    </div>
  );
}
