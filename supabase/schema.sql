-- New Money Hub — schema inicial (Fase 1)
-- Rodar no SQL Editor do Supabase (ou via `supabase db push` depois de colocar
-- este arquivo em supabase/migrations/).

-- =========================================================================
-- 1. profiles — espelho de auth.users com dados exibíveis no app
-- =========================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- cria automaticamente um profile quando um usuário se cadastra
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- 2. households / household_members
-- =========================================================================

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create index household_members_user_id_idx on public.household_members (user_id);
create index household_members_household_id_idx on public.household_members (household_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- helper: household(s) do usuário autenticado
create function public.my_household_ids()
returns setof uuid
language sql
security definer set search_path = public
stable
as $$
  select household_id from public.household_members where user_id = auth.uid();
$$;

-- helper: `target_user_id` é o próprio usuário autenticado ou compartilha
-- um household com ele — usado para liberar leitura consolidada de casal.
create function public.is_household_partner(target_user_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select target_user_id = auth.uid()
    or exists (
      select 1
      from public.household_members hm
      where hm.user_id = target_user_id
        and hm.household_id in (select public.my_household_ids())
    );
$$;

create policy "profiles: select self or partner" on public.profiles
  for select using (public.is_household_partner(id));

create policy "profiles: update self" on public.profiles
  for update using (id = auth.uid());

create policy "households: select own" on public.households
  for select using (id in (select public.my_household_ids()));

create policy "households: insert own" on public.households
  for insert with check (true);

create policy "household_members: select own household" on public.household_members
  for select using (household_id in (select public.my_household_ids()));

create policy "household_members: insert self or as existing member" on public.household_members
  for insert with check (
    user_id = auth.uid() or household_id in (select public.my_household_ids())
  );

create policy "household_members: delete own membership" on public.household_members
  for delete using (user_id = auth.uid());

-- usado no onboarding (vínculo direto) para achar o user_id do parceiro a
-- partir do e-mail dele, sem expor a tabela auth.users diretamente.
create function public.find_user_id_by_email(target_email text)
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select id from auth.users where email = target_email;
$$;

revoke all on function public.find_user_id_by_email(text) from public;
grant execute on function public.find_user_id_by_email(text) to authenticated;

-- =========================================================================
-- 3. Referência de mercado (sem user_id — dado compartilhado)
-- =========================================================================

create table public.asset_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
);

insert into public.asset_classes (name, slug) values
  ('Renda Fixa', 'renda_fixa'),
  ('Conta Corrente', 'conta_corrente'),
  ('Ações', 'acoes'),
  ('Fundos Imobiliários', 'fiis'),
  ('Bitcoin', 'bitcoin');

create table public.market_instruments (
  id uuid primary key default gen_random_uuid(),
  asset_class_id uuid not null references public.asset_classes (id),
  ticker text,
  external_id text,
  name text not null,
  current_price numeric(18, 6),
  current_price_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (asset_class_id, ticker, external_id)
);

create index market_instruments_asset_class_idx on public.market_instruments (asset_class_id);

create table public.instrument_price_history (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.market_instruments (id) on delete cascade,
  price numeric(18, 6) not null,
  source text not null,
  fetched_at timestamptz not null default now()
);

create index instrument_price_history_instrument_idx
  on public.instrument_price_history (instrument_id, fetched_at desc);

alter table public.asset_classes enable row level security;
alter table public.market_instruments enable row level security;
alter table public.instrument_price_history enable row level security;

-- dado de mercado é público para qualquer usuário autenticado; escrita só
-- via service role (cron jobs), que já ignora RLS — por isso não há policy
-- de insert/update aqui.
create policy "asset_classes: read all authenticated" on public.asset_classes
  for select using (auth.role() = 'authenticated');

create policy "market_instruments: read all authenticated" on public.market_instruments
  for select using (auth.role() = 'authenticated');

create policy "instrument_price_history: read all authenticated" on public.instrument_price_history
  for select using (auth.role() = 'authenticated');

-- =========================================================================
-- 4. assets — posições individuais
-- =========================================================================

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_class_id uuid not null references public.asset_classes (id),
  instrument_id uuid references public.market_instruments (id),
  name text not null,
  quantity numeric(18, 8) not null default 0,
  average_price numeric(18, 6),
  purchase_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assets_user_id_idx on public.assets (user_id);
create index assets_instrument_id_idx on public.assets (instrument_id);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

create table public.asset_snapshots (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  total_value numeric(18, 6) not null,
  snapshot_date date not null,
  created_at timestamptz not null default now(),
  unique (asset_id, snapshot_date)
);

create index asset_snapshots_asset_id_idx on public.asset_snapshots (asset_id, snapshot_date desc);

alter table public.assets enable row level security;
alter table public.asset_snapshots enable row level security;

create policy "assets: select own or household partner" on public.assets
  for select using (public.is_household_partner(user_id));

create policy "assets: insert own" on public.assets
  for insert with check (user_id = auth.uid());

create policy "assets: update own" on public.assets
  for update using (user_id = auth.uid());

create policy "assets: delete own" on public.assets
  for delete using (user_id = auth.uid());

create policy "asset_snapshots: select own or household partner" on public.asset_snapshots
  for select using (
    exists (
      select 1 from public.assets a
      where a.id = asset_snapshots.asset_id
        and public.is_household_partner(a.user_id)
    )
  );

create policy "asset_snapshots: write own" on public.asset_snapshots
  for all using (
    exists (
      select 1 from public.assets a
      where a.id = asset_snapshots.asset_id and a.user_id = auth.uid()
    )
  );

-- =========================================================================
-- 5. Receitas
-- =========================================================================

create table public.income_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
);

