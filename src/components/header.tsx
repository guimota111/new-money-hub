import Link from "next/link";
import { signOut } from "@/app/login/actions";

export function Header({ userName, view }: { userName: string; view?: "casal" }) {
  // preserva a visão do casal ao navegar entre as páginas
  const suffix = view === "casal" ? "?visao=casal" : "";
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <div className="flex items-center gap-6">
        <Link
          href={`/${suffix}`}
          className="text-sm font-semibold text-zinc-950 dark:text-zinc-50"
        >
          New Money Hub
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            href={`/assets${suffix}`}
            className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Ativos
          </Link>
          <Link
            href={`/movements${suffix}`}
            className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Movimentações
          </Link>
          <Link
            href={`/incomes${suffix}`}
            className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Receitas
          </Link>
          <Link
            href={`/expenses${suffix}`}
            className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Despesas
          </Link>
          <Link
            href="/connections"
            className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Conexões
          </Link>
        </nav>
      </div>
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
