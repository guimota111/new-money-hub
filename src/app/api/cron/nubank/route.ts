import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  pluggyAuth,
  itemVisible,
  fetchAccounts,
  fetchInvestments,
  fetchInvestmentTransactions,
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
    investPositions: 0,
    investTx: 0,
    contaIncomes: 0,
    contaExpenses: 0,
    errors: [] as string[],
  };

  // sync de investimentos e conta corrente depende dos external_id da
  // migração 0005 — sem eles, só o comportamento antigo roda
  let extIdReady = true;
  {
    const [{ error: probeMov }, { error: probeInc }] = await Promise.all([
      admin.from("movements").select("external_id").limit(1),
      admin.from("incomes").select("external_id").limit(1),
    ]);
    if (probeMov || probeInc) {
      extIdReady = false;
      summary.errors.push(
        "migração 0005 pendente — sync de investimentos e conta corrente pulado",
      );
    }
  }

  const { data: classes } = await admin.from("asset_classes").select("id, slug");
  const classIdBySlug = Object.fromEntries((classes ?? []).map((c) => [c.slug, c.id]));
  const contaClassId = classIdBySlug["conta_corrente"];

  const { data: categories } = await admin.from("expense_categories").select("id, slug").is("household_id", null);
  const categoryIdBySlug = Object.fromEntries((categories ?? []).map((c) => [c.slug, c.id]));

  const { data: incomeCats } = await admin.from("income_categories").select("id, slug");
  const incomeCatBySlug = Object.fromEntries((incomeCats ?? []).map((c) => [c.slug, c.id]));
  const rendaFixaCatId = incomeCatBySlug["rendimento_renda_fixa"];

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

      // ---- investimentos de mercado (ações/FIIs/Tesouro no Nubank) ---------
      // a custódia da Pluggy é a fonte da verdade da posição (+ offset fixo
      // do que vive em outras corretoras, baselinado no primeiro vínculo);
      // transações viram movements e proventos viram receitas, tudo dedupado
      // por external_id (migração 0005)
      if (extIdReady) {
        const marketInvs = investments.filter(
          (i) => (i.type === "EQUITY" || i.subtype === "TREASURY") && i.quantity != null,
        );

        const knownMovIds = new Set<string>();
        for (let offset = 0; ; offset += 1000) {
          const { data: rows } = await admin
            .from("movements")
            .select("external_id")
            .eq("user_id", connection.user_id)
            .not("external_id", "is", null)
            .range(offset, offset + 999);
          for (const r of rows ?? []) knownMovIds.add(r.external_id);
          if (!rows || rows.length < 1000) break;
        }
        const knownIncomeIds = new Set<string>();
        for (let offset = 0; ; offset += 1000) {
          const { data: rows } = await admin
            .from("incomes")
            .select("external_id")
            .eq("user_id", connection.user_id)
            .not("external_id", "is", null)
            .range(offset, offset + 999);
          for (const r of rows ?? []) knownIncomeIds.add(r.external_id);
          if (!rows || rows.length < 1000) break;
        }

        for (const inv of marketInvs) {
          const isTreasury = inv.subtype === "TREASURY";
          const ticker = isTreasury ? inv.name.trim() : (inv.code ?? "").trim();
          if (!ticker) continue;
          const classSlug = isTreasury ? "renda_fixa" : /11$/.test(ticker) ? "fiis" : "acoes";

          let txs: Awaited<ReturnType<typeof fetchInvestmentTransactions>> = [];
          try {
            txs = await fetchInvestmentTransactions(apiKey, inv.id);
          } catch {
            /* investimento sem transações disponíveis */
          }
          const newTxs = txs.filter((t) => t.id && t.date && !knownMovIds.has(t.id));

          const movRows = newTxs
            .filter((t) => ["BUY", "SELL", "INTEREST"].includes(t.type))
            .map((t) => ({
              user_id: connection.user_id,
              direction: t.type === "SELL" ? "debito" : "credito",
              movement_type:
                t.type === "BUY" ? "Compra" : t.type === "SELL" ? "Venda" : "Provento",
              ticker,
              product: inv.name,
              institution: "Nubank",
              quantity: t.quantity,
              unit_price: t.value,
              total_value: t.amount,
              moved_at: t.date.slice(0, 10),
              source: "pluggy",
              external_id: t.id,
            }));
          if (movRows.length > 0) {
            const { error } = await admin.from("movements").insert(movRows);
            if (error) summary.errors.push(`movements ${ticker}: ${error.message}`);
            else summary.investTx += movRows.length;
          }

          const provSlug = isTreasury
            ? "rendimento_renda_fixa"
            : /11$/.test(ticker)
              ? "rendimento_fii"
              : "dividendos";
          const provRows = newTxs
            .filter(
              (t) =>
                t.type === "INTEREST" &&
                t.amount != null &&
                t.amount > 0 &&
                !knownIncomeIds.has(t.id),
            )
            .map((t) => ({
              user_id: connection.user_id,
              income_category_id: incomeCatBySlug[provSlug],
              amount: Math.abs(Number(t.amount)),
              description: `${ticker} — Provento`,
              received_at: t.date.slice(0, 10),
              source: "pluggy",
              external_id: t.id,
            }));
          if (provRows.length > 0) {
            const { error } = await admin.from("incomes").insert(provRows);
            if (error) summary.errors.push(`proventos ${ticker}: ${error.message}`);
          }

          // ---- posição ------------------------------------------------------
          const { data: asset } = await admin
            .from("assets")
            .select("id, quantity, average_price, metadata")
            .eq("user_id", connection.user_id)
            .eq("name", ticker)
            .limit(1)
            .maybeSingle();

          const pluggyQty = Number(inv.quantity);
          if (asset) {
            const meta = { ...(asset.metadata as Record<string, unknown>) };
            if (meta.pluggy_investment_id == null) {
              // primeiro vínculo: o que exceder a custódia do Nubank vive em
              // outra corretora e vira offset fixo (ex: BBAS3 na XP)
              meta.pluggy_investment_id = inv.id;
              meta.qtd_fora_nubank =
                Math.round((Number(asset.quantity) - pluggyQty) * 1e8) / 1e8;
            }
            const outside = Number(meta.qtd_fora_nubank ?? 0);
            const targetQty = Math.round((pluggyQty + outside) * 1e8) / 1e8;

            // preço médio: incorpora compras novas ao custo já registrado
            let avg = asset.average_price != null ? Number(asset.average_price) : null;
            const buys = newTxs.filter(
              (t) => t.type === "BUY" && t.amount != null && t.quantity != null,
            );
            if (avg != null && buys.length > 0) {
              let q = Number(asset.quantity);
              let cost = q * avg;
              for (const b of buys) {
                q += Number(b.quantity);
                cost += Number(b.amount);
              }
              if (q > 0) avg = Math.round((cost / q) * 1e6) / 1e6;
            }

            await admin
              .from("assets")
              .update({ quantity: targetQty, average_price: avg, metadata: meta })
              .eq("id", asset.id);
            summary.investPositions++;
          } else if (pluggyQty > 0) {
            // posição nova comprada pelo Nubank
            const buys = txs.filter(
              (t) => t.type === "BUY" && t.amount != null && t.quantity != null,
            );
            const boughtQty = buys.reduce((s, b) => s + Number(b.quantity), 0);
            const boughtCost = buys.reduce((s, b) => s + Number(b.amount), 0);
            const avg =
              boughtQty > 0
                ? Math.round((boughtCost / boughtQty) * 1e6) / 1e6
                : inv.value != null
                  ? Number(inv.value)
                  : null;

            let instrumentId: string | null = null;
            const { data: inst } = isTreasury
              ? await admin
                  .from("market_instruments")
                  .select("id")
                  .eq("external_id", ticker)
                  .limit(1)
                  .maybeSingle()
              : await admin
                  .from("market_instruments")
                  .select("id")
                  .eq("ticker", ticker)
                  .limit(1)
                  .maybeSingle();
            instrumentId = inst?.id ?? null;
            if (!instrumentId) {
              const { data: created } = await admin
                .from("market_instruments")
                .insert(
                  isTreasury
                    ? {
                        asset_class_id: classIdBySlug["renda_fixa"],
                        external_id: ticker,
                        name: ticker,
                      }
                    : { asset_class_id: classIdBySlug[classSlug], ticker, name: ticker },
                )
                .select("id")
                .single();
              instrumentId = created?.id ?? null;
            }
            await admin.from("assets").insert({
              user_id: connection.user_id,
              asset_class_id: classIdBySlug[classSlug],
              instrument_id: instrumentId,
              name: ticker,
              quantity: pluggyQty,
              average_price: avg,
              metadata: {
                pluggy_investment_id: inv.id,
                qtd_fora_nubank: 0,
                ...(isTreasury ? { indexador: "ipca" } : {}),
              },
            });
            summary.investPositions++;
          }
        }
      }

      // ---- despesas do cartão ---------------------------------------------
      // regras do usuário ("aplicar sempre") têm prioridade sobre a
      // heurística de categoria da Pluggy; tabela pode não existir ainda
      const ruleByMatcher = new Map<string, string>();
      try {
        const { data: rules } = await admin
          .from("expense_category_rules")
          .select("matcher, expense_category_id")
          .eq("user_id", connection.user_id);
        for (const r of rules ?? []) ruleByMatcher.set(r.matcher, r.expense_category_id);
      } catch {
        /* migração 0004 pendente */
      }

      // ---- transações da conta corrente (salário, Pix, boletos) -----------
      // ignora o que não é receita/despesa real: pagamento de fatura (as
      // compras já entram pelo cartão), aplicações/resgates de caixinha e
      // investimentos (patrimônio mudando de bolso) e transferências entre
      // contas da própria pessoa
      if (extIdReady) {
        const IGNORE_ACCOUNT =
          /credit card|investment|application|redemption|savings|same person|pension/i;

        const knownExpIds = new Set<string>();
        for (let offset = 0; ; offset += 1000) {
          const { data: rows } = await admin
            .from("expenses")
            .select("external_id")
            .eq("user_id", connection.user_id)
            .not("external_id", "is", null)
            .range(offset, offset + 999);
          for (const r of rows ?? []) knownExpIds.add(r.external_id);
          if (!rows || rows.length < 1000) break;
        }
        const knownAccIncomeIds = new Set<string>();
        for (let offset = 0; ; offset += 1000) {
          const { data: rows } = await admin
            .from("incomes")
            .select("external_id")
            .eq("user_id", connection.user_id)
            .not("external_id", "is", null)
            .range(offset, offset + 999);
          for (const r of rows ?? []) knownAccIncomeIds.add(r.external_id);
          if (!rows || rows.length < 1000) break;
        }

        for (const account of accounts.filter((a) => a.type === "BANK")) {
          const txs = await fetchAllTransactions(apiKey, account.id);
          const posted = txs.filter(
            (t) => t.status === "POSTED" && !IGNORE_ACCOUNT.test(t.category ?? ""),
          );

          const creditRows = posted
            .filter((t) => t.type === "CREDIT" && t.amount !== 0 && !knownAccIncomeIds.has(t.id))
            .map((t) => ({
              user_id: connection.user_id,
              income_category_id: /salary/i.test(t.category ?? "")
                ? incomeCatBySlug["salario"]
                : incomeCatBySlug["outros"],
              amount: Math.abs(t.amount),
              description: t.description,
              received_at: t.date.slice(0, 10),
              source: "pluggy",
              external_id: t.id,
            }));
          for (let i = 0; i < creditRows.length; i += 500) {
            const batch = creditRows.slice(i, i + 500);
            const { error } = await admin.from("incomes").insert(batch);
            if (error) {
              summary.errors.push(`conta incomes: ${error.message}`);
              break;
            }
            summary.contaIncomes += batch.length;
          }

          const debitRows = posted
            .filter((t) => t.type === "DEBIT" && t.amount !== 0 && !knownExpIds.has(t.id))
            .map((t) => ({
              user_id: connection.user_id,
              expense_category_id:
                ruleByMatcher.get(t.description.trim().toLowerCase()) ??
                categoryIdBySlug[mapCategory(t.category)] ??
                categoryIdBySlug["outros"],
              amount: Math.abs(t.amount),
              description: t.description,
              spent_at: t.date.slice(0, 10),
              source: "pluggy",
              external_id: t.id,
            }));
          for (let i = 0; i < debitRows.length; i += 500) {
            const batch = debitRows.slice(i, i + 500);
            const { error } = await admin.from("expenses").insert(batch);
            if (error) {
              summary.errors.push(`conta expenses: ${error.message}`);
              break;
            }
            summary.contaExpenses += batch.length;
          }
        }
      }

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
              ruleByMatcher.get(t.description.trim().toLowerCase()) ??
              categoryIdBySlug[mapCategory(t.category)] ??
              categoryIdBySlug["outros"],
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
