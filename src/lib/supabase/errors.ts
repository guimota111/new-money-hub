// Tabela ou coluna ainda não existe: migração pendente. O PostgREST devolve
// PGRST205 para tabela fora do schema cache; o Postgres, 42P01 para relação e
// 42703 para coluna inexistente. As páginas usam isso para degradar com aviso
// em vez de quebrar, já que as migrações são coladas à mão no SQL editor.
export function isMissingTableError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42703" || error.code === "PGRST205") return true;
  return /schema cache|does not exist/i.test(error.message ?? "");
}
