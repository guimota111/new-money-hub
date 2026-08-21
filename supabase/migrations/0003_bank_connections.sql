-- Migração 0003 — conexões bancárias (Pluggy/Open Finance) + dedup de despesas
-- Rodar no SQL Editor do Supabase.

-- =========================================================================
-- bank_connections — vincula um usuário a um item do Pluggy (um por banco)
-- =========================================================================

create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'pluggy',
  item_id text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (provider, item_id)
);

alter table public.bank_connections enable row level security;

create policy "bank_connections: select own" on public.bank_connections
  for select using (user_id = auth.uid());

create policy "bank_connections: write own" on public.bank_connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- expenses — origem e id externo para importação idempotente do cartão
-- =========================================================================

alter table public.expenses
  add column source text not null default 'manual';

alter table public.expenses
  add column external_id text;

create unique index expenses_user_external_idx
  on public.expenses (user_id, external_id)
  where external_id is not null;

create index expenses_source_idx on public.expenses (user_id, source);
