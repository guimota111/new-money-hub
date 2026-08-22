-- Migração 0004 — regras de categorização de despesas
-- Rodar no SQL Editor do Supabase.
--
-- Quando o usuário recategoriza uma despesa e marca "aplicar sempre", a regra
-- fica aqui e o cron do Nubank passa a usá-la ao importar novas despesas com a
-- mesma descrição (match exato, case-insensitive via matcher em minúsculas).

create table public.expense_category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  matcher text not null,
  expense_category_id uuid not null references public.expense_categories (id),
  created_at timestamptz not null default now(),
  unique (user_id, matcher)
);

create index expense_category_rules_user_idx on public.expense_category_rules (user_id);

alter table public.expense_category_rules enable row level security;

create policy "expense_category_rules: select own" on public.expense_category_rules
  for select using (user_id = auth.uid());

create policy "expense_category_rules: write own" on public.expense_category_rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
