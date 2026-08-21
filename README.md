## New Money Hub

Organizador financeiro pessoal para casais. Ver [CLAUDE.md](./CLAUDE.md) para a visão de produto completa.

### Setup

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No SQL Editor do projeto, rode o conteúdo de [`supabase/schema.sql`](./supabase/schema.sql).
3. Em **Authentication > Providers**, habilite Email e Google (para Google: crie um OAuth Client ID em [Google Cloud Console](https://console.cloud.google.com/apis/credentials), tipo "Web application", com a Redirect URI que o Supabase mostra na tela do provider).
4. Copie `.env.local.example` para `.env.local` e preencha com as chaves de **Project Settings > API**:

```bash
cp .env.local.example .env.local
```

5. Instale as dependências e rode o projeto:

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

### Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres + Auth) · Vercel.

Este projeto roda em uma versão do Next.js mais recente que o normal de treino de LLMs — antes de usar uma API do framework, confira `node_modules/next/dist/docs/` (ex: `middleware.js` foi renomeado para `proxy.js` no Next 16).
