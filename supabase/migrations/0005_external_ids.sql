-- Migração 0005 — ids externos para sincronização automática (Pluggy)
-- Rodar no SQL Editor do Supabase.
--
-- O cron do Nubank passa a importar transações de investimento (compras,
-- vendas, proventos) e da conta corrente (salário, Pix). O id da transação na
-- Pluggy fica gravado para a importação ser idempotente, igual já acontece em
-- expenses.external_id.

alter table public.incomes
  add column external_id text;

create unique index incomes_user_external_idx
  on public.incomes (user_id, external_id)
  where external_id is not null;

alter table public.movements
  add column external_id text;

create unique index movements_user_external_idx
  on public.movements (user_id, external_id)
  where external_id is not null;
