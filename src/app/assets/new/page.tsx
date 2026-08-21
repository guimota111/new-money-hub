import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { AssetForm } from "@/components/asset-form";
import { createAsset } from "../actions";

const CLASS_OPTIONS = [
  { slug: "renda_fixa", label: "Renda Fixa (Tesouro)" },
  { slug: "conta_corrente", label: "Conta / Caixinha" },
  { slug: "acoes", label: "Ação" },
  { slug: "fiis", label: "FII" },
  { slug: "bitcoin", label: "Bitcoin" },
];

export default async function NewAssetPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; error?: string }>;
}) {
  const { class: classSlug, error } = await searchParams;

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  const selected = CLASS_OPTIONS.find((o) => o.slug === classSlug);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full max-w-2xl flex-1 space-y-6 px-6 py-10">
        <div>
          <Link
            href="/assets"
            className="text-sm text-zinc-500 underline hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            ← Voltar para ativos
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            Adicionar ativo
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          {CLASS_OPTIONS.map((option) => (
            <Link
              key={option.slug}
              href={`/assets/new?class=${option.slug}`}
              className={
                option.slug === classSlug
                  ? "rounded-full bg-zinc-950 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
                  : "rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }
            >
              {option.label}
            </Link>
          ))}
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        {selected ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <AssetForm
              classSlug={selected.slug}
              action={createAsset}
              submitLabel={`Adicionar ${selected.label}`}
            />
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            Escolha acima o tipo de ativo que você quer cadastrar.
          </p>
        )}
      </main>
    </div>
  );
}
