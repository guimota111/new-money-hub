import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  pluggyAuth,
  itemVisible,
  fetchAccounts,
  fetchInvestments,
  fetchAllTransactions,
} from "@/lib/pluggy";

export const maxDuration = 120;

// mapeia a categoria da Pluggy (inglês) para nossos slugs
const CATEGORY_RULES: [RegExp, string][] = [
  [/grocer|eating out|food|restaurant|bakery|coffee/i, "alimentacao"],
  [/taxi|ride-hailing|gas station|parking|public transport|automotive|car|transport|toll/i, "transporte"],
  [/health|pharmac|wellness|fitness|gym|dentist|doctor|hospital/i, "saude"],
  [/course|education|school|university|bookstore/i, "educacao"],
  [/digital service|streaming|subscription|telecom|internet|mobile/i, "assinaturas"],
  [/gambling|entertainment|travel|accomodation|accommodation|airfare|cinema|leisure|bar|nightlife|event/i, "lazer"],
  [/rent|housing|electricity|utilit|water|home|condominium|houseware|furniture/i, "moradia"],
];

function mapCategory(category: string | null): string {
  if (!category) return "outros";
  for (const [pattern, slug] of CATEGORY_RULES) {
    if (pattern.test(category)) return slug;
  }
  return "outros";
}

