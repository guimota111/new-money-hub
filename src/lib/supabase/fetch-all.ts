interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

// O PostgREST corta qualquer resposta em 1000 linhas (config max-rows do
// Supabase) — .limit(5000) NÃO passa disso. Para somas/agregações sobre
// conjuntos grandes, pagina com .range() até esgotar.
//
// A query da factory precisa de ORDER BY estável com desempate único
// (ex: .order("received_at").order("id")) para as páginas não se sobreporem.
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  { pageSize = 1000, max = 20000 }: { pageSize?: number; max?: number } = {},
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const { data } = await page(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}
