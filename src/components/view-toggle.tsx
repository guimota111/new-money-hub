import Link from "next/link";

// Alterna entre "Meu" (só os dados do usuário) e "Casal" (household inteiro).
// Preserva os filtros atuais, mas zera a paginação — a contagem de páginas
// muda de uma visão para a outra.
export function ViewToggle({
  basePath,
  params,
  casal,
}: {
  basePath: string;
  params?: Record<string, string | undefined>;
  casal: boolean;
}) {
  const href = (target: "meu" | "casal") => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value && key !== "visao" && key !== "pagina") search.set(key, value);
    }
    if (target === "casal") search.set("visao", "casal");
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const active =
    "rounded-md bg-zinc-950 px-3 py-1 font-medium text-white dark:bg-zinc-50 dark:text-zinc-950";
  const idle =
    "rounded-md px-3 py-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50";

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-300 bg-white p-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-950">
      <Link href={href("meu")} className={casal ? idle : active}>
        Meu
      </Link>
      <Link href={href("casal")} className={casal ? active : idle}>
        Casal
      </Link>
    </div>
  );
}
