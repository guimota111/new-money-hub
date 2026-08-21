"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { pluggyAuth, createConnectToken } from "@/lib/pluggy";

// gera o token que o widget Pluggy Connect usa no navegador
export async function getConnectToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const apiKey = await pluggyAuth(
    process.env.PLUGGY_CLIENT_ID!,
    process.env.PLUGGY_CLIENT_SECRET!,
  );
  return createConnectToken(apiKey);
}

// registra o item criado pelo widget para o usuário logado
export async function saveConnection(itemId: string, label: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("bank_connections").insert({
    user_id: user.id,
    provider: "pluggy",
    item_id: itemId,
    label,
  });
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);

  revalidatePath("/connections");
}

// dispara a sincronização (mesmo motor do cron diário)
export async function syncNow() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const res = await fetch(`${proto}://${host}/api/cron/nubank`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    cache: "no-store",
  });
  const ok = res.ok ? "1" : "0";

  revalidatePath("/connections");
  revalidatePath("/");
  redirect(`/connections?synced=${ok}`);
}
