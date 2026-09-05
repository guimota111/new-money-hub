# Consultor de Alocação — especificação (rascunho v0.3)

Status: spec fechada em 2026-09-05 (rodadas 1 e 2 respondidas; fonte de fundamentos BR decidida: Fundamentus agora, CVM depois). Implementação em andamento, ver seção 9.
Uso pessoal (dono + Lara). Não vai virar SaaS, então não há preocupação regulatória (CVM).

## 1. Objetivo

Botão "Analisar carteira" que, dado um valor de aporte informado pelo usuário, roda sob demanda:

1. Auditoria da carteira atual: o que não faz mais sentido nela (quebra de tese ou preço muito esticado).
2. Nível 1 — alocação: desvio de cada categoria vs meta, tudo em reais na cotação do momento.
3. Nível 2 — seleção: para as categorias em déficit, varredura do mercado (B3 e bolsas americanas) com filtro fundamentalista e escolha feita pela IA.
4. Relatório com estado das caixas vs meta, lista de compras com valor e quantidade aproximada (mais de uma opção por categoria, com justificativa), e alertas de poda/realocação.

O usuário delega o stock picking à IA. A compra final é sempre decisão dele; o sistema nunca executa ordens.

## 2. Decisões fechadas (rodadas 1 e 2)

| Tema | Decisão |
|---|---|
| Vínculo ativo → categoria | Manual, por ativo. Tela única de "arrume sua carteira" com sugestão automática para aprovar na migração. |
| Saldo livre da conta corrente | Fora da carteira (dinheiro de consumo). |
| Caixa de Oportunidade | Removida. A folga fica dentro do valor estipulado para a Reserva de Emergência. |
| Reserva de Emergência | Meta em valor fixo (R$), ajustável, **dentro** do % de Renda Fixa. Prioridade automática se abaixo do valor. Excedente da reserva não conta como dinheiro de aporte: o usuário informa o aporte. |
| Classificação BDR / ETF / ADR | Pela exposição econômica. IVVB11 e BDR de Apple são Ações EUA; BOVA11 é Ações BR; ETF ou ADR de mercado fora dos EUA é Internacional. ETFs contam como "ações" dentro da categoria. |
| Universo | Ativos listados na B3 e nas bolsas americanas (corretora Avenue, permite fração). |
| Cripto | Só BTC e ETH. Categoria só de alocação, sem filtro fundamentalista. |
| Categorias | Editáveis pelo usuário (criar novas). Categoria com meta 0% some do relatório. |
| Escopo | Individual. Metas e análise por usuário, não por household. |
| Câmbio | Metas em reais; desvio causado por câmbio é real e desejado. |
| Rebalanceamento | Principalmente por aporte. Venda em dois casos: quebra de tese (poda) ou preço muito alto com realocação para categoria em déficit. Venda parcial permitida. Sem prazo mínimo de posse e sem limite de giro por rodada. |
| Teto de ativos | Global + subtetos por categoria, ajustáveis. Defaults: 12 ações BR, 8 FIIs, 10 ações EUA, 3 internacional, global 30. Tesouro conta como 1. |
| Quem sai no teto | IA decide: pior nota fundamentalista ou preço alto (realizar lucro), com justificativa. |
| Limiares fundamentalistas | Não são números fixos no código. A IA julga com os dados, considerando setor (bancos, seguradoras, elétricas) e tipo (FII tem critérios próprios: P/VP, DY, vacância, alavancagem, liquidez). |
| Ações EUA sem lucro | IA pode recomendar empresa de crescimento sem lucro consistente, mas o relatório destaca isso. |
| Pesos dentro da categoria | IA define (ela sugere a "melhor carteira", pesos incluídos). |
| Preço de entrada | Importa muito, para compra e venda. Reforço de posição existente acima do preço médio é permitido se a IA ainda vê oportunidade. |
| Poda | Só por fundamentos e notícias, nunca por queda de preço isolada. Posição no vermelho por anos é aceitável se a tese continua. |
| Histerese de alerta | Não há. Alerta reaparece se na nova consulta a IA ainda o considerar relevante. |
| Frequência | Só sob demanda (botão). Sem cron. |
| Modos | Dois. Padrão: seleção só nas categorias em déficit, notícias só das posições atuais. Completo: seleção em todas as categorias, notícias de posições e finalistas. |
| Papel da IA | Filtros e contas determinísticos em código; IA para julgamento (ranking, notícias, narrativa). |
| Modelo | `claude-opus-5` nas etapas de seleção e auditoria; `claude-sonnet-5` na classificação de notícias e no relatório final. |
| Notícias | Google News RSS + Brave News API. Tavily e Serper descartados. |
| Orçamento por rodada | ~R$ 5 em chamadas de IA. |
| Execução | Job em background com barra de progresso, Vercel Workflows no plano Hobby (custo zero). |
| Cache | Fundamentos 30 dias, notícias 7 dias. |
| Histórico | Cada análise é guardada e entra como insumo da próxima. Detecção de recomendações acatadas é automática (diferença de posições entre rodadas), com correção manual. |
| Input | Um valor único de aporte por rodada. |
| Lotes e execução | O sistema recomenda valor em R$ e quantidade aproximada. Não trata lote, fracionário ou câmbio operacional: o usuário executa. |
| Impostos | O relatório avisa o efeito tributário de cada venda (isenção de R$ 20 mil/mês em ações, 20% em FII, custos de câmbio nos EUA), mas não rastreia vendas do mês. O usuário toma esse cuidado. |
| Renda Fixa pura | O consultor indica só o valor a aportar na categoria. Não escolhe título; o usuário compra Tesouro IPCA+ por preferência. |
| brapi | Usuário não vai assinar o plano Pro. Ver seção 5. |

