@AGENTS.md

# New Money Hub

## 1. Visão geral do produto

Web app **New Money Hub**: organizador financeiro pessoal para casais, começando com dois usuários (o dono do projeto e a namorada, Lara), mas desenhado desde o início para suportar múltiplos usuários/casais no futuro (potencial produto SaaS).

Objetivo: visão holística e histórica do patrimônio, consolidando ativos de naturezas muito diferentes (renda fixa, conta corrente, renda variável, cripto), tanto de forma **individual** quanto **consolidada em casal**, além de registrar **receitas** (trabalho e investimentos) e **despesas**.

### Princípios de design
- Cada usuário só vê seus próprios dados em detalhe, mas pode optar por uma visão consolidada com o parceiro vinculado.
- Ativos nunca são "compartilhados" tecnicamente — cada usuário tem suas próprias posições (mesmo que o ticker seja igual, ex: BBAS3 comprado por ambos). A consolidação é feita por **soma na camada de visualização**, nunca por registro compartilhado.
- Atualização de preços deve ser automática (várias vezes ao dia) via cron jobs, minimizando input manual.
- Deve nascer pronto para multiusuário/multi-casal (ver seção de modelo de dados).

## 2. Stack técnica

- **Frontend/Backend**: Next.js 14+ (App Router), TypeScript
- **Banco de dados**: Supabase (Postgres) — usar Row Level Security (RLS) para isolamento de dados por usuário/grupo
- **Autenticação**: Supabase Auth — email/senha + login com Google
- **Deploy**: Vercel (frontend + API routes/server actions) + Supabase Cloud (banco, plano free para começar)
- **Jobs agendados**: Vercel Cron Jobs (ou Supabase Edge Functions com pg_cron como alternativa) para atualização periódica de cotações
- **Gráficos**: recharts ou similar
- **Estilo**: Tailwind CSS

