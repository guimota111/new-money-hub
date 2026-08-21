-- Migração 0002 — histórico de movimentações (import B3) + origem em incomes
-- Rodar no SQL Editor do Supabase.

-- =========================================================================
-- movements — histórico bruto de movimentações (extrato B3, sem interpretação)
-- =========================================================================

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  direction text not null check (direction in ('credito', 'debito')),
  movement_type text not null,   -- ex: 'Transferência - Liquidação', 'Dividendo'
  ticker text,                   -- ex: BBAS3, HGLG11, 'Tesouro IPCA+ 2032'
  product text not null,         -- descrição completa do produto no extrato
  institution text,
  quantity numeric(18, 8),
  unit_price numeric(18, 6),
  total_value numeric(18, 6),
  moved_at date not null,
  source text not null default 'b3_import',
  created_at timestamptz not null default now()
);

create index movements_user_date_idx on public.movements (user_id, moved_at desc);
create index movements_user_ticker_idx on public.movements (user_id, ticker);
create index movements_user_type_idx on public.movements (user_id, movement_type);

alter table public.movements enable row level security;

create policy "movements: select own or household partner" on public.movements
  for select using (public.is_household_partner(user_id));

create policy "movements: write own" on public.movements
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- incomes.source — distingue lançamento manual de importado (re-import
-- idempotente: apaga e regrava só o que veio de import)
-- =========================================================================

alter table public.incomes
  add column source text not null default 'manual';

create index incomes_source_idx on public.incomes (user_id, source);
