import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { SubmitButton } from "@/components/submit-button";
import { formatPercent } from "@/lib/format";
import { isUsClass } from "@/lib/portfolio";
import { loadAllocationData } from "@/lib/allocation-data";
import {
  BR_TTL_DAYS,
  buildFundamentalsIndex,
  DETAILS_TTL_DAYS,
  isStale,
  loadFundamentalsData,
  MIGRATION_FILE_0009,
  US_TTL_DAYS,
  type SourceStatus,
} from "@/lib/fundamentals/cache";
import {
  SCREEN_CATEGORIES,
  screenCategory,
  type ScreenCategory,
  type ScreenedAsset,
} from "@/lib/fundamentals/screen";
import { SOURCES, type Fundamentals } from "@/lib/fundamentals/types";
import { SP500_FETCHED_AT, universeEntryFor } from "@/lib/fundamentals/universe";
import { refreshBrAction, refreshDetailsAction, refreshUsAction } from "./actions";
import {
  BackLink,
  card,
  linkClass,
  noticeError,
  noticeOk,
  noticeWarn,
  primaryButton,
  sectionTitle,
  td,
  th,
} from "../ui";

// as atualizações manuais (Finnhub ~1 símbolo/s) precisam de mais que o
// padrão da função
export const maxDuration = 120;

const CATEGORY_LABEL: Record<ScreenCategory, string> = {
  acoes_br: "Ações Brasileiras",
  fiis: "Fundos Imobiliários",
  acoes_eua: "Ações Americanas",
  internacional: "Internacional",
};

function compact(value: number | null, currency: "BRL" | "USD"): string {
  if (value == null) return "—";
  const prefix = currency === "BRL" ? "R$ " : "US$ ";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${prefix}${(value / 1e9).toFixed(1).replace(".", ",")} bi`;
  if (abs >= 1e6) return `${prefix}${(value / 1e6).toFixed(1).replace(".", ",")} mi`;
  if (abs >= 1e3) return `${prefix}${(value / 1e3).toFixed(0)} mil`;
  return `${prefix}${value.toFixed(2).replace(".", ",")}`;
}

function num(value: number | null, digits = 1): string {
  return value == null ? "—" : value.toFixed(digits).replace(".", ",");
}

function pct(value: number | null): string {
  return value == null ? "—" : formatPercent(value, 1);
}

function money(value: number | null, currency: "BRL" | "USD"): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function relative(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  return `há ${days} dias`;
}

function SourceRow({
  label,
  status,
  ttlDays,
  extra,
}: {
  label: string;
  status: SourceStatus | undefined;
  ttlDays: number;
  extra?: string;
}) {
  const stale = isStale(status, ttlDays);
  return (
    <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
      <td className={`${td} text-zinc-950 dark:text-zinc-50`}>{label}</td>
      <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>
        {status ? status.item_count : "—"}
      </td>
      <td className={`${td} ${stale ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}>
        {relative(status?.refreshed_at)}
        {status?.note ? ` · ${status.note}` : ""}
        {extra ? ` · ${extra}` : ""}
      </td>
    </tr>
  );
}

