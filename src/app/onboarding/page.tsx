import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { SubmitButton } from "@/components/submit-button";
import { createHousehold, linkPartner } from "./actions";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id, households(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Crie seu household
          </h1>
          <p className="text-sm text-zinc-500">
            É onde você e seu parceiro(a) vão consolidar o patrimônio do
            casal.
          </p>
          <form action={createHousehold} className="space-y-3">
            <input
              name="name"
              placeholder="Ex: Casa do Gui e da Lara"
              required
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <SubmitButton
              pendingText="Criando..."
              className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Criar household
            </SubmitButton>
          </form>
        </div>
      </div>
    );
  }

  const { data: members } = await supabase
    .from("household_members")
    .select("user_id, profiles(name)")
    .eq("household_id", membership.household_id);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          {(membership.households as unknown as { name: string } | null)?.name}
        </h1>
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Membros</p>
          <ul className="text-sm text-zinc-500">
            {members?.map((m) => (
              <li key={m.user_id}>
                {(m.profiles as unknown as { name: string } | null)?.name ?? m.user_id}
              </li>
            ))}
          </ul>
        </div>

        {members && members.length < 2 && (
          <form action={linkPartner} className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="text-sm text-zinc-500">
              Opcional: vincule o e-mail do seu parceiro(a) para consolidar o
              patrimônio do casal (a pessoa precisa já ter uma conta no New
              Money Hub — dá pra fazer isso depois, a qualquer momento).
            </p>
            <input
              name="partner_email"
              type="email"
              placeholder="parceiro@email.com"
              required
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <SubmitButton
              pendingText="Vinculando..."
              className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Vincular parceiro(a)
            </SubmitButton>
          </form>
        )}

        <Link
          href="/"
          className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {members && members.length >= 2 ? "Ir para o dashboard" : "Continuar sozinho por agora"}
        </Link>
      </div>
    </div>
  );
}
