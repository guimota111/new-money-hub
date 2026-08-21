import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/header";
import { DeleteAssetButton } from "@/components/delete-asset-button";
import { DonutChart } from "@/components/charts/donut-chart";
import { ViewToggle } from "@/components/view-toggle";
import { formatBRL, formatQuantity } from "@/lib/format";
import { getHouseholdScope } from "@/lib/household";
import { assetCurrentValue, CLASS_ORDER, type AssetRow } from "@/lib/portfolio";
import { CLASS_COLOR } from "@/lib/chart-colors";
import { deleteAsset } from "./actions";

// linha da página: AssetRow + dono (visão casal). Ações de editar/excluir só
// aparecem nos ativos do próprio usuário — o RLS bloqueia escrita nos do
// parceiro.
type PageAssetRow = AssetRow & {
  user_id: string;
  mine: boolean;
  ownerName?: string;
};

function assetSubtitle(asset: AssetRow): string | null {
  const meta = asset.metadata ?? {};
  const slug = asset.asset_classes?.slug;
  if (slug === "renda_fixa") {
    const parts: string[] = [];
    if (meta.indexador) parts.push(String(meta.indexador).toUpperCase());
    if (meta.taxa_contratada != null) parts.push(`${meta.taxa_contratada}% a.a.`);
    if (meta.vencimento) parts.push(`venc. ${String(meta.vencimento)}`);
    return parts.join(" · ") || null;
  }
  if (slug === "conta_corrente") {
    const parts: string[] = [];
    if (meta.tipo === "caixinha") {
      if (meta.taxa_cdi != null) parts.push(`${meta.taxa_cdi}% CDI`);
      if (meta.vencimento) parts.push(`venc. ${String(meta.vencimento)}`);
    } else {
      if (meta.banco) parts.push(String(meta.banco));
      parts.push("Conta corrente");
    }
    return parts.join(" · ") || null;
  }
  if (slug === "bitcoin" && meta.local) return String(meta.local);
  return null;
}

function caixinhaYield(asset: AssetRow): { amount: number; pct: number } | null {
  const meta = asset.metadata ?? {};
  const aplicado = Number(meta.valor_aplicado);
  if (!Number.isFinite(aplicado) || aplicado <= 0) return null;
  const atual = Number(asset.quantity);
  const amount = atual - aplicado;
  return { amount, pct: (amount / aplicado) * 100 };
}

function ActionLinks({ asset }: { asset: AssetRow }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <Link
        href={`/assets/${asset.id}/edit`}
        className="text-sm text-zinc-500 underline hover:text-zinc-950 dark:hover:text-zinc-50"
      >
        Editar
      </Link>
      <DeleteAssetButton action={deleteAsset.bind(null, asset.id)} />
    </div>
  );
}

const thClass = "px-4 py-3 font-medium";
const tdClass = "px-4 py-3";

