import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { SubmitButton } from "@/components/submit-button";
import { formatPercent } from "@/lib/format";
import { allocationColor } from "@/lib/chart-colors";
import { DEFAULT_SETTINGS } from "@/lib/allocation";
import { loadAllocationData } from "@/lib/allocation-data";
import { createCategory, deleteCategory, saveSettings, updateCategory } from "../actions";
import {
  BackLink,
  card,
  EmptyCategories,
  Field,
  inputClass,
  linkClass,
  MigrationNotice,
  noticeError,
  primaryButton,
  sectionTitle,
} from "../ui";

export default async function CategoriasPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, data] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    loadAllocationData(supabase, user.id),
  ]);

  const settings = data.settings ?? DEFAULT_SETTINGS;
  const targetSum = data.categories.reduce((sum, c) => sum + c.target_pct, 0);
  const targetsOk = Math.abs(targetSum - 100) < 0.01;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <BackLink />
          <h1 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            Categorias e metas
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            As metas são % da carteira e precisam somar 100%. A reserva de emergência é um
            valor fixo em reais e mora dentro de Renda Fixa. Subteto limita quantos ativos
            a categoria pode ter; o teto global vale para a carteira toda.
          </p>
        </div>

        {erro && <p className={noticeError}>{erro}</p>}
        {!data.ready && <MigrationNotice />}

        {data.ready && (
          <>
            <section className={card}>
              <h2 className={sectionTitle}>Configurações</h2>
              <form action={saveSettings} className="grid gap-4 sm:grid-cols-3">
                <Field label="Reserva de emergência (R$)">
                  <input
                    name="reserva"
                    inputMode="decimal"
                    placeholder="Ex: 30.000,00"
                    defaultValue={
                      settings.reserve_target_amount > 0 ? String(settings.reserve_target_amount) : ""
                    }
                    className={`${inputClass} w-full`}
                  />
                </Field>
                <Field label="Teto global de ativos">
                  <input
                    name="teto"
                    type="number"
                    min={1}
                    step={1}
                    required
                    defaultValue={settings.max_total_assets}
                    className={`${inputClass} w-full`}
                  />
                </Field>
                <Field label="Modo padrão da análise">
                  <select
                    name="modo"
                    defaultValue={settings.default_mode}
                    className={`${inputClass} w-full`}
                  >
                    <option value="standard">Padrão (só caixas em déficit)</option>
                    <option value="full">Completo (varre toda a carteira)</option>
                  </select>
                </Field>
                <div className="sm:col-span-3">
                  <SubmitButton pendingText="Salvando..." className={primaryButton}>
                    Salvar configurações
                  </SubmitButton>
                </div>
              </form>
            </section>

            {data.categories.length === 0 ? (
              <EmptyCategories />
            ) : (
              <section className={card}>
                <h2 className={sectionTitle}>Categorias</h2>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {data.categories.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-end gap-3 py-3">
                      <form
                        action={updateCategory}
                        className="flex flex-1 flex-wrap items-end gap-3"
                      >
                        <input type="hidden" name="id" value={c.id} />
                        <span
                          className="mb-2.5 inline-block h-3 w-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: allocationColor(c.slug) }}
                        />
                        <Field label="Nome">
                          <input
                            name="nome"
                            required
                            defaultValue={c.name}
                            className={`${inputClass} w-48`}
                          />
                        </Field>
                        <Field label="Meta %">
                          <input
                            name="meta"
                            inputMode="decimal"
                            required
                            defaultValue={String(c.target_pct)}
                            className={`${inputClass} w-20 text-right`}
                          />
                        </Field>
                        <Field label="Subteto">
                          <input
                            name="subteto"
                            type="number"
                            min={1}
                            step={1}
                            placeholder="—"
                            defaultValue={c.max_assets ?? ""}
                            className={`${inputClass} w-20 text-right`}
                          />
                        </Field>
                        <Field label="Ordem">
                          <input
                            name="ordem"
                            type="number"
                            step={1}
                            defaultValue={c.sort_order}
                            className={`${inputClass} w-16 text-right`}
                          />
                        </Field>
                        <SubmitButton pendingText="..." className={`${linkClass} pb-2`}>
                          Salvar
                        </SubmitButton>
                      </form>
                      <form action={deleteCategory} className="pb-2">
                        <input type="hidden" name="id" value={c.id} />
                        <SubmitButton
                          pendingText="..."
                          title="Excluir categoria (os ativos dela voltam a não classificados)"
                          className="px-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          ×
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>

                <p
                  className={`mt-3 text-sm ${
                    targetsOk ? "text-zinc-500" : "font-medium text-amber-700 dark:text-amber-400"
                  }`}
                >
                  Soma das metas: {formatPercent(targetSum, 2)}
                  {targetsOk ? "" : " — precisa dar 100% para o consultor distribuir o aporte."}
                </p>

                <form
                  action={createCategory}
                  className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"
                >
                  <Field label="Nova categoria">
                    <input
                      name="nome"
                      required
                      placeholder="Ex: Previdência"
                      className={`${inputClass} w-48`}
                    />
                  </Field>
                  <Field label="Meta %">
                    <input
                      name="meta"
                      inputMode="decimal"
                      required
                      placeholder="0"
                      className={`${inputClass} w-20 text-right`}
                    />
                  </Field>
                  <Field label="Subteto">
                    <input
                      name="subteto"
                      type="number"
                      min={1}
                      step={1}
                      placeholder="—"
                      className={`${inputClass} w-20 text-right`}
                    />
                  </Field>
                  <SubmitButton pendingText="Adicionando..." className={primaryButton}>
                    Adicionar
                  </SubmitButton>
                </form>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
