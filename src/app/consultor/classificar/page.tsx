import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { SubmitButton } from "@/components/submit-button";
import { AllocationCell } from "@/components/allocation-cell";
import { formatBRL } from "@/lib/format";
import { assetCurrentValue, CLASS_ORDER } from "@/lib/portfolio";
import { suggestAllocation } from "@/lib/allocation";
import { loadAllocationData } from "@/lib/allocation-data";
import { applySuggestions } from "../actions";
import {
  BackLink,
  card,
  EmptyCategories,
  MigrationNotice,
  noticeError,
  noticeOk,
  primaryButton,
  td,
  th,
} from "../ui";

function classRank(slug: string | undefined): number {
  const i = (CLASS_ORDER as readonly string[]).indexOf(slug ?? "");
  return i === -1 ? CLASS_ORDER.length : i;
}

export default async function ClassificarPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const { erro, ok } = await searchParams;

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, data] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    loadAllocationData(supabase, user.id),
  ]);

  const categories = data.categories;
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const nameBySlug = new Map(categories.map((c) => [c.slug, c.name]));

  const rows = [...data.assets]
    .sort(
      (a, b) =>
        classRank(a.asset_classes?.slug) - classRank(b.asset_classes?.slug) ||
        assetCurrentValue(b) - assetCurrentValue(a),
    )
    .map((asset) => {
      const suggestion = suggestAllocation(asset);
      const pending = !asset.allocation_excluded && !asset.allocation_category_id;
      const suggestedLabel = suggestion.excluded
        ? "Fora da carteira"
        : suggestion.categorySlug
          ? nameBySlug.get(suggestion.categorySlug) ?? null
          : null;
      // sugestão só aparece quando difere do que está salvo
      const currentLabel = asset.allocation_excluded
        ? "Fora da carteira"
        : asset.allocation_category_id
          ? nameById.get(asset.allocation_category_id) ?? null
          : null;
      const differs =
        suggestedLabel != null &&
        (suggestedLabel !== currentLabel ||
          (!suggestion.excluded && suggestion.reserve !== asset.is_emergency_reserve));
      return { asset, suggestion, pending, suggestedLabel, differs };
    });

  const pendingCount = rows.filter((r) => r.pending).length;
  const applicable = rows.filter(
    (r) => r.pending && (r.suggestion.excluded || r.suggestedLabel != null),
  ).length;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <BackLink />
            <h1 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
              Arrume sua carteira
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Diga a que caixa cada ativo pertence, pela exposição econômica (um BDR de
              empresa americana é Ações Americanas). Marque como reserva o que compõe a
              reserva de emergência. Saldo livre e caixinhas de consumo ficam fora da
              carteira.
            </p>
          </div>
          {data.ready &&
            categories.length > 0 &&
            (applicable > 0 ? (
              <form action={applySuggestions}>
                <SubmitButton pendingText="Aplicando..." className={primaryButton}>
                  Aplicar sugestões nos {pendingCount} não classificado
                  {pendingCount === 1 ? "" : "s"}
                </SubmitButton>
              </form>
            ) : (
              <button type="button" disabled className={primaryButton}>
                {pendingCount === 0 ? "Tudo classificado" : "Sem sugestões pendentes"}
              </button>
            ))}
        </div>

        {erro && <p className={noticeError}>{erro}</p>}
        {ok != null && (
          <p className={noticeOk}>
            {ok} ativo{ok === "1" ? "" : "s"} classificado{ok === "1" ? "" : "s"} pela
            sugestão automática. Confira e ajuste o que não bater.
          </p>
        )}
        {!data.ready && <MigrationNotice />}
        {data.ready && categories.length === 0 && <EmptyCategories />}

        {data.ready && categories.length > 0 && (
          <section className={`${card} p-0`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className={th}>Ativo</th>
                    <th className={`${th} text-right`}>Valor</th>
                    <th className={th}>Sugestão</th>
                    <th className={th}>Classificação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td className={`${td} text-zinc-500`} colSpan={4}>
                        Nenhum ativo cadastrado ainda.
                      </td>
                    </tr>
                  )}
                  {rows.map(({ asset, suggestion, pending, suggestedLabel, differs }) => (
                    <tr
                      key={asset.id}
                      className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${
                        pending ? "bg-amber-50/60 dark:bg-amber-950/30" : ""
                      }`}
                    >
                      <td className={td}>
                        <div className="font-medium text-zinc-950 dark:text-zinc-50">
                          {asset.name}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {asset.asset_classes?.name ?? "—"}
                          {asset.market_instruments?.ticker &&
                          asset.market_instruments.ticker !== asset.name
                            ? ` · ${asset.market_instruments.ticker}`
                            : ""}
                        </div>
                      </td>
                      <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>
                        {formatBRL(assetCurrentValue(asset))}
                      </td>
                      <td className={`${td} text-xs text-zinc-500`}>
                        {differs ? (
                          <span title={suggestion.reason}>
                            → {suggestedLabel}
                            {suggestion.reserve && !suggestion.excluded ? " · reserva" : ""}
                          </span>
                        ) : suggestedLabel == null && pending ? (
                          <span title={suggestion.reason}>sem sugestão</span>
                        ) : (
                          <span className="text-zinc-400">✓</span>
                        )}
                      </td>
                      <td className={td}>
                        <AllocationCell
                          key={`${asset.id}:${asset.allocation_category_id ?? ""}:${asset.allocation_excluded}:${asset.is_emergency_reserve}`}
                          assetId={asset.id}
                          categoryId={asset.allocation_category_id}
                          excluded={asset.allocation_excluded}
                          reserve={asset.is_emergency_reserve}
                          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
