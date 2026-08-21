import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { Header } from "@/components/header";
import { PluggyConnectButton } from "@/components/pluggy-connect-button";
import { SubmitButton } from "@/components/submit-button";
import { getConnectToken, saveConnection, syncNow } from "./actions";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ synced?: string }>;
}) {
  const { synced } = await searchParams;

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [{ data: profile }, { data: connections }] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).single(),
    supabase
      .from("bank_connections")
      .select("id, label, item_id, created_at")
      .order("created_at"),
  ]);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Header userName={profile?.name ?? user.email ?? ""} />
      <main className="w-full max-w-2xl flex-1 space-y-6 px-6 py-10">
        <div>
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            Conexões bancárias
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Conecte seu banco via Open Finance (Pluggy) para sincronizar conta,
            caixinhas e despesas do cartão automaticamente.
          </p>
        </div>

        {synced === "1" && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            Sincronização concluída.
          </p>
        )}
        {synced === "0" && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            A sincronização falhou — tente de novo em instantes.
          </p>
        )}

        <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Minhas conexões
          </h2>
          {(connections ?? []).length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum banco conectado ainda.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {(connections ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      {c.label ?? "Banco"}
                    </p>
                    <p className="text-xs text-zinc-500">
                      conectado em {new Date(c.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <span className="text-xs text-emerald-700 dark:text-emerald-400">ativa</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <PluggyConnectButton getToken={getConnectToken} save={saveConnection} />
            {(connections ?? []).length > 0 && (
              <form action={syncNow}>
                <SubmitButton
                  pendingText="Sincronizando..."
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Sincronizar agora
                </SubmitButton>
              </form>
            )}
          </div>
        </section>

        <p className="text-xs text-zinc-500">
          A sincronização também roda automaticamente todos os dias. Suas
          credenciais bancárias ficam na Pluggy (regulada pelo Open Finance) —
          o app guarda apenas o identificador da conexão.
        </p>
      </main>
    </div>
  );
}
