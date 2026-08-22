import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { SubmitButton } from "@/components/submit-button";
import { importB3 } from "./actions";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ mov?: string; inc?: string; dup?: string; pos?: string; erro?: string }>;
}) {
  const result = await searchParams;

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  const imported = result.mov != null;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full max-w-2xl flex-1 space-y-6 px-6 py-10">
        <div>
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            Importar extrato da B3
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Exporte a Movimentação em{" "}
            <a
              href="https://www.investidor.b3.com.br/extrato/movimentacao"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              b3.com.br
            </a>{" "}
            (Extratos → Movimentação → Exportar para Excel) e envie o arquivo
            aqui. Linhas já importadas são ignoradas — pode mandar períodos
            sobrepostos sem medo.
          </p>
        </div>

        {result.erro && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {result.erro}
          </p>
        )}
        {imported && (
          <div className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            <p>
              Importado: {result.mov} movimentação{result.mov === "1" ? "" : "s"} nova
              {result.mov === "1" ? "" : "s"}, {result.inc} provento{result.inc === "1" ? "" : "s"}
              {Number(result.dup) > 0 && ` · ${result.dup} linha(s) já existiam e foram ignoradas`}
            </p>
            {result.pos && <p>Posições atualizadas: {result.pos.split(",").join(", ")}</p>}
          </div>
        )}

        <form
          action={importB3}
          className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="space-y-1">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Arquivo (.xlsx)
            </label>
            <input
              type="file"
              name="file"
              accept=".xlsx"
              required
              className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-950 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800 dark:text-zinc-300 dark:file:bg-zinc-50 dark:file:text-zinc-950 dark:hover:file:bg-zinc-200"
            />
          </div>
          <SubmitButton
            pendingText="Importando..."
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Importar
          </SubmitButton>
        </form>

        <p className="text-xs text-zinc-500">
          O import grava as movimentações, lança os proventos (dividendos, JCP e
          rendimentos) em Receitas e recalcula quantidade e preço médio dos
          ativos afetados. O extrato entra sempre na <em>sua</em> conta — cada um
          importa o próprio.
        </p>
      </main>
    </div>
  );
}