function caixinhaLabel(rate: number | null, rateType: string | null, dueDate: string | null): string {
  const taxa = rate != null && rateType ? `${rate}% ${rateType}` : "CDI";
  const venc = dueDate ? ` · venc. ${dueDate.slice(0, 7)}` : "";
  return `Caixinha ${taxa}${venc}`;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const summary = {
    connections: 0,
    conta: 0,
    caixinhas: 0,
    expensesInserted: 0,
    errors: [] as string[],
  };

  const { data: classes } = await admin.from("asset_classes").select("id, slug");
  const classIdBySlug = Object.fromEntries((classes ?? []).map((c) => [c.slug, c.id]));
  const contaClassId = classIdBySlug["conta_corrente"];

  const { data: categories } = await admin.from("expense_categories").select("id, slug").is("household_id", null);
  const categoryIdBySlug = Object.fromEntries((categories ?? []).map((c) => [c.slug, c.id]));

  const { data: incomeCats } = await admin.from("income_categories").select("id, slug");
  const rendaFixaCatId = (incomeCats ?? []).find((c) => c.slug === "rendimento_renda_fixa")?.id;

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  // registra o rendimento novo de uma caixinha como receita: um lançamento
  // por caixinha por mês, somando os deltas de cada sincronização
  async function recordCaixinhaYield(userId: string, name: string, delta: number) {
    if (!rendaFixaCatId) return;
    const description = `${name} — rendimento`;
    const { data: existing } = await admin
      .from("incomes")
      .select("id, amount")
      .eq("user_id", userId)
      .eq("source", "nubank_caixinha")
      .eq("description", description)
      .gte("received_at", monthStart)
      .limit(1)
      .maybeSingle();
    if (existing) {
      await admin
        .from("incomes")
        .update({ amount: Number(existing.amount) + delta, received_at: today })
        .eq("id", existing.id);
    } else {
      await admin.from("incomes").insert({
        user_id: userId,
        income_category_id: rendaFixaCatId,
        amount: delta,
        description,
        received_at: today,
        source: "nubank_caixinha",
      });
    }
  }

  const { data: connections } = await admin
    .from("bank_connections")
    .select("id, user_id, item_id")
    .eq("provider", "pluggy");

  // pares de credenciais Pluggy: cada item só é visível para a aplicação que
  // o criou, então tentamos cada aplicação configurada até achar a dona.
  const apps = [
    { clientId: process.env.PLUGGY_CLIENT_ID!, clientSecret: process.env.PLUGGY_CLIENT_SECRET! },
    ...(process.env.PLUGGY_CLIENT_ID_2 && process.env.PLUGGY_CLIENT_SECRET_2
      ? [{ clientId: process.env.PLUGGY_CLIENT_ID_2, clientSecret: process.env.PLUGGY_CLIENT_SECRET_2 }]
      : []),
  ];
  const apiKeyCache = new Map<string, string>();
  async function apiKeyForItem(itemId: string): Promise<string | null> {
    for (const app of apps) {
      let key = apiKeyCache.get(app.clientId);
      if (!key) {
        key = await pluggyAuth(app.clientId, app.clientSecret);
        apiKeyCache.set(app.clientId, key);
      }
      if (await itemVisible(key, itemId)) return key;
    }
    return null;
  }

  for (const connection of connections ?? []) {
    summary.connections++;
    try {
      const apiKey = await apiKeyForItem(connection.item_id);
      if (!apiKey) {
        summary.errors.push(`item ${connection.item_id}: não visível em nenhuma aplicação`);
        continue;
      }

      // ---- conta corrente --------------------------------------------------
      const accounts = await fetchAccounts(apiKey, connection.item_id);
      for (const account of accounts.filter((a) => a.type === "BANK")) {
        const { data: existing } = await admin
          .from("assets")
          .select("id")
          .eq("user_id", connection.user_id)
          .eq("metadata->>pluggy_account_id", account.id)
          .limit(1)
          .maybeSingle();

        if (existing) {
          await admin
            .from("assets")
            .update({ quantity: account.balance })
            .eq("id", existing.id);
        } else {
          await admin.from("assets").insert({
            user_id: connection.user_id,
            asset_class_id: contaClassId,
            name: "Nubank — Conta",
            quantity: account.balance,
            metadata: {
              banco: "Nubank",
              tipo: "conta",
              rende_automaticamente: false,
              pluggy_account_id: account.id,
            },
          });
        }
        summary.conta++;
      }

      // ---- caixinhas (CDBs) ------------------------------------------------
      const investments = await fetchInvestments(apiKey, connection.item_id);
      const cdbs = investments.filter((i) => i.subtype === "CDB");
      for (const cdb of cdbs) {
        const { data: existing } = await admin
          .from("assets")
          .select("id, name, metadata")
          .eq("user_id", connection.user_id)
          .eq("metadata->>pluggy_id", cdb.id)
          .limit(1)
          .maybeSingle();

        // rendimento acumulado da caixinha (saldo - aplicado); o delta desde
        // a última sincronização vira receita em rendimento_renda_fixa
        const rendimentoTotal =
          cdb.amountOriginal != null && cdb.balance > 0
            ? Math.round((cdb.balance - cdb.amountOriginal) * 100) / 100
            : null;

        if (existing) {
          const prevMeta = existing.metadata as Record<string, unknown>;
          const name = existing.name ?? caixinhaLabel(cdb.rate, cdb.rateType, cdb.dueDate);
          const prevRendimento =
            typeof prevMeta.rendimento_registrado === "number"
              ? prevMeta.rendimento_registrado
              : null;

          if (rendimentoTotal != null && prevRendimento != null) {
            const delta = Math.round((rendimentoTotal - prevRendimento) * 100) / 100;
            if (delta >= 0.01) {
              await recordCaixinhaYield(connection.user_id, name, delta);
            }
          }

          // preserva o nome (o usuário pode ter renomeado a caixinha)
          const metadata = {
            ...prevMeta,
            taxa_cdi: cdb.rate,
            vencimento: cdb.dueDate?.slice(0, 10) ?? null,
            valor_aplicado: cdb.amountOriginal,
            // baseline: na primeira passada só registra, sem retroagir
            rendimento_registrado: rendimentoTotal ?? prevMeta.rendimento_registrado ?? null,
          };
          await admin
            .from("assets")
            .update({ quantity: cdb.balance, metadata })
            .eq("id", existing.id);
        } else if (cdb.balance > 0) {
          await admin.from("assets").insert({
            user_id: connection.user_id,
            asset_class_id: contaClassId,
            name: caixinhaLabel(cdb.rate, cdb.rateType, cdb.dueDate),
            quantity: cdb.balance,
            metadata: {
              banco: "Nubank",
              tipo: "caixinha",
              rende_automaticamente: true,
              taxa_cdi: cdb.rate,
              vencimento: cdb.dueDate?.slice(0, 10) ?? null,
              valor_aplicado: cdb.amountOriginal,
              pluggy_id: cdb.id,
              // caixinha nova entra com o rendimento atual como baseline
              rendimento_registrado: rendimentoTotal,
            },
          });
        }
        if (cdb.balance > 0) summary.caixinhas++;
      }

      // ---- despesas do cartão ---------------------------------------------
      const creditAccounts = accounts.filter((a) => a.type === "CREDIT");
      for (const card of creditAccounts) {
        const transactions = await fetchAllTransactions(apiKey, card.id);
        const spendable = transactions.filter(
          (t) =>
            t.type === "DEBIT" &&
            t.status === "POSTED" &&
            t.amount > 0 &&
            !/credit card payment/i.test(t.category ?? ""),
        );

        // pagina de 1000 em 1000 (teto de linhas por resposta do Supabase)
        const known = new Set<string>();
        for (let offset = 0; ; offset += 1000) {
          const { data: existingRows } = await admin
            .from("expenses")
            .select("external_id")
            .eq("user_id", connection.user_id)
            .eq("source", "pluggy")
            .not("external_id", "is", null)
            .range(offset, offset + 999);
          for (const row of existingRows ?? []) known.add(row.external_id);
          if (!existingRows || existingRows.length < 1000) break;
        }

        const newRows = spendable
          .filter((t) => !known.has(t.id))
          .map((t) => ({
            user_id: connection.user_id,
            expense_category_id:
              categoryIdBySlug[mapCategory(t.category)] ?? categoryIdBySlug["outros"],
            amount: t.amount,
            description: t.description,
            spent_at: t.date.slice(0, 10),
            source: "pluggy",
            external_id: t.id,
          }));

        for (let i = 0; i < newRows.length; i += 500) {
          const batch = newRows.slice(i, i + 500);
          const { error } = await admin.from("expenses").insert(batch);
          if (error) {
            summary.errors.push(`expenses: ${error.message}`);
            break;
          }
          summary.expensesInserted += batch.length;
        }
      }
    } catch (e) {
      summary.errors.push(
        `item ${connection.item_id}: ${e instanceof Error ? e.message : "erro"}`,
      );
    }
  }

  return NextResponse.json(summary);
}
