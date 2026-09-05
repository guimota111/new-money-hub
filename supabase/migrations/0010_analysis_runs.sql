-- Migração 0010 — análises do Consultor de Alocação (entrega 4)
-- Rodar no SQL Editor do Supabase.
--
-- analysis_runs: uma rodada da análise. Roda em etapas (preparar, ranking por
-- categoria com IA, lista de compras, relatório); cada etapa é uma chamada do
-- cliente ao servidor, e o estado intermediário fica em `state`. Assim a
-- rodada sobrevive a fechar a aba e cabe no limite de tempo da função.
-- analysis_recommendations: cada sugestão individual, para a próxima rodada
-- saber o que foi acatado (entrega 6).

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'done', 'failed')),
  mode text not null default 'standard' check (mode in ('standard', 'full')),
  contribution_amount numeric(18, 2) not null default 0,
  fx_rate numeric(18, 6),
  step text not null default 'prepare',
  progress integer not null default 0,
  state jsonb not null default '{}'::jsonb,
  report jsonb,
  narrative text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  error text,
  step_started_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index analysis_runs_user_idx on public.analysis_runs (user_id, created_at desc);

create table public.analysis_recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.analysis_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null
    check (type in ('buy', 'reinforce', 'trim', 'sell', 'watch', 'substitute', 'alternative')),
  category_slug text,
  ticker text not null,
  market text not null check (market in ('BR', 'US')),
  quantity numeric(18, 6),
  amount_brl numeric(18, 2),
  price numeric(18, 6),
  currency text not null default 'BRL' check (currency in ('BRL', 'USD')),
  rationale text,
  status text not null default 'pending'
    check (status in ('pending', 'executed', 'partial', 'ignored')),
  status_source text not null default 'auto' check (status_source in ('auto', 'manual')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index analysis_recommendations_run_idx on public.analysis_recommendations (run_id);
create index analysis_recommendations_user_idx on public.analysis_recommendations (user_id, created_at desc);

alter table public.analysis_runs enable row level security;
alter table public.analysis_recommendations enable row level security;

create policy "analysis_runs: own" on public.analysis_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "analysis_recommendations: own" on public.analysis_recommendations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