## 3. Modelo de carteira

### Categorias

Cada usuário tem seu conjunto de categorias. Defaults criados no onboarding do módulo (todos editáveis):

| Categoria | Tipo de meta | Default | Seleção de ativos | Subteto default |
|---|---|---|---|---|
| Renda Fixa | % da carteira | 30% | não; contém a Reserva (valor fixo) e o restante é RF pura | — |
| Ações Brasileiras | % | 30% | sim, IA (inclui ETFs de mercado BR) | 12 |
| Fundos Imobiliários | % | 15% | sim, IA (critérios de FII) | 8 |
| Ações Americanas | % | 15% | sim, IA (inclui ETFs de mercado EUA e BDRs) | 10 |
| Internacional (fora EUA) | % | 7% | sim, IA (ETFs e ADRs de mercados fora dos EUA) | 3 |
| Criptomoedas | % | 3% | não (BTC/ETH fixos, só alocação) | — |

Os defaults ficam dentro das faixas do briefing (RF 25–30, BR 25–30, FIIs 10–15, EUA 10–15, internacional 5–10, cripto 2–5) e somam 100. Os pontos médios das faixas somariam só 88, por isso não servem como default.

"Carteira" = patrimônio total menos saldo livre de conta corrente. Os percentuais somam 100% sobre a carteira. A Reserva de Emergência é um valor fixo em R$ dentro de Renda Fixa: `meta_RF_pura = pct_RF * carteira - reserva_alvo`.

### Vínculo ativo → categoria

Coluna `allocation_category_id` em `assets` (nullable) e flag `is_emergency_reserve` para os ativos que compõem a reserva (caixinhas Nubank marcadas, Tesouro Selic etc.). Ativo sem categoria aparece no relatório como "não classificado" e é ignorado nas contas até ser classificado. Caixinhas não marcadas e saldo livre ficam fora.

### Contagem no teto

Cada ticker de ação, FII, ETF, BDR e ADR conta 1. Tesouro conta 1 (a classe inteira). BTC e ETH contam 1 cada. Reserva e conta corrente não contam.

## 4. Regras de decisão

### Nível 1 — alocação

Para cada categoria: `valor_atual`, `valor_alvo = pct * carteira_pos_aporte`, `gap = alvo - atual`. Reserva: `gap = alvo_fixo - atual`.

