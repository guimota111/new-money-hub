// Remove lançamentos de conta que não deviam ter virado receita/despesa
// (movimentos de investimento). Uso: --commit para gravar.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z]/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const BAD = /(compra|venda) de renda vari|criptomoeda|tesouro direto|aplica[çc][ãa]o|resgate rdb|resgate cdb|dinheiro guardado|caixinha(?! )|valor recebido de investimentos/i;

for (const table of ["expenses", "incomes"]) {
  const { data } = await db
    .from(table)
    .select("id, description, amount, " + (table === "expenses" ? "spent_at" : "received_at"))
    .eq("source", "pluggy")
    .not("external_id", "is", null)
    .limit(20000);
  const bad = (data ?? []).filter((r) => r.description && BAD.test(r.description));
  const total = bad.reduce((s, r) => s + Number(r.amount), 0);
  const byDesc = new Map();
  for (const r of bad) {
    const key = r.description.split("|")[0].trim();
    const e = byDesc.get(key) ?? { n: 0, v: 0 };
    e.n++; e.v += Number(r.amount);
    byDesc.set(key, e);
  }
  console.log(`\n${table}: ${bad.length} linha(s) indevidas — R$ ${total.toFixed(2)}`);
  for (const [k, e] of byDesc) console.log(`  ${e.n}x R$ ${e.v.toFixed(2)}  ${k}`);
  if (COMMIT && bad.length > 0) {
    for (let i = 0; i < bad.length; i += 100) {
      const { error } = await db.from(table).delete().in("id", bad.slice(i, i + 100).map((r) => r.id));
      if (error) throw error;
    }
    console.log(`  -> apagadas`);
  }
}
if (!COMMIT) console.log("\nDRY RUN — nada apagado.");