insert into public.income_categories (name, slug) values
  ('Salário', 'salario'),
  ('Dividendos', 'dividendos'),
  ('JCP', 'jcp'),
  ('Rendimento de FII', 'rendimento_fii'),
  ('Rendimento de Renda Fixa', 'rendimento_renda_fixa'),
  ('Outros', 'outros');

create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete set null,
  income_category_id uuid not null references public.income_categories (id),
  amount numeric(18, 6) not null,
  description text,
  received_at date not null,
  created_at timestamptz not null default now()
);

create index incomes_user_id_idx on public.incomes (user_id, received_at desc);
create index incomes_asset_id_idx on public.incomes (asset_id);

alter table public.income_categories enable row level security;
alter table public.incomes enable row level security;

create policy "income_categories: read all authenticated" on public.income_categories
  for select using (auth.role() = 'authenticated');

create policy "incomes: select own or household partner" on public.incomes
  for select using (public.is_household_partner(user_id));

create policy "incomes: write own" on public.incomes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- 6. Despesas
-- =========================================================================

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households (id) on delete cascade,
  name text not null,
  slug text not null,
  icon text,
  unique (household_id, slug)
);

insert into public.expense_categories (household_id, name, slug, icon) values
  (null, 'Moradia', 'moradia', 'home'),
  (null, 'Alimentação', 'alimentacao', 'utensils'),
  (null, 'Transporte', 'transporte', 'car'),
  (null, 'Lazer', 'lazer', 'party-popper'),
  (null, 'Saúde', 'saude', 'heart-pulse'),
  (null, 'Educação', 'educacao', 'graduation-cap'),
  (null, 'Assinaturas', 'assinaturas', 'credit-card'),
  (null, 'Outros', 'outros', 'more-horizontal');

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expense_category_id uuid not null references public.expense_categories (id),
  amount numeric(18, 6) not null,
  description text,
  spent_at date not null,
  created_at timestamptz not null default now()
);

create index expenses_user_id_idx on public.expenses (user_id, spent_at desc);

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;

create policy "expense_categories: select global or own household" on public.expense_categories
  for select using (
    household_id is null or household_id in (select public.my_household_ids())
  );

create policy "expense_categories: write own household" on public.expense_categories
  for insert with check (household_id in (select public.my_household_ids()));

create policy "expense_categories: update own household" on public.expense_categories
  for update using (household_id in (select public.my_household_ids()));

create policy "expense_categories: delete own household" on public.expense_categories
  for delete using (household_id in (select public.my_household_ids()));

create policy "expenses: select own or household partner" on public.expenses
  for select using (public.is_household_partner(user_id));

create policy "expenses: write own" on public.expenses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