function ContaCorrenteTable({ assets }: { assets: PageAssetRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
          <th className={thClass}>Nome</th>
          <th className={`${thClass} text-right`}>Rendimento</th>
          <th className={`${thClass} text-right`}>Valor</th>
          <th className={thClass} />
        </tr>
      </thead>
      <tbody>
        {assets.map((asset) => {
          const subtitle = assetSubtitle(asset);
          const yield_ = caixinhaYield(asset);
          return (
            <tr key={asset.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              <td className={tdClass}>
                <div className="font-medium text-zinc-950 dark:text-zinc-50">{asset.name}</div>
                {subtitle && <div className="text-xs text-zinc-500">{subtitle}</div>}
                {asset.ownerName && (
                  <div className="text-xs text-zinc-400">{asset.ownerName}</div>
                )}
              </td>
              <td className={`${tdClass} text-right`}>
                {yield_ ? (
                  <span className={yield_.amount >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                    {yield_.amount >= 0 ? "+" : ""}
                    {formatBRL(yield_.amount)}{" "}
                    <span className="text-xs">({yield_.pct.toFixed(1)}%)</span>
                  </span>
                ) : (
                  <span className="text-zinc-500">—</span>
                )}
              </td>
              <td className={`${tdClass} text-right font-medium text-zinc-950 dark:text-zinc-50`}>
                {formatBRL(assetCurrentValue(asset))}
              </td>
              <td className={tdClass}>
                {asset.mine && <ActionLinks asset={asset} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MarketTable({ assets }: { assets: PageAssetRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
          <th className={thClass}>Ativo</th>
          <th className={`${thClass} text-right`}>Quantidade</th>
          <th className={`${thClass} text-right`}>Preço médio</th>
          <th className={`${thClass} text-right`}>Cotação</th>
          <th className={`${thClass} text-right`}>Valor</th>
          <th className={thClass} />
        </tr>
      </thead>
      <tbody>
        {assets.map((asset) => {
          const subtitle = assetSubtitle(asset);
          const price = asset.market_instruments?.current_price;
          return (
            <tr key={asset.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              <td className={tdClass}>
                <div className="font-medium text-zinc-950 dark:text-zinc-50">{asset.name}</div>
                {subtitle && <div className="text-xs text-zinc-500">{subtitle}</div>}
                {asset.ownerName && (
                  <div className="text-xs text-zinc-400">{asset.ownerName}</div>
                )}
              </td>
              <td className={`${tdClass} text-right text-zinc-700 dark:text-zinc-300`}>
                {formatQuantity(Number(asset.quantity))}
              </td>
              <td className={`${tdClass} text-right text-zinc-700 dark:text-zinc-300`}>
                {asset.average_price != null ? formatBRL(Number(asset.average_price)) : "—"}
              </td>
              <td className={`${tdClass} text-right text-zinc-700 dark:text-zinc-300`}>
                {price != null ? formatBRL(Number(price)) : "—"}
              </td>
              <td className={`${tdClass} text-right font-medium text-zinc-950 dark:text-zinc-50`}>
                {formatBRL(assetCurrentValue(asset))}
              </td>
              <td className={tdClass}>
                {asset.mine && <ActionLinks asset={asset} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ visao?: string }>;
}) {
  const { visao } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  const scope = await getHouseholdScope(supabase, user.id, visao);

  const { data } = await supabase
    .from("assets")
    .select(
      "id, user_id, name, quantity, average_price, purchase_date, metadata, asset_classes(name, slug), market_instruments(ticker, current_price, current_price_updated_at)",
    )
    .in("user_id", scope.userIds)
    .order("quantity", { ascending: false });

  const assets = ((data ?? []) as unknown as (AssetRow & { user_id: string })[]).map(
    (a): PageAssetRow => ({
      ...a,
      mine: a.user_id === user.id,
      ownerName: scope.casal ? scope.nameOf(a.user_id) : undefined,
    }),
  );
  const total = assets.reduce((sum, a) => sum + assetCurrentValue(a), 0);

  const groups = CLASS_ORDER.map((slug) => {
    const classAssets = assets.filter((a) => a.asset_classes?.slug === slug);
    return {
      slug,
      name: classAssets[0]?.asset_classes?.name ?? slug,
      assets: classAssets,
      total: classAssets.reduce((sum, a) => sum + assetCurrentValue(a), 0),
    };
  }).filter((g) => g.assets.length > 0);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} view={scope.casal ? "casal" : undefined} />
      <main className="w-full flex-1 space-y-6 px-6 py-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
              {scope.casal ? "Ativos do casal" : "Meus ativos"}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {assets.length} ativo{assets.length === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold text-zinc-950 dark:text-zinc-50">
                {formatBRL(total)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {scope.canToggle && (
              <ViewToggle basePath="/assets" casal={scope.casal} />
            )}
            <Link
              href="/assets/new"
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Adicionar ativo
            </Link>
          </div>
        </div>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Divisão da carteira
          </h2>
          <DonutChart
            centerLabel="Total"
            slices={groups.map((g) => ({
              key: g.slug,
              name: g.name,
              value: g.total,
              color: CLASS_COLOR[g.slug] ?? "var(--chart-muted)",
            }))}
          />
        </section>

        {groups.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-500">
              Nenhum ativo cadastrado ainda. Comece adicionando seu primeiro
              ativo — Tesouro, conta, ações, FIIs ou Bitcoin.
            </p>
          </div>
        )}

        {groups.map((group) => (
          <details
            key={group.slug}
            className="group overflow-hidden rounded-xl border border-zinc-200 border-l-4 bg-white dark:border-zinc-800 dark:bg-zinc-950"
            style={{ borderLeftColor: CLASS_COLOR[group.slug] }}
          >
            <summary className="flex cursor-pointer items-center gap-3 px-5 py-4 select-none [&::-webkit-details-marker]:hidden">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: CLASS_COLOR[group.slug] }}
              />
              <span className="font-semibold text-zinc-950 dark:text-zinc-50">
                {group.name}
              </span>
              <span className="text-sm text-zinc-500">
                {group.assets.length} ativo{group.assets.length === 1 ? "" : "s"}
              </span>
              <span className="ml-auto font-semibold text-zinc-950 dark:text-zinc-50">
                {formatBRL(group.total)}
              </span>
              <span className="text-zinc-400 transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="overflow-x-auto border-t border-zinc-100 dark:border-zinc-900">
              {group.slug === "conta_corrente" ? (
                <ContaCorrenteTable assets={group.assets} />
              ) : (
                <MarketTable assets={group.assets} />
              )}
            </div>
          </details>
        ))}
      </main>
    </div>
  );
}