Ordem de prioridade do aporte:
1. Reserva, se abaixo do valor fixo (recebe até completar).
2. Demais categorias por desvio relativo `gap / alvo`, maior primeiro.

Categoria acima da meta não recebe aporte e não gera venda por si só.

### Nível 2 — seleção

Só para categorias que recebem aporte nesta rodada (Modo Padrão) ou todas (Modo Completo).

Pipeline por categoria:
1. Universo (código): lista de candidatos da fonte de dados, filtrada por liquidez e tamanho.
2. Pré-filtro (código): remove quem não tem dados suficientes, patrimônio líquido negativo, ou liquidez abaixo do mínimo. Objetivo é reduzir para 40–80 nomes por categoria, não decidir.
3. Ranking (IA, Opus 5): recebe tabela compacta com indicadores normalizados dos candidatos + posições atuais na categoria + resumo do relatório anterior. Devolve ordem, pesos sugeridos, justificativa, e para cada finalista se é "compra nova", "reforço" ou "não".
4. Notícias (código + IA, Sonnet 5): busca dos últimos 6 meses para posições atuais (e finalistas no Modo Completo); IA classifica em neutro / atenção / preocupante recorrente.
5. Lista de compras (código): converte pesos em valor em R$ e quantidade aproximada na cotação do momento (câmbio PTAX para EUA), respeitando o teto de ativos. Gera pelo menos 2 opções por categoria.
6. Relatório (IA, Sonnet 5): narrativa em português sobre os números já fechados, com avisos tributários por venda sugerida. A IA não altera quantidades nessa etapa.

### Venda e poda

Dois gatilhos, sempre com justificativa:

- Quebra de tese: endividamento subiu muito (em relação ao momento da compra), lucro deixou de ser consistente, ou notícias preocupantes recorrentes. Nunca por preço.
- Preço esticado: valuation muito acima do próprio histórico e dos pares, E existe destino em déficit que passa nos critérios. Sem destino, só registra "observação". Venda pode ser parcial.

O teto estourado é resolvido preferencialmente por substituição (vende quem tem pior nota ou preço mais esticado, compra o novo).

### Histórico e memória

Cada rodada salva o relatório e as recomendações individuais. Na rodada seguinte:
- Código compara posições atuais com as recomendações anteriores e marca cada uma como `executada`, `parcial`, `ignorada` (o usuário pode corrigir manualmente).
- Resumo do relatório anterior + status das recomendações entram no prompt como contexto.

## 5. Fontes de dados

### brapi — o que o plano grátis realmente entrega (testado em 2026-09-05 com o token do projeto)

A página de preços diz que o grátis tem "fundamentos anuais". Na prática isso vale só para os 4 tickers de demonstração (PETR4, VALE3, ITUB4, MGLU3), que devolvem tudo sem restrição. Para qualquer outro ticker:

| Recurso | Grátis | Startup (R$ 99,99–119,99/mês) | Pro (R$ 116,66–139,99/mês) |
|---|---|---|---|
| Cotação, variação, volume, mín/máx 52 sem | sim | sim | sim |
| `marketCap`, `priceEarnings`, `earningsPerShare` na cotação | **null** | ? | sim |
| `summaryProfile` (setor, indústria, descrição) | sim | sim | sim |
| Dividendos e JCP | não | sim (1 ano) | sim (10+ anos) |
| `balanceSheetHistory`, `incomeStatementHistory` (anuais) | não | sim (5 anos) | sim (desde 2009) |
| `defaultKeyStatistics`, `financialData` (P/VP, ROE, dívida/PL, margens, crescimento) | não | **não** | sim |
| Demonstrativos trimestrais, `cashflowHistory` | não | não | sim |
| `fundIndicators` (FII: P/VP, DY, vacância) | não | não | sim |
| Histórico de preço | 3 meses | 1 ano | máximo |
| Tickers por chamada | 1 | 10 | 20 |
| Câmbio USD-BRL | não | sim | sim |
| Tesouro Direto | não | não | sim (o app já usa o CSV do Tesouro Transparente, então não depende disso) |
| `/api/quote/list` (universo B3 com setor, tipo, subtipo `fii`/`etf`, volume) | sim | sim | sim |
| Cota mensal | 15 mil | 150 mil | 500 mil |