function CandidatesTable({
  category,
  rows,
}: {
  category: ScreenCategory;
  rows: ScreenedAsset[];
}) {
  const isBr = category === "acoes_br";
  const isFii = category === "fiis";
  const currency: "BRL" | "USD" = isBr || isFii ? "BRL" : "USD";
  const headers = isFii
    ? ["Ticker", "Segmento", "Preço", "Valor de mercado", "DY", "P/VP", "FFO yield", "Cap rate", "Vacância", "Liquidez/dia", "Nota"]
    : isBr
      ? ["Ticker", "Empresa · setor", "Preço", "Valor de mercado", "P/L", "P/VP", "DY", "ROE", "Dív. líq./PL", "Cresc. rec. 5a", "Liquidez/dia", "Nota"]
      : ["Ticker", "Empresa · setor", "Valor de mercado", "P/L", "P/VP", "DY", "ROE", "Margem líq.", "Cresc. rec. 5a", "Cresc. EPS 5a", "Dív./PL", "Nota"];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
            {headers.map((h, i) => (
              <th key={h} className={`${th} ${i >= 2 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ f, held, heldButFailing, score }) => {
            const cellR = `${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`;
            return (
              <tr
                key={f.ticker}
                className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${
                  held ? "bg-emerald-50/50 dark:bg-emerald-950/20" : ""
                }`}
              >
                <td className={td}>
                  <div className="font-medium text-zinc-950 dark:text-zinc-50">
                    {f.ticker}
                    {held && (
                      <span className="ml-2 rounded-full border border-emerald-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
                        na carteira
                      </span>
                    )}
                    {f.kind === "etf" && (
                      <span className="ml-2 rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                        ETF
                      </span>
                    )}
                  </div>
                  {heldButFailing && (
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                      falharia no filtro: {heldButFailing}
                    </div>
                  )}
                </td>
                <td className={`${td} max-w-56 text-zinc-700 dark:text-zinc-300`}>
                  <div className="truncate">{f.name ?? "—"}</div>
                  <div className="truncate text-xs text-zinc-500">
                    {isFii ? f.segment ?? "—" : [f.sector, f.subsector].filter(Boolean).join(" · ") || "—"}
                  </div>
                </td>
                {(isBr || isFii) && <td className={cellR}>{money(f.price, currency)}</td>}
                <td className={cellR}>{compact(f.marketCap, currency)}</td>
                {isFii ? (
                  <>
                    <td className={cellR}>{pct(f.dy)}</td>
                    <td className={cellR}>{num(f.pb, 2)}</td>
                    <td className={cellR}>{pct(f.ffoYield)}</td>
                    <td className={cellR}>{pct(f.capRate)}</td>
                    <td className={cellR}>{pct(f.vacancy)}</td>
                    <td className={cellR}>{compact(f.liquidity, "BRL")}</td>
                  </>
                ) : isBr ? (
                  <>
                    <td className={cellR}>{num(f.pe)}</td>
                    <td className={cellR}>{num(f.pb, 2)}</td>
                    <td className={cellR}>{pct(f.dy)}</td>
                    <td className={cellR}>{pct(f.roe)}</td>
                    <td className={cellR}>{num(f.netDebtToEquity, 2)}</td>
                    <td className={cellR}>{pct(f.revenueGrowth5y)}</td>
                    <td className={cellR}>{compact(f.liquidity, "BRL")}</td>
                  </>
                ) : (
                  <>
                    <td className={cellR}>{num(f.pe)}</td>
                    <td className={cellR}>{num(f.pb, 2)}</td>
                    <td className={cellR}>{pct(f.dy)}</td>
                    <td className={cellR}>{pct(f.roe)}</td>
                    <td className={cellR}>{pct(f.netMargin)}</td>
                    <td className={cellR}>{pct(f.revenueGrowth5y)}</td>
                    <td className={cellR}>{pct(f.earningsGrowth)}</td>
                    <td className={cellR}>{num(f.netDebtToEquity, 2)}</td>
                  </>
                )}
                <td className={`${cellR} font-medium text-zinc-950 dark:text-zinc-50`}>
                  {(score * 100).toFixed(0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function UniversoPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; erro?: string; ok?: string }>;
}) {
  const { cat, erro, ok } = await searchParams;
  const category: ScreenCategory = SCREEN_CATEGORIES.includes(cat as ScreenCategory)
    ? (cat as ScreenCategory)
    : "acoes_br";

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, allocation, fundamentals] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    loadAllocationData(supabase, user.id),
    loadFundamentalsData(supabase),
  ]);

  // posições atuais por categoria do consultor (só as que têm ticker)
  const slugById = new Map(allocation.categories.map((c) => [c.id, c.slug]));
  const heldByCategory = new Map<string, Set<string>>();
  const usHeld: string[] = [];
  for (const a of allocation.assets) {
    const ticker = a.market_instruments?.ticker?.toUpperCase();
    if (!ticker || a.allocation_excluded || !a.allocation_category_id) continue;
    const slug = slugById.get(a.allocation_category_id);
    if (!slug) continue;
    if (!heldByCategory.has(slug)) heldByCategory.set(slug, new Set());
    heldByCategory.get(slug)!.add(ticker);
    if (isUsClass(a.asset_classes?.slug)) usHeld.push(ticker);
  }

  const index = fundamentals.ready ? buildFundamentalsIndex(fundamentals.rows, usHeld) : null;

  function universeFor(c: ScreenCategory): Fundamentals[] {
    if (!index) return [];
    const held = heldByCategory.get(c) ?? new Set<string>();
    if (c === "acoes_br") return index.brStocks;
    if (c === "fiis") return index.fiis;
    const want = c === "acoes_eua" ? "us" : "intl";
    return index.us.filter((f) => universeEntryFor(f.ticker).exposure === want || held.has(f.ticker));
  }

  const result = index
    ? screenCategory(category, universeFor(category), heldByCategory.get(category) ?? new Set())
    : null;

  const status = fundamentals.status;
  const usTotal = index?.us.length ?? 0;
  const usDone = status.get(SOURCES.finnhubMetric)?.item_count ?? 0;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <BackLink />
          <h1 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            Universo e pré-filtro
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            De onde a IA vai escolher. O código só tira quem não tem dado, liquidez ou passa
            longe dos critérios e corta o universo para um tamanho legível. Posições atuais
            ficam sempre, marcadas.
          </p>
        </div>

        {erro && <p className={noticeError}>{erro}</p>}
        {ok && <p className={noticeOk}>{ok}</p>}

        {!fundamentals.ready && (
          <p className={noticeWarn}>
            O cache de fundamentos precisa da migração 0009. Rode{" "}
            <code className="font-mono text-xs">{MIGRATION_FILE_0009}</code> no SQL editor do
            Supabase e recarregue.
          </p>
        )}

        {fundamentals.ready && (
          <>
            <section className={`${card} p-0`}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6">
                <h2 className={`${sectionTitle} mb-0`}>Fontes</h2>
                <div className="flex flex-wrap gap-2">
                  <form action={refreshBrAction}>
                    <SubmitButton pendingText="Buscando B3..." className={primaryButton}>
                      Atualizar B3
                    </SubmitButton>
                  </form>
                  <form action={refreshUsAction}>
                    <SubmitButton pendingText="Buscando EUA (~1 min)..." className={primaryButton}>
                      Atualizar EUA (lote de 60)
                    </SubmitButton>
                  </form>
                  <form action={refreshDetailsAction}>
                    <SubmitButton pendingText="Buscando..." className={primaryButton}>
                      Detalhar posições B3
                    </SubmitButton>
                  </form>
                </div>
              </div>
              <div className="overflow-x-auto pt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                      <th className={th}>Fonte</th>
                      <th className={`${th} text-right`}>Ativos</th>
                      <th className={th}>Atualizada</th>
                    </tr>
                  </thead>
                  <tbody>
                    <SourceRow label="Fundamentus · ações B3" status={status.get(SOURCES.fundamentusStock)} ttlDays={BR_TTL_DAYS} />
                    <SourceRow label="Fundamentus · FIIs" status={status.get(SOURCES.fundamentusFii)} ttlDays={BR_TTL_DAYS} />
                    <SourceRow label="brapi · lista B3 (setor, valor de mercado)" status={status.get(SOURCES.brapiStock)} ttlDays={BR_TTL_DAYS} />
                    <SourceRow
                      label={`Finnhub · métricas EUA (S&P 500 de ${SP500_FETCHED_AT}, ETFs, ADRs)`}
                      status={status.get(SOURCES.finnhubMetric)}
                      ttlDays={US_TTL_DAYS}
                      extra={`${usDone} de ${usTotal} símbolos`}
                    />
                    <SourceRow label="Fundamentus · detalhe das posições" status={status.get(SOURCES.fundamentusDetails)} ttlDays={DETAILS_TTL_DAYS} />
                  </tbody>
                </table>
              </div>
              <p className="px-6 pb-5 pt-3 text-xs text-zinc-500">
                O cron diário refaz a B3 a cada {BR_TTL_DAYS} dias e avança os EUA em lotes; a
                Finnhub grátis aceita 60 chamadas por minuto, então o universo americano leva
                alguns dias para completar na primeira vez.
              </p>
            </section>

            <div className="flex flex-wrap gap-2">
              {SCREEN_CATEGORIES.map((c) => (
                <Link
                  key={c}
                  href={`/consultor/universo?cat=${c}`}
                  className={
                    c === category
                      ? "rounded-full bg-zinc-950 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : "rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }
                >
                  {CATEGORY_LABEL[c]}
                </Link>
              ))}
            </div>

            {result && (
              <section className={`${card} p-0`}>
                <div className="space-y-3 px-6 pt-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 className={`${sectionTitle} mb-0`}>
                      {CATEGORY_LABEL[category]}: {result.passed.length} candidatos de {result.universe}
                    </h2>
                    <Link href="/consultor/classificar" className={linkClass}>
                      Classificar ativos
                    </Link>
                  </div>
                  <details className="text-sm text-zinc-600 dark:text-zinc-400">
                    <summary className="cursor-pointer select-none">Regras do pré-filtro e motivos de corte</summary>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5">
                      {result.rules.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    {result.rejected.size > 0 && (
                      <p className="mt-2 text-xs text-zinc-500">
                        Cortados:{" "}
                        {[...result.rejected.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .map(([reason, n]) => `${n} ${reason}`)
                          .join(" · ")}
                        .
                      </p>
                    )}
                  </details>
                </div>
                {result.passed.length === 0 ? (
                  <p className="px-6 pb-6 pt-4 text-sm text-zinc-500">
                    Nenhum candidato ainda. Atualize a fonte desta categoria acima.
                  </p>
                ) : (
                  <div className="pt-3">
                    <CandidatesTable category={category} rows={result.passed} />
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
