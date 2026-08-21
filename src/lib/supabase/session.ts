import type { SupabaseClient } from "@supabase/supabase-js";

// Usuário da sessão validando o JWT localmente (getClaims/JWKS) em vez de
// chamar a API de auth do Supabase a cada página — o middleware já renovou a
// sessão nesta request, então aqui é só leitura do token, sem roundtrip.
export async function getSessionUser(
  supabase: SupabaseClient,
): Promise<{ id: string; email: string | null } | null> {
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return {
    id: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
  };
}
