"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { ThemeToggle } from "@/components/theme-toggle";

const LINKS = [
  { href: "/months", label: "Meses" },
  { href: "/years", label: "Anos" },
  { href: "/assets", label: "Ativos" },
  { href: "/consultor", label: "Consultor" },
  { href: "/movements", label: "Movimentações" },
  { href: "/incomes", label: "Receitas" },
  { href: "/expenses", label: "Despesas" },
  { href: "/connections", label: "Conexões" },
  { href: "/settings", label: "Opções" },
];

// No desktop é uma linha só (marca · nav · usuário); no celular a marca e o
// usuário dividem a primeira linha e a nav vira uma faixa rolável abaixo.
export function Header({ userName, view }: { userName: string; view?: "casal" }) {
  const pathname = usePathname();
  // preserva a visão do casal ao navegar entre as páginas
  const suffix = view === "casal" ? "?visao=casal" : "";
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-6 sm:py-4">
      <Link
        href={`/${suffix}`}
        className={`order-1 mr-auto text-sm font-semibold sm:mr-0 ${
          pathname === "/"
            ? "text-zinc-950 dark:text-zinc-50"
            : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
        }`}
      >
        New Money Hub
      </Link>
      <nav className="no-scrollbar order-3 -mx-4 flex w-[calc(100%+2rem)] items-center gap-4 overflow-x-auto whitespace-nowrap px-4 pb-1 sm:order-2 sm:mx-0 sm:w-auto sm:flex-1 sm:px-0 sm:pb-0">
        {LINKS.map((link) => {
          const active =
            pathname === link.href ||
            pathname.startsWith(`${link.href}/`) ||
            (link.href === "/movements" && pathname.startsWith("/import"));
          return (
            <Link
              key={link.href}
              href={`${link.href}${suffix}`}
              className={
                active
                  ? "text-sm font-medium text-zinc-950 underline decoration-2 underline-offset-8 dark:text-zinc-50 dark:decoration-cyan-400"
                  : "text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="order-2 flex items-center gap-4 sm:order-3">
        <ThemeToggle />
        <span className="hidden text-sm text-zinc-500 md:inline">{userName}</span>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm text-zinc-500 underline hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
