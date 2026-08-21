import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createHousehold, linkPartner } from "./actions";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id, households(name)")
    .eq("user_id", user.id)
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
            <button
              type="submit"
              className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Criar household
            </button>
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
              Vincule o e-mail do seu parceiro(a) (a pessoa precisa já ter uma
              conta no New Money Hub).
            </p>
            <input
              name="partner_email"
              type="email"
              placeholder="parceiro@email.com"
              required
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="submit"
              className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Vincular parceiro(a)
            </button>
          </form>
        )}

        {members && members.length >= 2 && (
          <Link
            href="/"
            className="block w-full rounded-md bg-zinc-950 px-3 py-2 text-center text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Ir para o dashboard
          </Link>
        )}
      </div>
    </div>
  );
}
