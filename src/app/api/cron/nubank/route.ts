import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  pluggyAuth,
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

  const { data: connections } = await admin
    .from("bank_connections")
    .select("id, user_id, item_id")
    .eq("provider", "pluggy");

  let apiKey: string | null = null;
  for (const connection of connections ?? []) {
    summary.connections++;
    try {
      apiKey ??= await pluggyAuth(
        process.env.PLUGGY_CLIENT_ID!,
        process.env.PLUGGY_CLIENT_SECRET!,
      );

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
          .select("id, metadata")
          .eq("user_id", connection.user_id)
          .eq("metadata->>pluggy_id", cdb.id)
          .limit(1)
          .maybeSingle();

        if (existing) {
          // preserva o nome (o usuário pode ter renomeado a caixinha)
          const metadata = {
            ...(existing.metadata as Record<string, unknown>),
            taxa_cdi: cdb.rate,
            vencimento: cdb.dueDate?.slice(0, 10) ?? null,
            valor_aplicado: cdb.amountOriginal,
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

        const { data: existingRows } = await admin
          .from("expenses")
          .select("external_id")
          .eq("user_id", connection.user_id)
          .eq("source", "pluggy")
          .not("external_id", "is", null)
          .limit(20000);
        const known = new Set((existingRows ?? []).map((r) => r.external_id));

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
          const { error } = await admin.from("expenses").insert(newRows.slice(i, i + 500));
          if (error) {
            summary.errors.push(`expenses: ${error.message}`);
            break;
          }
        }
        summary.expensesInserted += newRows.length;
      }
    } catch (e) {
      summary.errors.push(
        `item ${connection.item_id}: ${e instanceof Error ? e.message : "erro"}`,
      );
    }
  }

  return NextResponse.json(summary);
}
