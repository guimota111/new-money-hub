-- Migração 0008 — Bolsa americana, câmbio e cripto (Consultor de Alocação, entrega 2)
-- Rodar no SQL Editor do Supabase.
--
-- 1) Nova classe "Bolsa americana": ativos negociados nos EUA, em dólar (Avenue).
--    Se a exposição é EUA ou Internacional é decidido na categoria do consultor,
--    não na classe.
-- 2) A classe Bitcoin vira Criptomoedas (BTC e ETH); o slug muda de bitcoin
--    para cripto. O código aceita os dois até esta migração rodar.
-- 3) market_instruments ganha moeda e preço nativo. current_price continua
--    sempre em BRL (é o que alimenta valor da posição e snapshots).
-- 4) fx_rates guarda a última PTAX (USDBRL), atualizada pelo cron de preços.

insert into public.asset_classes (name, slug)
values ('Bolsa americana', 'bolsa_eua')
on conflict (slug) do nothing;

update public.asset_classes
set name = 'Criptomoedas', slug = 'cripto'
where slug = 'bitcoin';

alter table public.market_instruments
  add column if not exists currency text not null default 'BRL'
    check (currency in ('BRL', 'USD')),
  add column if not exists current_price_native numeric(18, 6);

create table public.fx_rates (
  pair text primary key,
  rate numeric(18, 6) not null check (rate > 0),
  rate_date date,
  source text not null,
  fetched_at timestamptz not null default now()
);

alter table public.fx_rates enable row level security;

-- leitura para qualquer autenticado; escrita só pelo cron (service role)
create policy "fx_rates: read all authenticated" on public.fx_rates
  for select to authenticated using (true);