Conclusão: sem plano pago, a brapi serve para universo e cotação, mais nada. O Startup não resolve porque deixa de fora justamente os indicadores prontos e os dados de FII.

### Alternativas gratuitas para fundamentos BR (verificadas)

| Fonte | O que dá | Limitações |
|---|---|---|
| **Fundamentus** `resultado.php` | Uma página HTML com ~990 ações e 22 colunas: P/L, P/VP, PSR, DY, P/EBIT, EV/EBIT, EV/EBITDA, margens, liq. corrente, ROIC, ROE, liquidez 2 meses, patrimônio líquido, **dív. líq./patrimônio**, cresc. receita 5 anos. | Só a foto atual (12 meses). Sem histórico de lucro por ano. HTML em latin1, sem API, pode mudar de layout. Sem termos de uso claros para uso automatizado. |
| **Fundamentus** `fii_resultado.php` | ~560 FIIs com segmento, FFO yield, DY, P/VP, valor de mercado, liquidez, qtd. imóveis, cap rate, **vacância média**. | Mesmas ressalvas. Para FII é a melhor fonte gratuita encontrada; a brapi só tem isso no Pro. |
| **Fundamentus** `detalhes.php?papel=X` e `proventos.php` | 58 campos por empresa (balanço e DRE dos últimos 12 meses e 3 meses, nº de ações, setor) e histórico completo de proventos com data e tipo. | 1 requisição por ticker; usar só para os finalistas. |
| **CVM Dados Abertos** (`dados.cvm.gov.br`, datasets DFP e ITR) | Demonstrativos oficiais anuais (DFP) e trimestrais (ITR) de todas as companhias abertas, CSV em ZIP por ano, desde 2010/2011, atualização semanal, licença aberta, sem autenticação. É a fonte oficial e robusta para "lucro consistente por N anos" e evolução do endividamento. | Pipeline de ingestão: baixar ZIPs, parsear DRE/BPA/BPP, mapear CNPJ → ticker, guardar no Postgres. Trabalho de engenharia maior (estimativa: 1 entrega dedicada) e um cron mensal. |

Recomendação com custo zero na brapi:
1. Universo e cotações: brapi grátis (já integrado).
2. Screening de ações e FIIs: Fundamentus, duas requisições por rodada, cache de 7 dias. Cobre todos os critérios de foto atual, inclusive vacância de FII.
3. Detalhe dos finalistas e das posições atuais: Fundamentus `detalhes.php` + `proventos.php`, cache 30 dias.
4. Histórico plurianual de lucro e dívida (para poda e "lucro perene"): CVM DFP/ITR, entrega separada. Até ela existir, a IA julga consistência com o que há: ROE, margens, cresc. receita 5 anos e histórico de proventos.

Risco aceito: Fundamentus é scraping. Se o site mudar ou bloquear, o módulo degrada para "só alocação" até ajustar o parser ou migrar para CVM.

### Demais fontes

| Necessidade | Fonte | Custo |
|---|---|---|
| Cotações e fundamentos EUA | Finnhub grátis: 60 chamadas/min, cotações, notícias por empresa, métricas básicas (P/E, dívida/PL, margens, crescimento). Confirmar na doc oficial o conteúdo exato do grátis ao criar a conta. | R$ 0 |
| Constituintes S&P 500 | lista estática versionada no repo, atualizada trimestralmente | R$ 0 |
| Câmbio USD/BRL | Banco Central, PTAX (`olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1`), sem chave. Testado: 5,1247 / 5,1253 em 2026-09-04. | R$ 0 |
| Notícias | Google News RSS (PT-BR e EN, sem chave) + Brave News API (US$ 5 por mil consultas, US$ 5/mês de crédito grátis) | ~R$ 0 |
| Tesouro Direto | CSV do Tesouro Transparente (já em uso no cron) | R$ 0 |

