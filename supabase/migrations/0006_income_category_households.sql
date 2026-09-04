-- 0006: categorias de receita personalizadas por household.
-- income_categories ganha household_id (nulo = categoria padrão global) e
-- políticas de escrita para membros do household, espelhando expense_categories.

alter table public.income_categories
  add column if not exists household_id uuid references public.households (id) on delete cascade;

-- o slug deixa de ser globalmente único: cada household pode ter os seus
alter table public.income_categories
  drop constraint if exists income_categories_slug_key;
alter table public.income_categories
  add constraint income_categories_household_slug_key unique (household_id, slug);

drop policy if exists "income_categories: read all authenticated" on public.income_categories;

create policy "income_categories: select global or own household" on public.income_categories
  for select using (
    household_id is null or household_id in (select public.my_household_ids())
  );

create policy "income_categories: write own household" on public.income_categories
  for insert with check (household_id in (select public.my_household_ids()));

create policy "income_categories: update own household" on public.income_categories
  for update using (household_id in (select public.my_household_ids()));

create policy "income_categories: delete own household" on public.income_categories
  for delete using (household_id in (select public.my_household_ids()));
