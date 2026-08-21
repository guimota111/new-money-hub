import { signOut } from "@/app/login/actions";

export function Header({ userName }: { userName: string }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        New Money Hub
      </span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-zinc-500">{userName}</span>
        <form action={signOut}>
          <button type="submit" className="text-sm text-zinc-500 underline hover:text-zinc-950 dark:hover:text-zinc-50">
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