Camada de normalização: um tipo interno `Fundamentals` (moeda, receita, lucro, PL, dívida líquida, P/L, P/VP, DY, margem, ROE, crescimento, e para FII: segmento, vacância, cap rate, FFO yield) preenchido por adaptadores `fundamentus`, `finnhub` e, depois, `cvm`.

## 6. IA — modelo e custo

Modelos: `claude-opus-5` (US$ 5 / US$ 25 por milhão de tokens) na auditoria e nos rankings; `claude-sonnet-5` (US$ 2 / US$ 10) em notícias e relatório. Adaptive thinking em ambos.

Estimativa por rodada em Modo Completo, câmbio 5,13 (PTAX 2026-09-04). Tokens estimados, a medir nas primeiras rodadas:

| Etapa | Modelo | Entrada | Saída | Custo |
|---|---|---|---|---|
| Auditoria + ranking Ações BR | Opus 5 | ~17k | ~8k | US$ 0,29 |
| Ranking FIIs | Opus 5 | ~10k | ~5k | US$ 0,18 |
| Ranking Ações EUA + Internacional | Opus 5 | ~15k | ~6k | US$ 0,23 |
| Classificação de notícias (~25 ativos) | Sonnet 5 | ~30k | ~4k | US$ 0,10 |
| Relatório final | Sonnet 5 | ~15k | ~6k | US$ 0,09 |
| **Total** | | | | **~US$ 0,89 ≈ R$ 4,5** |

Modo Padrão fica em torno de metade. Prompt caching no system prompt e nas tabelas de candidatos reduz um pouco mais. Registrar `tokens_in`, `tokens_out` e `cost_usd` por rodada para calibrar.

## 7. Execução e infraestrutura

- Vercel Hobby: cada função até 300 s com Fluid compute. A rodada completa pode passar disso.
- Vercel Workflows (`workflow` SDK, diretivas `'use workflow'` / `'use step'`) está disponível no Hobby: 50 mil eventos/mês e 1 GB gravado incluídos, duração de run ilimitada, cada step limitado ao tempo da função. Retenção de 1 dia no Hobby. Streams do SDK alimentam a barra de progresso.
- Alternativa sem dependência nova, se o Workflows der problema: tabela `analysis_runs` com `status` e `step`, rota que executa um step por invocação e o cliente faz polling e dispara o próximo.
- Estado e resultado final ficam no Supabase de qualquer forma.
- Fundamentos e notícias em cache no Postgres (`fundamentals_cache`, `news_cache`).

## 8. Modelo de dados

Migrações são arquivos que o usuário cola no SQL editor do Supabase; o código deve tolerar migração pendente.

Implementado na migração 0007 (`supabase/migrations/0007_allocation.sql`):

```
allocation_categories
  id, user_id, name, slug, target_pct numeric(6,2), max_assets int null, sort_order,
  created_at, updated_at — unique (user_id, slug)

allocation_settings (1 por usuário)
  user_id pk, reserve_target_amount numeric, max_total_assets int default 30,
  default_mode ('standard' | 'full'), created_at, updated_at

assets
  + allocation_category_id uuid null references allocation_categories (on delete set null)
  + is_emergency_reserve boolean default false   -- compõe a reserva; conta na categoria, não no teto
  + allocation_excluded boolean default false    -- fora da carteira de propósito (saldo livre, caixinha de consumo)
```

Categoria nula com `allocation_excluded = false` significa "ainda não classificado": o consultor ignora o ativo e avisa.

Implementado na migração 0008 (`supabase/migrations/0008_bolsa_eua_fx_cripto.sql`):

