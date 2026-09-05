import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { RunDriver } from "@/components/run-driver";
import { formatBRL, formatPercent, formatUSD } from "@/lib/format";
import { allocationColor } from "@/lib/chart-colors";
import { loadRun, snapshotOf } from "@/lib/consultor/run";
import { NEWS_LEVEL_LABEL } from "@/lib/consultor/prompts";
import { marketOf } from "@/lib/consultor/shopping";
import type { NewsVerdict, RunRow, ShoppingItem } from "@/lib/consultor/types";
import { BackLink, card, linkClass, noticeWarn, sectionTitle, td, th } from "../../ui";

// cada etapa da análise roda numa server action chamada desta página; a de IA
// pode levar minutos
export const maxDuration = 300;

const VERDICT_LABEL: Record<string, string> = {
  keep: "manter",
  watch: "observar",
  trim: "reduzir",
  sell: "vender",
};
const VERDICT_CLASS: Record<string, string> = {
  keep: "border-zinc-200 text-zinc-500 dark:border-zinc-800",
  watch: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
  trim: "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400",
  sell: "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400",
};
const NEWS_CLASS: Record<NewsVerdict["level"], string> = {
  neutral: "border-zinc-200 text-zinc-500 dark:border-zinc-800",
  attention: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
  concerning: "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400",
};
const NEWS_ORDER: Record<NewsVerdict["level"], number> = { concerning: 0, attention: 1, neutral: 2 };

function money(value: number | null, currency: "BRL" | "USD"): string {
  if (value == null) return "—";
  return currency === "USD" ? formatUSD(value) : formatBRL(value);
}

