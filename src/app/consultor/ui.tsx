import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { MIGRATION_FILE } from "@/lib/allocation";
import { seedDefaults } from "./actions";

// Classes e blocos compartilhados pelas páginas do Consultor de Alocação.

export const card =
  "rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950";
export const sectionTitle =
  "mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500";
export const inputClass =
  "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
export const primaryButton =
  "rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
export const linkClass =
  "text-sm text-zinc-500 underline hover:text-zinc-950 dark:hover:text-zinc-50";
export const noticeWarn =
  "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";
export const noticeError =
  "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
export const noticeOk =
  "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300";
export const th = "px-4 py-3 font-medium";
export const td = "px-4 py-3";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

export function BackLink() {
  return (
    <Link href="/consultor" className={linkClass}>
      ← Voltar ao consultor
    </Link>
  );
}

export function MigrationNotice() {
  return (
    <p className={noticeWarn}>
      O Consultor de Alocação precisa da migração 0007. Rode{" "}
      <code className="font-mono text-xs">{MIGRATION_FILE}</code> no SQL editor do
      Supabase e recarregue esta página.
    </p>
  );
}

// Sem categorias ainda: oferece o conjunto padrão da spec (30/30/15/15/7/3).
export function EmptyCategories() {
  return (
    <section className={`${card} space-y-4`}>
      <h2 className={sectionTitle}>Comece pelas categorias</h2>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        O consultor compara cada caixa da carteira com uma meta em %. Crie o conjunto
        padrão e ajuste depois: Renda Fixa 30%, Ações Brasileiras 30%, Fundos
        Imobiliários 15%, Ações Americanas 15%, Internacional 7% e Criptomoedas 3%,
        com teto global de 30 ativos.
      </p>
      <form action={seedDefaults}>
        <SubmitButton pendingText="Criando..." className={primaryButton}>
          Criar categorias padrão
        </SubmitButton>
      </form>
    </section>
  );
}
