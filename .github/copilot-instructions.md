# Intranet — instruções para agentes

## Visão geral
- Backend monolítico em Node/Express em `server.js` com muitas rotas inline e montagem de rotas em `routes/`.
- Banco principal é Postgres via `pg`; helpers em `src/db.js`. Alguns módulos criam `Pool` próprio (ex.: `routes/auth.js`), outros recebem `pool` injetado (ex.: `routes/compras.js`).
- Integração com Omie: chamadas HTTP em `utils/omieCall.js` e webhook/consulta de produtos em `routes/produtos.js`.
- Sincronização em tempo real usa SSE em /api/produtos/stream (ver `server.js`); o front acompanha progresso.

## Fluxos e integrações
- Credenciais e chaves ficam em variáveis de ambiente (ex.: `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `OMIE_WEBHOOK_TOKEN`, `DATABASE_URL`).
- Sincronizações/migrações e scripts operacionais estão em `scripts/` (ex.: `scripts/sync_produtos_omie_rapido.js`, `scripts/sync_produtos_omie_completo.js`).
- Arquivos JSON locais usados por módulos específicos ficam em `data/` (modo local/legado).
- Sessões via `express-session` são configuradas antes das rotas em `server.js`; respeite essa ordem ao adicionar novas rotas.

## Workflows essenciais
- Desenvolvimento: `npm run dev` (nodemon) e produção local: `npm start` (ver `package.json`).
- PM2 é o processo padrão (ver `ecosystem.config.js`); o serviço principal é `intranet_api`.
- Validação de webhook de produtos: `VALIDACAO_WEBHOOK.md` e script `scripts/test_webhook_produtos.sh`.
- Guia de sincronização Omie: `GUIA_SINCRONIZACAO_PRODUTOS.md`.

## Padrões do projeto
- Preferir reutilizar `dbQuery`/`dbGetClient` de `src/db.js` quando possível; se criar `Pool` novo, padronize `ssl: { rejectUnauthorized: false }` (Render).
- Endpoints de produtos usam normalização de payload para o front (ex.: `tipoItem`, `codInt_familia`) — veja `routes/produtos.js`.
- Para novos módulos de API, manter a estrutura Express em `routes/` e montar no `server.js`.
- Existe um app separado em `Site_AT/` com README próprio e porta 3000 (ver `Site_AT/README.md`).

## Instruções para respostas
- Para cada atualização de código, inclua uma linha com **exemplo de comando** executado (ex.: `pm2 restart intranet_api`).
- Se a atualização envolver HTML, explique **apenas um trecho pequeno** da alteração em cada resposta, citando **em que parte da página** ele aparece.
- Quando houver alterações, traga a explicação em **lista separada por HTML, CSS e JavaScript** (quando aplicável).
- Só execute os comandos do PM2 quando a atualização realmente exigir (ex.: mudanças de backend). Se a mudança for apenas em HTML/CSS/JS de front, **não** execute PM2.