### APIs externas de mercado
- **Ações e FIIs (B3)**: [brapi.dev](https://brapi.dev) — cotações de ações e fundos imobiliários brasileiros
- **Tesouro Direto**: brapi.dev também tem endpoint dedicado (`/api/v2/treasury`) com lista de títulos, taxas atuais e histórico diário de preço de compra/venda desde 2005 — usar isso para calcular a marcação a mercado real dos títulos prefixados e IPCA+ (não só a curva teórica até o vencimento)
- **Bitcoin**: CoinGecko API (endpoint público, sem necessidade de key para uso básico)

Antes de implementar cada integração, verificar a documentação atual de cada API (endpoints, limites de rate, necessidade de API key) pois podem ter mudado.

## 3. Modelo de dados

Pensar em multiusuário/multi-casal desde já. Households usam vínculo direto entre usuários (sem fluxo de convite por email na Fase 1). Preço de mercado é normalizado em `market_instruments`, separado das posições individuais, para não duplicar cotação de um mesmo ticker entre usuários diferentes.

```
users
  - id, email, name, auth_provider, created_at

households (representa um "casal"/grupo financeiro)
  - id, name, created_at

household_members (vincula usuários a households)
  - id, household_id, user_id, role (ex: 'member'), joined_at

asset_classes (enum/tabela: renda_fixa, conta_corrente, acoes, fiis, bitcoin)
  - id, name, slug

market_instruments (dado de mercado puro, sem user_id — referência compartilhada)
  - id, asset_class_id, ticker (nullable, ex: BBAS3, HGLG11), external_id (código do título no tesouro),
    name, current_price, current_price_updated_at

instrument_price_history (histórico de preço/cotação por instrumento, populado via cron)
  - id, instrument_id, price, source (brapi/coingecko/manual), fetched_at

assets (posições individuais — sempre vinculadas a um único user_id)
  - id, user_id, asset_class_id, instrument_id (nullable — só p/ ativos com cotação de mercado),
    name, quantity, average_price, purchase_date,
    metadata (jsonb — flexível para dados específicos por classe:
      ex renda fixa: taxa_contratada, indexador, vencimento;
      conta corrente: banco, tipo (conta/caixinha), nome_caixinha)
  created_at, updated_at

asset_snapshots (snapshot do valor total de cada asset em determinado momento —
  útil para variação patrimonial sem recalcular tudo)
  - id, asset_id, total_value, snapshot_date

income_categories (enum: salario, dividendos, jcp, rendimento_fii, rendimento_renda_fixa, outros)
  - id, name, slug

incomes (receitas)
  - id, user_id, asset_id (nullable — vínculo opcional ao ativo que gerou),
    income_category_id, amount, description, received_at, created_at

expense_categories (moradia, alimentação, transporte, lazer, saúde,
  educação, assinaturas, outros — editável pelo usuário)
  - id, household_id (nullable — pode ser categoria padrão global ou custom),
    name, slug, icon

expenses
  - id, user_id, expense_category_id, amount, description, spent_at, created_at
```

**Row Level Security**: cada tabela de dado sensível (assets, incomes, expenses) deve ter policy garantindo que `user_id = auth.uid()` para escrita/leitura individual. Para visão consolidada, criar uma view ou query que faça `JOIN` através de `household_members` verificando que o usuário autenticado pertence ao mesmo household de quem está consultando. `market_instruments` e `instrument_price_history` são de leitura pública para qualquer usuário autenticado (não têm `user_id`).

## 4. Funcionalidades — Fase 1 (MVP)

1. **Autenticação**: cadastro/login com email+senha e Google via Supabase Auth.
2. **Onboarding**: criar um household e vincular diretamente o segundo usuário (sem fluxo de convite por email na Fase 1).
3. **Cadastro manual de ativos** por classe:
   - Renda fixa (Tesouro): título, quantidade/valor investido, taxa contratada, indexador (Selic/IPCA/Prefixado), data de compra, vencimento
   - Conta Nubank: saldo em conta + caixinhas (nome + valor + se rende automaticamente)
   - Ações/FIIs: ticker, quantidade, preço médio, data de compra
   - Bitcoin: quantidade em cold wallet
4. **Atualização automática de preços** (cron job diário no mínimo, idealmente a cada poucas horas):
   - Ações/FIIs via brapi.dev
   - Tesouro via brapi.dev (marcação a mercado)
   - Bitcoin via CoinGecko
5. **Dashboard individual**: patrimônio total, alocação por classe de ativo (gráfico de pizza), evolução do patrimônio no tempo (gráfico de linha).
6. **Dashboard consolidado (casal)**: mesma visão, somando as posições de ambos os usuários do household, com toggle para ver individual vs. consolidado.
7. **Registro de receitas**: lançamento manual vinculado opcionalmente a um ativo, com categoria.
8. **Registro de despesas**: lançamento manual com categoria (usar as categorias sugeridas: moradia, alimentação, transporte, lazer, saúde, educação, assinaturas, outros).
9. **Visão de receita passiva**: total de receita de investimentos por período (mês/ano), quebrado por categoria e por ativo.

## 5. Funcionalidades — Fase 2 (evolução)

- Gráfico de yield por ativo (receita gerada / valor investido)
- Comparação lado a lado patrimônio individual vs. individual (dono do projeto vs. Lara)
- Importação de extratos (CSV/OFX) para popular histórico retroativo, se decidido fazer depois
- Metas/marcos financeiros (não é prioridade agora, mas deixar a modelagem não impeça isso depois)
- Notificações/alertas (ex: título do tesouro com boa oportunidade de marcação a mercado)
- Fluxo de convite por email para novos households (hoje é vínculo direto)

## 6. O que NÃO fazer nesta primeira versão

- Não implementar integração via Open Finance/APIs bancárias diretas — tudo é lançamento manual de posição, só o *preço/cotação* é automático.
- Não se preocupar com importação de histórico de extratos agora — só deixar a modelagem preparada (campos de data já existem, então isso é só uma feature de importação futura).
- Não implementar metas/marcos ainda.
- Não superengenhar o sistema de households para N pessoas agora — 2 pessoas por household já resolve, mas a tabela `household_members` já suporta N por natureza, então não precisa de gambiarra.
- Não implementar fluxo de convite por email — vínculo direto entre usuários conhecidos.

## 7. Como trabalhar neste projeto

1. Comece confirmando o entendimento do modelo de dados e ajuste o que fizer sentido tecnicamente (ex: normalizar mais ou menos, nomes de tabelas).
2. Monte a estrutura do projeto Next.js + configuração do Supabase (schema SQL com RLS já incluído).
3. Implemente a Fase 1 em etapas incrementais e testáveis: (a) auth + households, (b) CRUD de ativos, (c) integração com APIs de preço + cron, (d) dashboards, (e) receitas, (f) despesas.
4. Priorize algo funcional ponta a ponta cedo (mesmo que com poucos ativos/telas), depois expanda — não ficar semanas sem nada rodando.
5. Perguntar quando decisões de produto não estiverem claras; não assumir silenciosamente.

## 8. Configuração local

- Gerenciador de pacotes: npm.
- Credenciais do Supabase ficam em `.env.local` (não commitado) — ver `.env.local.example`.
