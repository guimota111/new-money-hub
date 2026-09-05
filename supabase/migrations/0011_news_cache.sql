-- Migração 0011 — cache de notícias (Consultor de Alocação, entrega 5)
-- Rodar no SQL Editor do Supabase.
--
-- Manchetes dos últimos 6 meses por ativo (Google News RSS e, se houver
-- chave, Brave News), com a classificação da IA (neutro / atenção /
-- preocupante recorrente) guardada junto para reaproveitar por 7 dias.
-- Leitura para autenticados; escrita só pelo servidor (service role).

create table public.news_cache (
  market text not null check (market in ('BR', 'US')),
  ticker text not null,
  items jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  verdict jsonb,
  verdict_at timestamptz,
  primary key (market, ticker)
);

create index news_cache_fetched_idx on public.news_cache (fetched_at);

alter table public.news_cache enable row level security;

create policy "news_cache: read all authenticated" on public.news_cache
  for select to authenticated using (true);