```
asset_classes
  + ('Bolsa americana', 'bolsa_eua')          -- negociado nos EUA, em US$
  'bitcoin' → ('Criptomoedas', 'cripto')      -- BTC e ETH

market_instruments
  + currency text default 'BRL' ('BRL' | 'USD')
  + current_price_native numeric             -- preço na moeda do ativo; current_price segue em BRL

fx_rates
  pair pk ('USDBRL'), rate, rate_date, source ('bcb_ptax'), fetched_at  -- leitura p/ autenticados, escrita pelo cron
```

Implementado na migração 0009 (`supabase/migrations/0009_fundamentals_cache.sql`):

```
fundamentals_cache
  market ('BR' | 'US'), ticker, source, payload jsonb, fetched_at — pk (market, ticker, source)
  fontes: fundamentus_stock, fundamentus_fii, fundamentus_details, brapi_stock, brapi_fund, finnhub_metric

source_refresh
  source pk, refreshed_at, item_count, note
```

Implementado na migração 0010 (`supabase/migrations/0010_analysis_runs.sql`):

```
analysis_runs
  id, user_id, status ('running' | 'done' | 'failed'), mode, contribution_amount, fx_rate,
  step, progress, state jsonb (plan, done, prepared, rankings, shopping, narrative, usage),
  report jsonb, narrative, tokens_in, tokens_out, cost_usd, error, step_started_at, created_at, finished_at

analysis_recommendations
  id, run_id, user_id, type ('buy' | 'reinforce' | 'trim' | 'sell' | 'watch' | 'substitute' | 'alternative'),
  category_slug, ticker, market, quantity, amount_brl, price, currency, rationale,
  status ('pending' | 'executed' | 'partial' | 'ignored'), status_source ('auto' | 'manual'), created_at, resolved_at
```

Implementado na migração 0011 (`supabase/migrations/0011_news_cache.sql`):

```
news_cache
  market, ticker, items jsonb (manchetes), fetched_at, verdict jsonb, verdict_at — pk (market, ticker)
```

Pendente (entrega 7): tabelas da ingestão CVM (DFP/ITR) para histórico plurianual de lucro e dívida.

RLS igual às demais tabelas: `user_id = auth.uid()`. Caches são leitura pública para autenticados, como `market_instruments`.

Cron de preços passa a buscar cotações EUA (Finnhub) e PTAX diária.

## 9. Entregas incrementais

1. **Feita (2026-09-05).** Categorias, metas, reserva, subtetos, vínculo ativo → categoria, tela "arrume sua carteira". Nível 1 puro (sem IA): relatório de desvios e ordem de prioridade do aporte.
   - Rotas: `/consultor` (relatório + botão "Analisar carteira"), `/consultor/categorias` (metas, reserva, tetos), `/consultor/classificar` (classificação com sugestão automática).
   - Código: `src/lib/allocation.ts` (regras puras: `computeAllocation`, `suggestAllocation`, contagem no teto), `src/lib/allocation-data.ts` (carga), `src/app/consultor/*`.
   - Depende da migração 0007. Sem ela as páginas mostram o aviso e nada quebra.
2. **Feita (2026-09-05).** Cotações EUA + PTAX no cron; novas classes de ativo.
   - Migração 0008: classe `bolsa_eua` ("Bolsa americana", ativos em US$ via Avenue), classe `bitcoin` renomeada para `cripto` ("Criptomoedas", BTC e ETH), colunas `currency` e `current_price_native` em `market_instruments`, tabela `fx_rates` com a última PTAX.
   - Decisão: uma classe só para tudo que é negociado nos EUA. Se a exposição é EUA ou Internacional, quem decide é a categoria do consultor (a sugestão automática manda VXUS, TSM etc. para Internacional).
   - `current_price` continua sempre em BRL (US$ × PTAX), então patrimônio, snapshots e o nível 1 do consultor não mudam. A página de ativos mostra cotação, preço médio e resultado em US$ para esses ativos.
   - Cron: PTAX do Banco Central (última dos 10 dias), Finnhub para a bolsa americana (precisa de `FINNHUB_TOKEN` no `.env.local` e na Vercel), CoinGecko para BTC e ETH. Ao cadastrar um ativo americano o símbolo é validado na Finnhub e a primeira cotação já é gravada.
   - Sem a migração 0008 o cron segue atualizando B3, Tesouro e BTC; sem `FINNHUB_TOKEN` a bolsa americana fica sem cotação e o cron avisa em `errors`.
