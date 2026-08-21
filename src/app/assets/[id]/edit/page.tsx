import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { AssetForm } from "@/components/asset-form";
import { updateAsset } from "../../actions";

export default async function EditAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  const { data: asset } = await supabase
    .from("assets")
    .select(
      "id, user_id, name, quantity, average_price, purchase_date, metadata, asset_classes(name, slug), market_instruments(ticker)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!asset || asset.user_id !== user.id) redirect("/assets");

  const assetClass = asset!.asset_classes as unknown as {
    name: string;
    slug: string;
  };
  const instrument = asset!.market_instruments as unknown as {
    ticker: string | null;
  } | null;

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
            Editar {asset!.name}
          </h1>
          <p className="text-sm text-zinc-500">{assetClass.name}</p>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <AssetForm
            classSlug={assetClass.slug}
            action={updateAsset}
            submitLabel="Salvar alterações"
            defaults={{
              id: asset!.id,
              name: asset!.name,
              ticker: instrument?.ticker ?? null,
              quantity: asset!.quantity,
              average_price: asset!.average_price,
              purchase_date: asset!.purchase_date,
              metadata: (asset!.metadata ?? {}) as Record<string, unknown>,
            }}
          />
        </div>
      </main>
    </div>
  );
}
