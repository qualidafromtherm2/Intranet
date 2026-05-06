# ARCHITECTURE.md

## Visao Geral

A intranet e uma aplicacao Node.js/Express com paginas estaticas servidas pelo backend e APIs REST para modulos internos. O arquivo `server.js` centraliza bootstrap, sessao, middlewares, conexao PostgreSQL, muitas rotas inline e montagem de routers em `routes/`.

## Backend

- Express em CommonJS na raiz.
- `express-session` com store PostgreSQL (`connect-pg-simple`).
- PostgreSQL via `pg`; acesso compartilhado em `src/db.js` e pools locais em alguns modulos.
- `helmet` e `express-rate-limit` sao usados para protecao basica.
- Uploads com `multer`; alguns arquivos vao para Supabase.
- `bcrypt` e sessoes Express aparecem nos fluxos de usuarios/login.

## Frontend

O frontend principal e composto por HTML/CSS/JS estatico em pastas como `public/`, `login/`, `kanban/`, `produtos/`, `mensagens/`, `legal/` e arquivos grandes na raiz. Evitar refatorar telas grandes sem escopo claro.

## Modulos Principais

- Autenticacao, usuarios e permissoes: `routes/auth.js`, `routes/users.js`, trechos de `server.js`.
- Compras/engenharia/produtos: `routes/compras.js`, `routes/engenharia.js`, `routes/produtos.js`, `routes/pcp_estrutura.js`.
- Qualidade, RI/PIR e fotos: `routes/qualidadeFotos.js`, `routes/ri.js`, `routes/pir.js`, `routes/produtosFotos.js`.
- RH: `routes/rhCargos.js` e rotas inline em `server.js`.
- SAC/AT/vendas/WhatsApp: `routes/sacEnvios.js`.
- Assistente IA: `routes/ai_assistant.js`.
- Estoque/malha/etiquetas: `routes/estoque*.js`, `routes/malha*.js`, `routes/etiquetas.js`.

## Integracoes

Detectadas por codigo e variaveis: Omie, PostgreSQL/Render, Supabase, GitHub, Google OAuth/Sheets/Calendar, OpenAI, TrackingMore/Wonca e WhatsApp/Meta.

## Banco de Dados

PostgreSQL e usado para sessao, usuarios, permissao, produtos, compras, RH, SAC, auditoria e sincronizacoes. Scripts SQL existem em `sql/`, `scripts/` e `backend/migrations/`; nao executar sem entender impacto e ambiente.

## Subprojeto Site_AT

`Site_AT/` e uma aplicacao Express ESM separada, com `src/server.js`, acesso PostgreSQL por variaveis `PG*` e porta propria.