function qty(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${className ?? "border-zinc-200 text-zinc-500 dark:border-zinc-800"}`}>
      {children}
    </span>
  );
}

function BuyTable({ items }: { items: ShoppingItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
            <th className={th}>Ativo</th>
            <th className={th}>Caixa</th>
            <th className={`${th} text-right`}>Valor</th>
            <th className={`${th} text-right`}>Qtd. aprox.</th>
            <th className={`${th} text-right`}>Preço usado</th>
            <th className={th}>Por quê</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={`${it.ticker}-${i}`} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              <td className={td}>
                <div className="flex flex-wrap items-center gap-2 font-medium text-zinc-950 dark:text-zinc-50">
                  {it.ticker}
                  <Badge>{it.type === "reinforce" ? "reforço" : "nova"}</Badge>
                  {it.flags.map((f) => (
                    <Badge key={f} className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400">
                      {f}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className={`${td} text-zinc-500`}>{it.categoryName}</td>
              <td className={`${td} text-right font-medium tabular-nums text-zinc-950 dark:text-zinc-50`}>
                {money(it.amountBrl, "BRL")}
              </td>
              <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>{qty(it.quantity)}</td>
              <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>{money(it.price, it.currency)}</td>
              <td className={`${td} max-w-md text-zinc-700 dark:text-zinc-300`}>{it.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Report({ run }: { run: RunRow }) {
  const state = run.state;
  const prepared = state.prepared;
  const shopping = state.shopping;
  if (!prepared || !shopping) return <p className={noticeWarn}>A análise terminou sem resultado legível.</p>;
  const l1 = prepared.level1;
  const buys = shopping.items.filter((i) => i.type === "buy" || i.type === "reinforce");
  const sales = shopping.items.filter((i) => i.type === "trim" || i.type === "sell");
  const watches = shopping.items.filter((i) => i.type === "watch");
  const subs = shopping.items.filter((i) => i.type === "substitute");
  const usage = state.usage;
  const news = state.news ?? {};
  const newsEntries = Object.entries(news).sort(
    (a, b) => NEWS_ORDER[a[1].level] - NEWS_ORDER[b[1].level] || a[0].localeCompare(b[0]),
  );
  const newsFor = (slug: string, ticker: string): NewsVerdict | undefined => news[`${marketOf(slug)}:${ticker}`];

  return (
    <>
      <section className={card}>
        <h2 className={sectionTitle}>Alocação vs meta</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                <th className={th}>Caixa</th>
                <th className={`${th} text-right`}>Atual</th>
                <th className={`${th} text-right`}>Meta</th>
                <th className={`${th} text-right`}>Ativos</th>
                <th className={`${th} text-right`}>Aporte</th>
              </tr>
            </thead>
            <tbody>
              {l1.reserve.target > 0 && (
                <tr className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className={`${td} text-zinc-700 dark:text-zinc-300`}>Reserva de emergência</td>
                  <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>{formatBRL(l1.reserve.current)}</td>
                  <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>{formatBRL(l1.reserve.target)}</td>
                  <td className={td} />
                  <td className={`${td} text-right font-medium tabular-nums text-zinc-950 dark:text-zinc-50`}>
                    {l1.reserve.suggested > 0 ? formatBRL(l1.reserve.suggested) : "—"}
                  </td>
                </tr>
              )}
              {l1.categories.map((c) => (
                <tr key={c.slug} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className={td}>
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: allocationColor(c.slug) }} />
                    <span className="text-zinc-950 dark:text-zinc-50">{c.name}</span>
                  </td>
                  <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>{formatPercent(c.currentPct)}</td>
                  <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>{formatPercent(c.targetPct, 0)}</td>
                  <td className={`${td} text-right tabular-nums text-zinc-700 dark:text-zinc-300`}>
                    {c.assetCount}
                    {c.maxAssets != null ? ` / ${c.maxAssets}` : ""}
                  </td>
                  <td className={`${td} text-right font-medium tabular-nums text-zinc-950 dark:text-zinc-50`}>
                    {c.suggested > 0.005 ? formatBRL(c.suggested) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {prepared.skipped.length > 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            Sem seleção de ativos: {prepared.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.
          </p>
        )}
        {l1.unclassified > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            {l1.unclassified} ativo{l1.unclassified === 1 ? "" : "s"} não classificado{l1.unclassified === 1 ? "" : "s"} ficaram fora.{" "}
            <Link href="/consultor/classificar" className="underline">
              Classificar
            </Link>
          </p>
        )}
      </section>

      <section className={card}>
        <h2 className={sectionTitle}>
          Lista de compras · {formatBRL(shopping.totalBuyBrl)}
          {shopping.unallocatedBrl > 0.005 ? ` · ${formatBRL(shopping.unallocatedBrl)} sem destino` : ""}
        </h2>
        {buys.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma compra sugerida nesta rodada.</p>
        ) : (
          <BuyTable items={buys} />
        )}
        {shopping.notes.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-zinc-500">
            {shopping.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      {(sales.length > 0 || watches.length > 0 || subs.length > 0) && (
        <section className={card}>
          <h2 className={sectionTitle}>Alertas sobre a carteira</h2>
          <ul className="space-y-3">
            {[...sales, ...subs, ...watches].map((it, i) => (
              <li key={`${it.ticker}-${it.type}-${i}`} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-950 dark:text-zinc-50">{it.ticker}</span>
                  <Badge className={VERDICT_CLASS[it.type] ?? VERDICT_CLASS.watch}>
                    {it.type === "substitute" ? "substituir" : VERDICT_LABEL[it.type] ?? it.type}
                  </Badge>
                  <span className="text-xs text-zinc-500">{it.categoryName}</span>
                  {it.amountBrl != null && (
                    <span className="text-xs tabular-nums text-zinc-500">
                      ≈ {formatBRL(it.amountBrl)}
                      {it.quantity != null ? ` · ${qty(it.quantity)} un` : ""}
                    </span>
                  )}
                  {it.flags.map((f) => (
                    <Badge key={f}>{f}</Badge>
                  ))}
                </div>
                <p className="mt-1 text-zinc-700 dark:text-zinc-300">{it.rationale}</p>
                {it.taxNote && <p className="mt-0.5 text-xs text-zinc-500">Imposto: {it.taxNote}.</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {newsEntries.length > 0 && (
        <section className={card}>
          <h2 className={sectionTitle}>Notícias · últimos 6 meses</h2>
          <ul className="space-y-3">
            {newsEntries.map(([key, v]) => {
              const [market, ticker] = key.split(":");
              const target = prepared.watchlist.find((w) => w.market === market && w.ticker === ticker);
              return (
                <li key={key} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-950 dark:text-zinc-50">{ticker}</span>
                    <Badge className={NEWS_CLASS[v.level]}>
                      {NEWS_LEVEL_LABEL[v.level]}
                      {v.recurring ? " · recorrente" : ""}
                    </Badge>
                    {target && <span className="text-xs text-zinc-500">{target.categoryName}</span>}
                    {!target && <span className="text-xs text-zinc-500">finalista</span>}
                    {target?.outsideAnalysis && <Badge>fora das caixas analisadas</Badge>}
                    {v.cached && <Badge>veredito de rodada anterior</Badge>}
                    {v.themes.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                  <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{v.summary}</p>
                  {v.headlines.length > 0 && (
                    <details className="mt-1 text-xs text-zinc-500">
                      <summary className="cursor-pointer select-none">
                        {v.headlines.length} manchete{v.headlines.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {v.headlines.slice(0, 10).map((h) => (
                          <li key={h.url}>
                            <a href={h.url} target="_blank" rel="noreferrer" className="underline">
                              {h.title}
                            </a>
                            {h.source ? ` · ${h.source}` : ""}
                            {h.publishedAt ? ` · ${new Date(h.publishedAt).toLocaleDateString("pt-BR")}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {prepared.categories.map((cat) => {
        const r = state.rankings?.[cat.slug];
        if (!r) return null;
        const alts = shopping.items.filter((i) => i.type === "alternative" && i.category === cat.slug);
        return (
          <section key={cat.slug} className={card}>
            <h2 className={sectionTitle}>
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: allocationColor(cat.slug) }} />
              {cat.name} · aporte {formatBRL(cat.aporte)} · {cat.candidates.length} candidatos avaliados
            </h2>
            {r.holdings_review.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Posições atuais</h3>
                <ul className="space-y-2">
                  {r.holdings_review.map((h) => {
                    const holding = cat.holdings.find((x) => x.ticker === h.ticker);
                    const v = newsFor(cat.slug, h.ticker);
                    return (
                      <li key={h.ticker} className="text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-950 dark:text-zinc-50">{h.ticker}</span>
                          <Badge className={VERDICT_CLASS[h.verdict]}>
                            {VERDICT_LABEL[h.verdict]}
                            {h.verdict === "trim" && h.trim_pct > 0 ? ` ${h.trim_pct.toFixed(0)}%` : ""}
                          </Badge>
                          {holding && (
                            <span className="text-xs tabular-nums text-zinc-500">
                              {formatBRL(holding.valueBrl)} · {formatPercent(holding.weightPct)} da caixa
                              {holding.gainPct != null ? ` · ${holding.gainPct >= 0 ? "+" : ""}${formatPercent(holding.gainPct)}` : ""}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{h.rationale}</p>
                        {v && v.level !== "neutral" && (
                          <p className="mt-0.5 text-xs text-zinc-500">
                            <span className={`rounded-full border px-1.5 py-0.5 ${NEWS_CLASS[v.level]}`}>
                              notícias: {NEWS_LEVEL_LABEL[v.level]}
                              {v.recurring ? " · recorrente" : ""}
                            </span>{" "}
                            {v.summary}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {alts.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Alternativas</h3>
                <ul className="space-y-1.5">
                  {alts.map((a) => (
                    <li key={a.ticker} className="text-sm">
                      <span className="font-medium text-zinc-950 dark:text-zinc-50">{a.ticker}</span>
                      {a.price != null && <span className="ml-2 text-xs tabular-nums text-zinc-500">{money(a.price, a.currency)}</span>}
                      <span className="text-zinc-700 dark:text-zinc-300"> — {a.rationale}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.notes && <p className="text-sm text-zinc-600 dark:text-zinc-400">{r.notes}</p>}
            <details className="mt-3 text-xs text-zinc-500">
              <summary className="cursor-pointer select-none">Pré-filtro desta caixa</summary>
              <p className="mt-1">
                {cat.screen.passed} de {cat.screen.universe} passaram
                {cat.screen.rejected.length > 0
                  ? `; cortes: ${cat.screen.rejected.map(([reason, n]) => `${n} ${reason}`).join(" · ")}`
                  : ""}
                .
              </p>
            </details>
          </section>
        );
      })}

      {run.narrative && (
        <section className={card}>
          <h2 className={sectionTitle}>Relatório</h2>
          <div className="space-y-3 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
            {run.narrative.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="whitespace-pre-line">
                {para}
              </p>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-zinc-500">
        Custo desta análise: US$ {usage.costUsd.toFixed(2)}
        {prepared.fxRate ? ` (≈ ${formatBRL(usage.costUsd * prepared.fxRate)})` : ""} ·{" "}
        {(usage.input + usage.cacheRead + usage.cacheWrite).toLocaleString("pt-BR")} tokens de entrada ·{" "}
        {usage.output.toLocaleString("pt-BR")} de saída · Opus 5 na seleção, Sonnet 5 no relatório. A
        compra é sua decisão: o consultor não executa ordens.
      </p>
    </>
  );
}

export default async function AnalisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, run] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    loadRun(supabase, user.id, id),
  ]);
  if (!run) redirect("/consultor?erro=" + encodeURIComponent("Análise não encontrada."));

  const created = new Date(run.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <BackLink />
            <h1 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
              Análise de {created}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Aporte {formatBRL(Number(run.contribution_amount))} · modo{" "}
              {run.mode === "full" ? "completo" : "padrão"}
              {run.fx_rate ? ` · dólar ${Number(run.fx_rate).toFixed(2)}` : ""}
            </p>
          </div>
          <Link href="/consultor" className={linkClass}>
            Nova análise
          </Link>
        </div>

        {run.status !== "done" && (
          <section className={card}>
            <h2 className={sectionTitle}>Andamento</h2>
            <RunDriver initial={snapshotOf(run)} />
          </section>
        )}

        {run.status === "done" && <Report run={run} />}
      </main>
    </div>
  );
}
