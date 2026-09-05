-- Migração 0009 — cache de fundamentos (Consultor de Alocação, entrega 3)
-- Rodar no SQL Editor do Supabase.
--
-- fundamentals_cache guarda o payload bruto de cada fonte por ativo
-- (Fundamentus ações/FIIs/detalhe, lista da brapi, métricas da Finnhub). A
-- normalização acontece no código, então trocar de fonte não exige migração.
-- source_refresh registra quando cada fonte foi atualizada por último.
-- Leitura para autenticados; escrita só pelo servidor (service role).

create table public.fundamentals_cache (
  market text not null check (market in ('BR', 'US')),
  ticker text not null,
  source text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (market, ticker, source)
);

create index fundamentals_cache_source_idx on public.fundamentals_cache (source, fetched_at);

create table public.source_refresh (
  source text primary key,
  refreshed_at timestamptz not null default now(),
  item_count integer not null default 0,
  note text
);

alter table public.fundamentals_cache enable row level security;
alter table public.source_refresh enable row level security;

create policy "fundamentals_cache: read all authenticated" on public.fundamentals_cache
  for select to authenticated using (true);

create policy "source_refresh: read all authenticated" on public.source_refresh
  for select to authenticated using (true);
