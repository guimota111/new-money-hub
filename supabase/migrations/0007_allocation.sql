-- Migração 0007 — Consultor de Alocação (entrega 1)
-- Rodar no SQL Editor do Supabase.
--
-- Categorias de alocação por usuário (com % alvo e subteto de ativos),
-- configurações do consultor (valor da reserva de emergência, teto global de
-- ativos, modo padrão) e o vínculo de cada ativo a uma categoria.
-- Referência: docs/consultor-alocacao.md.

create table public.allocation_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null,
  target_pct numeric(6, 2) not null default 0
    check (target_pct >= 0 and target_pct <= 100),
  max_assets integer check (max_assets is null or max_assets > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index allocation_categories_user_idx on public.allocation_categories (user_id);

create trigger allocation_categories_set_updated_at
  before update on public.allocation_categories
  for each row execute function public.set_updated_at();

create table public.allocation_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reserve_target_amount numeric(18, 2) not null default 0
    check (reserve_target_amount >= 0),
  max_total_assets integer not null default 30 check (max_total_assets > 0),
  default_mode text not null default 'standard'
    check (default_mode in ('standard', 'full')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger allocation_settings_set_updated_at
  before update on public.allocation_settings
  for each row execute function public.set_updated_at();

-- Vínculo por ativo. Categoria nula e allocation_excluded falso = ainda não
-- classificado (o consultor ignora e avisa). allocation_excluded = fora da
-- carteira de propósito (saldo livre, caixinha de consumo).
-- is_emergency_reserve marca os ativos que compõem a reserva de emergência;
-- eles continuam contando na categoria em que estão (normalmente Renda Fixa).
alter table public.assets
  add column if not exists allocation_category_id uuid
    references public.allocation_categories (id) on delete set null,
  add column if not exists is_emergency_reserve boolean not null default false,
  add column if not exists allocation_excluded boolean not null default false;

create index assets_allocation_category_idx on public.assets (allocation_category_id);

alter table public.allocation_categories enable row level security;
alter table public.allocation_settings enable row level security;

-- leitura também pelo parceiro do household (visão consolidada futura);
-- escrita só do dono
create policy "allocation_categories: select own or household partner" on public.allocation_categories
  for select using (public.is_household_partner(user_id));

create policy "allocation_categories: write own" on public.allocation_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "allocation_settings: select own or household partner" on public.allocation_settings
  for select using (public.is_household_partner(user_id));

create policy "allocation_settings: write own" on public.allocation_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