3. **Feita (2026-09-05).** Adaptadores Fundamentus (screening ações + FIIs + detalhe) e Finnhub + cache + pré-filtro em código.
   - Migração 0009: `fundamentals_cache` (payload bruto por mercado, ticker e fonte) e `source_refresh` (última atualização por fonte). Normalização em código (`src/lib/fundamentals/normalize.ts`), então trocar de fonte não exige migração.
   - Fontes: Fundamentus `resultado.php` (994 ações, 22 colunas) e `fii_resultado.php` (561 FIIs, com vacância e cap rate), `detalhes.php` para as posições; lista da brapi para setor, subtipo e valor de mercado; Finnhub `/stock/metric` para os EUA (múltiplos TTM + série anual de EPS, margem, ROE e dívida/PL de ~6 anos, no plano grátis). Universo EUA: S&P 500 estático em `src/data/sp500.json` (Wikipedia, atualizar trimestralmente), 8 ETFs de mercado americano, 10 ETFs ex-EUA e 20 ADRs em `src/lib/fundamentals/universe.ts`.
   - Pré-filtro (`src/lib/fundamentals/screen.ts`): regras por categoria (liquidez, patrimônio positivo, lucro positivo em 12 meses para BR, P/VP 0,4–1,6 e vacância ≤ 30% para FIIs, valor de mercado ≥ US$ 5 bi para EUA, sem exigência de lucro nos EUA) e corte por nota composta para 80 ações BR, 60 FIIs, 80 EUA e 30 internacional. Posições atuais nunca saem; vão marcadas quando falhariam.
   - Página `/consultor/universo`: status das fontes, botões de atualização (B3 inteira em ~1 s; EUA em lotes de 60 símbolos por causa do limite de 60 chamadas/min da Finnhub) e a tabela de candidatos por categoria com os indicadores e os motivos de corte.
   - Cron: o cron de preços passou a rodar `refreshFundamentalsDaily` com orçamento de 150 s (Hobby só permite 2 crons; `maxDuration` foi para 300). B3 a cada 7 dias, EUA em lotes de até 150 símbolos por noite até completar, detalhe das posições a cada 30 dias.
4. **Feita (2026-09-05).** Job em background + IA de ranking + lista de compras.
   - Migração 0010: `analysis_runs` (uma rodada; estado intermediário em `state` jsonb, custo em tokens/US$) e `analysis_recommendations` (cada sugestão, com status para a entrega 6).
   - Execução: em vez do Vercel Workflows, uma máquina de etapas própria (`src/lib/consultor/run.ts`). O cliente (`RunDriver`) chama a server action `advanceAnalysis` em loop; cada chamada executa UMA etapa e grava o estado, então a rodada cabe no limite de 300 s da função e sobrevive a fechar a aba. Lock por `step_started_at` evita duas abas na mesma etapa; etapa que falha fica em `failed` com botão "tentar de novo".
   - Etapas: `prepare` (nível 1 + universo + pré-filtro por categoria, compacta posições e candidatos), `rank:<slug>` (uma chamada Opus 5 por categoria, saída estruturada validada por zod), `shopping` (código: pesos → R$ e quantidade; cotação Finnhub na hora para candidatos EUA), `narrative` (Sonnet 5 escreve o relatório).
   - Modo padrão analisa só categorias com aporte; completo analisa as quatro selecionáveis. Renda fixa, cripto e categorias personalizadas só recebem o valor.
   - Página `/consultor/analise/[id]`: andamento com barra, depois relatório: alocação vs meta, lista de compras consolidada, alertas (reduzir/vender/observar/substituir com nota de imposto), por categoria as posições revisadas e alternativas, texto do relatório e custo da rodada.
   - Precisa de `ANTHROPIC_API_KEY` (.env.local e Vercel). Fallbacks server-side de recusa não foram ativados; recusa vira erro com retry.
