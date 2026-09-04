"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { ThemeToggle } from "@/components/theme-toggle";

const LINKS = [
  { href: "/months", label: "Meses" },
  { href: "/years", label: "Anos" },
  { href: "/assets", label: "Ativos" },
  { href: "/movements", label: "Movimentações" },
  { href: "/incomes", label: "Receitas" },
  { href: "/expenses", label: "Despesas" },
  { href: "/connections", label: "Conexões" },
  { href: "/settings", label: "Opções" },
];

export function Header({ userName, view }: { userName: string; view?: "casal" }) {
  const pathname = usePathname();
  // preserva a visão do casal ao navegar entre as páginas
  const suffix = view === "casal" ? "?visao=casal" : "";
  return (
    <header className="flex flex-wrap items-center justify-between gap-y-2 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link
          href={`/${suffix}`}
          className={`text-sm font-semibold ${
            pathname === "/"
              ? "text-zinc-950 dark:text-zinc-50"
              : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
          }`}
        >
          New Money Hub
        </Link>
        <nav className="flex flex-wrap items-center gap-4">
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
      </div>
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <span className="text-sm text-zinc-500">{userName}</span>
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
