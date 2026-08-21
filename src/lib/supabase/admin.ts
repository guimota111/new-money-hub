import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente com a secret key (service role) — ignora RLS. Usar somente em
// código de servidor (server actions / route handlers), nunca em Client
// Components. Hoje serve para o find-or-create em market_instruments, cuja
// escrita é bloqueada por RLS para usuários autenticados.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