5. **Feita (2026-09-05).** Notícias + poda + avisos tributários.
   - Migração 0011: `news_cache` (manchetes dos últimos 6 meses por ativo + veredito da IA, ambos com validade de 7 dias).
   - Fontes: Google News RSS com operador `when:180d` (sem chave; PT-BR para B3, EN para EUA; consulta por ticker e nome curto da empresa) e Brave News quando `BRAVE_API_KEY` existir. Adaptadores em `src/lib/news/`.
   - Etapa `news` roda antes do ranking: manchetes de TODAS as posições com ticker nas categorias selecionáveis (mesmo fora das caixas analisadas), classificadas numa chamada Sonnet 5 em neutro / atenção / preocupante (com `recurring`). O veredito entra na linha da posição no prompt do Opus 5, que decide keep/watch/trim/sell pesando fundamentos e notícias: é a poda da spec. Posições fora das caixas analisadas aparecem como alerta de notícia no relatório.
   - Modo completo acrescenta `news_finalists` depois do ranking: notícias das compras, alternativas e substituições; veredito não neutro vira flag na recomendação.
   - Vereditos com menos de 7 dias são reaproveitados do cache sem chamar a IA. Custo medido: ~US$ 0,01 por 2 ativos com 12 manchetes cada.
   - Avisos tributários já vinham da entrega 4 (nota por venda/redução).
6. **Feita (2026-09-05).** Histórico, detecção de recomendações acatadas, contexto da rodada anterior.
   - Sem migração nova: `analysis_recommendations.status/status_source/resolved_at` já existiam.
   - A etapa `prepare` guarda uma foto das posições com ticker (`state.prepared.positions`). Na rodada seguinte, `reconcilePreviousRuns` compara essa foto com as posições atuais e marca cada recomendação das últimas 5 rodadas concluídas: compra/reforço executada quando a quantidade subiu ≥ 90% do sugerido, parcial se subiu menos, ignorada se não subiu; reduzir/vender pelo mesmo critério ao contrário; substituição olha os dois lados; alternativa executada se foi comprada; observar não muda. Marcação manual (`status_source = 'manual'`) nunca é sobrescrita.
   - O resumo da última rodada (recomendações por caixa com status) entra no prompt do ranking com a regra "não repita uma recomendação ignorada sem motivo novo; se parcial, considere completar", e o relatório (Sonnet) recebe a contagem para mencionar a continuidade.
   - Relatório: coluna "Acatada?" na lista de compras e nos alertas, com select para correção manual; seção "Rodada anterior" com o que foi feito. Página `/consultor/historico` lista todas as rodadas com contagem de acatamento e custo acumulado.
7. Ingestão CVM DFP/ITR para histórico plurianual de lucro e dívida.

## 10. Em aberto

Nada. Decisão de 2026-09-05: fundamentos BR via Fundamentus agora (entregas 3–6) e CVM depois (entrega 7), aceitando o risco de scraping. Startup da brapi descartado (não tem indicadores prontos nem dados de FII).

## Fontes consultadas

- https://brapi.dev/pricing
- https://brapi.dev/faq/api-e-gratis-mesmo
- https://brapi.dev/docs/acoes
- https://brapi.dev/docs/acoes/list
- https://brapi.dev/faq/tem-algum-limite
- Testes diretos na API brapi com o token do projeto (plano grátis), 2026-09-05
- https://www.fundamentus.com.br/resultado.php e fii_resultado.php (inspecionados em 2026-09-05)
- https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp
- https://dados.cvm.gov.br/dataset/cia_aberta-doc-itr
- https://eodhd.com/pricing
- https://www.tavily.com/pricing
- https://brave.com/search/api/
- https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios
- https://www.findmymoat.com/tools/financial-modeling-prep-fmp
- https://apicostcalc.com/finnhub.html
- https://vercel.com/docs/workflows
- https://vercel.com/docs/workflows/pricing
- https://vercel.com/docs/functions/limitations
